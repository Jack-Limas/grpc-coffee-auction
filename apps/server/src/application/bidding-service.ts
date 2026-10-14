import { absenteeBidSchema, firstIssue, formatUsd, placeBidSchema } from "@cafe/contracts";
import {
  applyBid,
  assertBidAllowed,
  assertCredit,
  canAfford,
  minNextBid,
} from "../domain/auction-rules";
import { BidRejectedError, NotFoundError, ValidationError } from "../domain/errors";
import type { AuctionRules, Bid, Bidder, BidSource, Lot, ProxyBid } from "../domain/models";
import { resolveProxies, type ProxyResolution } from "../domain/proxy-engine";
import type { Clock } from "../infrastructure/clock";
import type { EventBus } from "../infrastructure/event-bus";
import { newId } from "../infrastructure/ids";
import type { KeyedMutex } from "../infrastructure/keyed-mutex";
import type { AuctionRepository } from "../infrastructure/repositories/auction-repository";
import type { AuctionEvent } from "./events";

export interface PlaceBidOutcome {
  /** null when only a proxy was armed on a lot that has not opened yet. */
  readonly bid: Bid | null;
  readonly lot: Lot;
  readonly isLeading: boolean;
}

export interface AbsenteeOutcome {
  readonly lotId: string;
  readonly accepted: boolean;
  readonly message: string;
}

/**
 * WRITE SIDE use cases: placing bids, proxy bids and absentee books.
 *
 * Every mutation of a lot runs inside `mutex.run(lot.id)`, follows the same
 * pipeline and publishes events only AFTER the commit succeeded:
 *
 *   load -> validate (domain rules) -> apply -> proxy engine -> commit -> publish
 */
export class BiddingService {
  constructor(
    private readonly repo: AuctionRepository,
    private readonly clock: Clock,
    private readonly bus: EventBus<AuctionEvent>,
    private readonly rules: AuctionRules,
    private readonly mutex: KeyedMutex,
  ) {}

  async placeBid(bidder: Bidder, input: unknown, source: Exclude<BidSource, "PROXY">): Promise<PlaceBidOutcome> {
    const parsed = placeBidSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError(firstIssue(parsed.error));
    const command = parsed.data;

    return this.mutex.run(command.lotId, async () => {
      // Idempotency: a retried request (same key) returns the original result.
      if (command.idempotencyKey) {
        const previous = await this.repo.findBidByIdempotencyKey(bidder.id, command.idempotencyKey);
        if (previous) {
          const lot = await this.requireLot(previous.lotId);
          return { bid: previous, lot, isLeading: lot.leaderBidderId === bidder.id };
        }
      }

      const lot = await this.requireLot(command.lotId);
      if (lot.status === "SCHEDULED" && command.maxAmountCents !== undefined) {
        await this.armScheduledProxy(bidder, lot, command.maxAmountCents);
        return { bid: null, lot, isLeading: false };
      }
      if (lot.leaderBidderId === bidder.id && command.maxAmountCents !== undefined) {
        return this.raiseOwnProxy(bidder, lot, command.maxAmountCents);
      }
      return this.placeLocked(bidder, lot, {
        amountCents: command.amountCents,
        maxAmountCents: command.maxAmountCents,
        idempotencyKey: command.idempotencyKey || null,
        source,
      });
    });
  }

