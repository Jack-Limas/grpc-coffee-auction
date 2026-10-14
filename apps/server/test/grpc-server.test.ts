import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient, type Interceptor, type Transport } from "@connectrpc/connect";
import { createConnectTransport, createGrpcTransport, createGrpcWebTransport } from "@connectrpc/connect-node";
import {
  BidderService,
  BidderSessionRequestSchema,
  BiddingService,
  BidRejectionReason,
  BidRejectionSchema,
  CatalogService,
  LotStatus,
  SubmitAbsenteeBookRequestSchema,
  type BidderSessionRequest,
} from "@cafe/contracts";
import type { AddressInfo } from "node:net";
import type net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLot, DEMO_CATALOG } from "../src/application/demo-catalog";
import { createContainer, type Container } from "../src/container";
import { InMemoryAuctionRepository } from "../src/infrastructure/repositories/in-memory-auction-repository";
import { authInterceptor, errorInterceptor } from "../src/transport/interceptors";
import { createRoutes } from "../src/transport/routes";
import { createDualProtocolServer } from "../src/transport/server";

let server: net.Server;
let baseUrl: string;
let container: Container;
let liveLotId: string;
let scheduledLotId: string;

const withToken = (token: string): Interceptor => (next) => async (req) => {
  req.header.set("authorization", `Bearer ${token}`);
  return next(req);
};

/** The three wire protocols, all hitting the SAME port. */
const transports = {
  grpc: (i: Interceptor[] = []) => createGrpcTransport({ baseUrl, interceptors: i }),
  grpcWeb: (i: Interceptor[] = []) => createGrpcWebTransport({ baseUrl, httpVersion: "1.1", interceptors: i }),
  connect: (i: Interceptor[] = []) => createConnectTransport({ baseUrl, httpVersion: "1.1", interceptors: i }),
};

async function register(transport: Transport, name: string) {
  const res = await createClient(BidderService, transport).registerBidder({
    displayName: name,
    company: `${name} Roasters`,
    country: "Colombia",
  });
  return { token: res.token, paddle: res.bidder!.paddle };
}

