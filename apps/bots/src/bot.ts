import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createClient, type Interceptor, type Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import {
  BidderService,
  BidderSessionRequestSchema,
  BiddingService,
  CatalogService,
  LotStatus,
  SubmitAbsenteeBookRequestSchema,
  formatUsd,
  type BidderSessionRequest,
  type Lot,
} from "@cafe/contracts";
import { valuationFor, type Persona } from "./personas";

/**
 * One trading bot. It uses ALL FOUR gRPC call types over native HTTP/2:
 *   unary            -> RegisterBidder, ListLots
 *   client streaming -> SubmitAbsenteeBook
 *   bidirectional    -> BidderSession (events in, bids out, same connection)
 */
export class TradingBot {
  private readonly lots = new Map<string, Lot>();
  private readonly pending = new Set<string>();
  private token = "";
  private paddle = "";
  private stopped = false;
  private commands: CommandQueue | null = null;
  private ticker: NodeJS.Timeout | null = null;

  constructor(
    private readonly persona: Persona,
    private readonly baseUrl: string,
    private readonly log: boolean,
    private readonly random: () => number = Math.random,
  ) {}

  async start(): Promise<void> {
    await this.register();
    if (this.persona.usesAbsenteeBook) await this.submitAbsenteeBook().catch((e) => this.say(`absentee book failed: ${e}`));
    this.ticker = setInterval(() => this.evaluateAll(), 3_000);
    this.ticker.unref();
    void this.sessionLoop();
  }

  stop(): void {
    this.stopped = true;
    this.commands?.close();
    if (this.ticker) clearInterval(this.ticker);
  }

  // ------------------------------------------------------------------ setup

  private transport(): Transport {
    const auth: Interceptor = (next) => async (req) => {
      if (this.token) req.header.set("authorization", `Bearer ${this.token}`);
      return next(req);
    };
    // Native gRPC: HTTP/2 + binary Protobuf. http:// means h2c (prior knowledge).
    return createGrpcTransport({ baseUrl: this.baseUrl, interceptors: [auth] });
  }

  private async register(): Promise<void> {
    const client = createClient(BidderService, this.transport());
    const res = await client.registerBidder({
      displayName: this.persona.displayName,
      company: this.persona.company,
      country: this.persona.country,
      isBot: true,
    });
    this.token = res.token;
    this.paddle = res.bidder?.paddle ?? "?";
    this.say(`registered as paddle ${this.paddle} (${this.persona.strategy.name})`);
  }

  /** CLIENT STREAMING: sends many proxy bids in one stream, gets one summary. */
  private async submitAbsenteeBook(): Promise<void> {
    const catalog = createClient(CatalogService, this.transport());
    const { lots } = await catalog.listLots({ statuses: [LotStatus.SCHEDULED, LotStatus.LIVE], limit: 20 });
    const persona = this.persona;
    async function* book() {
      for (const lot of lots) {
        yield create(SubmitAbsenteeBookRequestSchema, {
          lotId: lot.id,
          maxAmountCents: Math.round(valuationFor(persona, lot) * 0.85),
        });
      }
    }
    const bidding = createClient(BiddingService, this.transport());
    const summary = await bidding.submitAbsenteeBook(book());
    this.say(`absentee book: ${summary.accepted}/${summary.received} proxies accepted`);
  }

  // ------------------------------------------------------- bidi session loop

  private async sessionLoop(): Promise<void> {
    let backoffMs = 1_000;
    while (!this.stopped) {
      try {
        await this.runSession();
        backoffMs = 1_000;
      } catch (error) {
        if (this.stopped) return;
        const code = error instanceof ConnectError ? Code[error.code] : String(error);
        this.say(`session dropped (${code}); reconnecting in ${backoffMs / 1000}s`);
      }
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, 30_000);
    }
  }

  /** BIDIRECTIONAL STREAMING: commands go up while lot events come down. */
  private async runSession(): Promise<void> {
    const client = createClient(BiddingService, this.transport());
    this.commands = new CommandQueue();
    this.commands.push({ correlationId: "sub-1", command: { case: "subscribe", value: { lotIds: [] } } });

    for await (const message of client.bidderSession(this.commands)) {
      const event = message.event;
      switch (event.case) {
        case "lotEvent": {
          const lot = event.value.lot;
          if (!lot) break;
          this.lots.set(lot.id, lot);
          if (event.value.kind.case === "closed") {
            const closed = event.value.kind.value;
            if (closed.sold && closed.winningPaddle === this.paddle) {
              this.say(`🏆 won ${lot.code} "${lot.name}" at ${formatUsd(closed.hammerPriceCents)}/lb`);
            }
            this.lots.delete(lot.id);
          } else {
            this.maybeBid(lot);
          }
          break;
        }
        case "bidResult": {
          this.pending.delete(message.correlationId.split(":")[0] ?? "");
          const r = event.value;
          if (r.accepted && r.bid) this.say(`bid ${formatUsd(r.bid.amountCents)}/lb ✔ ${r.message}`);
          break;
        }
        default:
          break;
      }
    }
  }

  private evaluateAll(): void {
    for (const lot of this.lots.values()) this.maybeBid(lot);
  }

  private maybeBid(lot: Lot): void {
    if (lot.status !== LotStatus.LIVE || lot.leadingPaddle === this.paddle) return;
    if (this.pending.has(lot.id) || !this.commands) return;

    const endsAt = lot.endsAt ? timestampDate(lot.endsAt).getTime() : 0;
    const decision = this.persona.strategy.decide({
      lot,
      valuationCents: valuationFor(this.persona, lot),
      secondsLeft: (endsAt - Date.now()) / 1000,
      random: this.random,
    });
    if (!decision) return;

    this.pending.add(lot.id);
    const delay = 400 + this.random() * 2_500; // humans hesitate, bots should too
    setTimeout(() => {
      this.commands?.push({
        correlationId: `${lot.id}:${Date.now()}`,
        command: {
          case: "placeBid",
          value: {
            lotId: lot.id,
            amountCents: decision.amountCents,
            maxAmountCents: decision.maxAmountCents,
            idempotencyKey: `${this.paddle}-${lot.id}-${decision.amountCents}`,
          },
        },
      });
      // Safety: never stay blocked if a result gets lost.
      setTimeout(() => this.pending.delete(lot.id), 5_000).unref();
    }, delay).unref();
  }

  private say(text: string): void {
    if (this.log) console.log(`[bot ${this.paddle || "…"} ${this.persona.company}] ${text}`);
  }
}

type CommandInit = Parameters<typeof create<typeof BidderSessionRequestSchema>>[1];

/** Async-iterable queue used as the outgoing half of the bidi stream. */
class CommandQueue implements AsyncIterable<BidderSessionRequest> {
  private readonly buffer: BidderSessionRequest[] = [];
  private wake: (() => void) | null = null;
  private closed = false;

  push(init: CommandInit): void {
    if (this.closed) return;
    this.buffer.push(create(BidderSessionRequestSchema, init));
    this.wake?.();
  }

  close(): void {
    this.closed = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<BidderSessionRequest> {
    while (!this.closed) {
      const next = this.buffer.shift();
      if (next) {
        yield next;
        continue;
      }
      await new Promise<void>((resolve) => (this.wake = resolve));
      this.wake = null;
    }
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