  /**
   * One entry of an absentee book (client-streaming RPC). The buyer only says
   * "up to X per lb"; the house places the minimum bid and keeps the rest as
   * a proxy. If the lot has not opened yet, the proxy waits for the opening.
   */
  async submitAbsenteeBid(bidder: Bidder, input: unknown): Promise<AbsenteeOutcome> {
    const parsed = absenteeBidSchema.safeParse(input);
    const lotId = typeof (input as { lotId?: unknown })?.lotId === "string" ? (input as { lotId: string }).lotId : "";
    if (!parsed.success) return { lotId, accepted: false, message: firstIssue(parsed.error) };
    const { maxAmountCents } = parsed.data;

    try {
      return await this.mutex.run(parsed.data.lotId, async () => {
        const lot = await this.requireLot(parsed.data.lotId);

        if (lot.status === "SCHEDULED") {
          await this.armScheduledProxy(bidder, lot, maxAmountCents);
          return { lotId: lot.id, accepted: true, message: `Proxy armed up to ${formatUsd(maxAmountCents)}/lb; it will bid at the opening` };
        }

        if (lot.leaderBidderId === bidder.id) {
          await this.raiseOwnProxy(bidder, lot, maxAmountCents);
          return { lotId: lot.id, accepted: true, message: `Already leading; proxy raised to ${formatUsd(maxAmountCents)}/lb` };
        }

        const minimum = minNextBid(lot);
        if (maxAmountCents < minimum) {
          throw new BidRejectedError("BELOW_MINIMUM", `Maximum ${formatUsd(maxAmountCents)} is below the minimum ${formatUsd(minimum)}`, minimum);
        }
        const outcome = await this.placeLocked(bidder, lot, {
          amountCents: minimum,
          maxAmountCents,
          idempotencyKey: null,
          source: "PROXY",
        });
        return {
          lotId: lot.id,
          accepted: true,
          message: outcome.isLeading
            ? `Leading at ${formatUsd(outcome.lot.currentPriceCents)}/lb (max ${formatUsd(maxAmountCents)})`
            : `Placed, but outbid by another proxy at ${formatUsd(outcome.lot.currentPriceCents)}/lb`,
        };
      });
    } catch (error) {
      if (error instanceof BidRejectedError || error instanceof NotFoundError) {
        return { lotId, accepted: false, message: error.message };
      }
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Internals (always called while holding the lot's lock)
  // -------------------------------------------------------------------------

  private async placeLocked(
    bidder: Bidder,
    lot: Lot,
    command: {
      amountCents: number;
      maxAmountCents: number | undefined;
      idempotencyKey: string | null;
      source: BidSource;
    },
  ): Promise<PlaceBidOutcome> {
    const now = this.clock.now();
    const exposure = await this.repo.exposureFor(bidder.id, lot.id);

    assertBidAllowed({ lot, bidder, amountCents: command.amountCents, exposureElsewhereCents: exposure, now });
    if (command.maxAmountCents !== undefined) {
      assertCredit(bidder, exposure, command.maxAmountCents, lot, minNextBid(lot));
    }

    const previousLeaderPaddle = lot.leaderPaddle;
    const applied = applyBid(lot, bidder, command.amountCents, now, this.rules);
    const bid: Bid = {
      id: newId(),
      lotId: lot.id,
      bidderId: bidder.id,
      paddle: bidder.paddle,
      amountCents: command.amountCents,
      source: command.source,
      placedAt: now,
      idempotencyKey: command.idempotencyKey,
    };

    let proxies = await this.repo.listActiveProxies(lot.id);
    const upsertProxies: ProxyBid[] = [];
    if (command.maxAmountCents !== undefined) {
      const proxy = this.buildProxy(bidder, lot, command.maxAmountCents, proxies);
      upsertProxies.push(proxy);
      proxies = [...proxies.filter((p) => p.id !== proxy.id), proxy];
    }

    const resolution = await this.runProxyEngine(applied.lot, proxies, now);
    const autoBids = this.toBids(lot.id, resolution, now);

    await this.repo.commit({
      lot: resolution.lot,
      newBids: [bid, ...autoBids],
      upsertProxies,
      deactivateProxyIds: resolution.exhaustedProxyIds,
    });

    // Publish only after a successful commit.
    this.bus.publish({ type: "bid_placed", lot: resolution.lot, bid, previousLeaderPaddle });
    this.publishAutoBids(resolution, autoBids, bidder.paddle);
    const extendedFrom = applied.extendedFrom ?? resolution.autoBids.find((a) => a.extendedFrom)?.extendedFrom ?? null;
    if (extendedFrom) this.publishExtension(resolution.lot, extendedFrom);

    return { bid, lot: resolution.lot, isLeading: resolution.lot.leaderBidderId === bidder.id };
  }

  /** Before the opening, a proxy simply waits; the lifecycle fires it at the open. */
  private async armScheduledProxy(bidder: Bidder, lot: Lot, maxAmountCents: number): Promise<void> {
    if (maxAmountCents < lot.startingPriceCents) {
      throw new BidRejectedError(
        "INVALID_PROXY_MAX",
        `Your maximum must be at least the starting price of ${formatUsd(lot.startingPriceCents)}/lb`,
        lot.startingPriceCents,
      );
    }
    const exposure = await this.repo.exposureFor(bidder.id, lot.id);
    assertCredit(bidder, exposure, maxAmountCents, lot, lot.startingPriceCents);
    const proxies = await this.repo.listActiveProxies(lot.id);
    await this.repo.commit({
      lot,
      newBids: [],
      upsertProxies: [this.buildProxy(bidder, lot, maxAmountCents, proxies)],
      deactivateProxyIds: [],
    });
  }

  private async raiseOwnProxy(bidder: Bidder, lot: Lot, maxAmountCents: number): Promise<PlaceBidOutcome> {
    const minimum = minNextBid(lot);
    if (maxAmountCents <= lot.currentPriceCents) {
      throw new BidRejectedError(
        "INVALID_PROXY_MAX",
        `Your maximum must be above the current price of ${formatUsd(lot.currentPriceCents)}/lb`,
        minimum,
      );
    }
    const exposure = await this.repo.exposureFor(bidder.id, lot.id);
    assertCredit(bidder, exposure, maxAmountCents, lot, minimum);

    const proxies = await this.repo.listActiveProxies(lot.id);
    await this.repo.commit({
      lot,
      newBids: [],
      upsertProxies: [this.buildProxy(bidder, lot, maxAmountCents, proxies)],
      deactivateProxyIds: [],
    });
    const [lastBid] = await this.repo.listBids(lot.id, 1);
    if (!lastBid) throw new NotFoundError("Bid for lot", lot.id);
    return { bid: lastBid, lot, isLeading: true };
  }

  /** Runs the pure engine with a pre-loaded credit snapshot of every proxy owner. */
  async runProxyEngine(lot: Lot, proxies: readonly ProxyBid[], now: Date): Promise<ProxyResolution> {
    if (proxies.length === 0) return { lot, autoBids: [], exhaustedProxyIds: [] };

    const owners = [...new Set(proxies.map((p) => p.bidderId))];
    const snapshot = new Map<string, { bidder: Bidder; exposure: number }>();
    await Promise.all(
      owners.map(async (id) => {
        const [bidder, exposure] = await Promise.all([this.repo.getBidder(id), this.repo.exposureFor(id, lot.id)]);
        if (bidder) snapshot.set(id, { bidder, exposure });
      }),
    );

    return resolveProxies(lot, proxies, now, this.rules, (bidderId, amountCents) => {
      const entry = snapshot.get(bidderId);
      return entry ? canAfford(entry.bidder, entry.exposure, amountCents, lot) : false;
    });
  }

  toBids(lotId: string, resolution: ProxyResolution, now: Date): Bid[] {
    return resolution.autoBids.map((auto, index) => ({
      id: newId(),
      lotId,
      bidderId: auto.bidderId,
      paddle: auto.paddle,
      amountCents: auto.amountCents,
      source: "PROXY" as const,
      // +1ms per auto bid keeps a stable chronological order in the history.
      placedAt: new Date(now.getTime() + index + 1),
      idempotencyKey: null,
    }));
  }

  publishAutoBids(resolution: ProxyResolution, autoBids: readonly Bid[], firstPreviousPaddle: string | null): void {
    let previous = firstPreviousPaddle;
    for (const bid of autoBids) {
      this.bus.publish({ type: "bid_placed", lot: resolution.lot, bid, previousLeaderPaddle: previous });
      previous = bid.paddle;
    }
  }

  publishExtension(lot: Lot, previousEndsAt: Date): void {
    this.bus.publish({
      type: "extended",
      lot,
      previousEndsAt,
      extensionSeconds: Math.round(this.rules.extensionMs / 1000),
    });
  }

  private buildProxy(bidder: Bidder, lot: Lot, maxAmountCents: number, existing: readonly ProxyBid[]): ProxyBid {
    const own = existing.find((p) => p.bidderId === bidder.id);
    return own
      ? { ...own, maxAmountCents, active: true }
      : {
          id: newId(),
          lotId: lot.id,
          bidderId: bidder.id,
          paddle: bidder.paddle,
          maxAmountCents,
          active: true,
          createdAt: this.clock.now(),
        };
  }

  private async requireLot(lotId: string): Promise<Lot> {
    const lot = await this.repo.getLot(lotId);
    if (!lot) throw new NotFoundError("Lot", lotId);
    return lot;
  }
}