beforeAll(async () => {
  const repo = new InMemoryAuctionRepository();
  container = createContainer({ repo, lifecycle: { demoMode: false } });
  const now = new Date();
  const live = createLot(DEMO_CATALOG[0]!, 1, new Date(now.getTime() - 1_000), 10 * 60_000, now);
  const scheduled = createLot(DEMO_CATALOG[1]!, 2, new Date(now.getTime() + 60 * 60_000), 10 * 60_000, now);
  await repo.insertLot(live);
  await repo.insertLot(scheduled);
  liveLotId = live.id;
  scheduledLotId = scheduled.id;

  server = createDualProtocolServer({
    routes: createRoutes(container),
    interceptors: [errorInterceptor, authInterceptor(container.bidders)],
    corsOrigins: "*",
    health: async () => ({}),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

describe("one port, three protocols", () => {
  it.each(Object.keys(transports) as (keyof typeof transports)[])("serves unary ListLots over %s", async (name) => {
    const client = createClient(CatalogService, transports[name]());
    const res = await client.listLots({ statuses: [LotStatus.LIVE] });
    expect(res.lots.map((l) => l.id)).toEqual([liveLotId]);
    // The secret reserve never leaves the server: there is no such field.
    expect(Object.keys(res.lots[0]!)).not.toContain("reservePriceCents");
  });
});

describe("bidding", () => {
  it("requires authentication", async () => {
    const client = createClient(BiddingService, transports.grpc());
    const err = await client.placeBid({ lotId: liveLotId, amountCents: 5_000 }).catch((e) => e);
    expect(ConnectError.from(err).code).toBe(Code.Unauthenticated);
  });

  it("accepts a valid bid and rejects a low one with a typed error detail", async () => {
    const { token } = await register(transports.connect(), "Alice");
    const bidding = createClient(BiddingService, transports.connect([withToken(token)]));

    const ok = await bidding.placeBid({ lotId: liveLotId, amountCents: 2_400 });
    expect(ok.isLeading).toBe(true);
    expect(ok.lot?.currentPriceCents).toBe(2_400);
    expect(ok.lot?.minNextBidCents).toBe(2_425);

    const { token: bobToken } = await register(transports.grpc(), "Bob");
    const bob = createClient(BiddingService, transports.grpc([withToken(bobToken)]));
    const err = ConnectError.from(await bob.placeBid({ lotId: liveLotId, amountCents: 2_410 }).catch((e) => e));
    expect(err.code).toBe(Code.FailedPrecondition);
    const [detail] = err.findDetails(BidRejectionSchema);
    expect(detail?.reason).toBe(BidRejectionReason.BELOW_MINIMUM);
    expect(detail?.minNextBidCents).toBe(2_425);
  });

  it("is idempotent: retrying with the same key does not bid twice", async () => {
    const { token } = await register(transports.grpc(), "Carla");
    const bidding = createClient(BiddingService, transports.grpc([withToken(token)]));
    const lot = (await createClient(CatalogService, transports.grpc()).getLot({ lotId: liveLotId })).lot!;
    const request = { lotId: liveLotId, amountCents: lot.minNextBidCents, idempotencyKey: "retry-123" };
    const first = await bidding.placeBid(request);
    const second = await bidding.placeBid(request);
    expect(second.bid?.id).toBe(first.bid?.id);
  });
});

describe("streaming", () => {
  it("server streaming: WatchLot sends a snapshot and then live bids", async () => {
    const controller = new AbortController();
    const stream = createClient(BiddingService, transports.grpcWeb()).watchLot({ lotId: liveLotId }, { signal: controller.signal });
    const iterator = stream[Symbol.asyncIterator]();

    const first = await iterator.next();
    expect(first.value.event.kind.case).toBe("snapshot");

    const { token } = await register(transports.grpc(), "Diego");
    const lot = first.value.event.lot;
    await createClient(BiddingService, transports.grpc([withToken(token)])).placeBid({
      lotId: liveLotId,
      amountCents: lot.minNextBidCents,
    });

    const second = await iterator.next();
    expect(second.value.event.kind.case).toBe("bidPlaced");
    expect(second.value.event.kind.value.bid.amountCents).toBe(lot.minNextBidCents);
    controller.abort();
  });

  it("client streaming: an absentee book arms proxies in one call", async () => {
    const { token } = await register(transports.grpc(), "Elena");
    async function* book() {
      yield create(SubmitAbsenteeBookRequestSchema, { lotId: scheduledLotId, maxAmountCents: 3_000 });
      yield create(SubmitAbsenteeBookRequestSchema, { lotId: "does-not-exist", maxAmountCents: 3_000 });
    }
    const summary = await createClient(BiddingService, transports.grpc([withToken(token)])).submitAbsenteeBook(book());
    expect(summary.received).toBe(2);
    expect(summary.accepted).toBe(1);
    expect(summary.results[1]?.message).toMatch(/not found/);
  });

  it("bidirectional streaming: a bot session subscribes and bids on the same stream", async () => {
    const { token, paddle } = await register(transports.grpc(), "Bot");
    const lot = (await createClient(CatalogService, transports.grpc()).getLot({ lotId: liveLotId })).lot!;

    const outgoing: BidderSessionRequest[] = [
      create(BidderSessionRequestSchema, { correlationId: "s", command: { case: "subscribe", value: { lotIds: [liveLotId] } } }),
      create(BidderSessionRequestSchema, {
        correlationId: "b1",
        command: { case: "placeBid", value: { lotId: liveLotId, amountCents: lot.minNextBidCents } },
      }),
    ];
    let release!: () => void;
    const done = new Promise<void>((r) => (release = r));
    async function* commands() {
      yield* outgoing;
      await done; // keep our half open until we saw the results
    }

    const seen: string[] = [];
    for await (const msg of createClient(BiddingService, transports.grpc([withToken(token)])).bidderSession(commands())) {
      seen.push(msg.event.case ?? "");
      if (msg.event.case === "lotEvent" && msg.event.value.kind.case === "bidPlaced") {
        expect(msg.event.value.kind.value.bid?.paddle).toBe(paddle);
      }
      if (msg.event.case === "me") {
        expect(msg.event.value.exposureCents).toBeGreaterThan(0);
        release();
        break;
      }
    }
    expect(seen).toContain("bidResult");
    expect(seen).toContain("lotEvent");
  });
});

describe("http extras", () => {
  it("answers health checks and CORS preflights", async () => {
    const health = await fetch(`${baseUrl}/healthz`);
    expect(health.status).toBe(200);
    const preflight = await fetch(`${baseUrl}/coffee.auction.v1.BiddingService/PlaceBid`, {
      method: "OPTIONS",
      headers: { origin: "https://example.vercel.app", "access-control-request-method": "POST" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-headers")).toMatch(/Authorization/);
  });
});
