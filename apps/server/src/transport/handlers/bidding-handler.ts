import { create } from "@bufbuild/protobuf";
import { timestampNow } from "@bufbuild/protobuf/wkt";
import type { HandlerContext, ServiceImpl } from "@connectrpc/connect";
import {
  BidderSessionResponseSchema,
  BiddingService as BiddingServiceDesc,
  WatchFloorResponseSchema,
  WatchLotResponseSchema,
  type BidderSessionRequest,
  type BidderSessionResponse,
  type PlaceBidRequest,
  type WatchFloorResponse,
  type WatchLotResponse,
} from "@cafe/contracts";
import type { BidderService } from "../../application/bidder-service";
import type { BiddingService } from "../../application/bidding-service";
import type { CatalogService } from "../../application/catalog-service";
import type { AuctionEvent } from "../../application/events";
import type { FloorStatsService, FloorStatsSnapshot } from "../../application/floor-stats";
import { BidRejectedError, DomainError } from "../../domain/errors";
import type { Bidder } from "../../domain/models";
import { AsyncQueue } from "../../infrastructure/async-queue";
import type { EventBus } from "../../infrastructure/event-bus";
import { toConnectError } from "../errors";
import { requireBidder } from "../interceptors";
import { REJECTION, snapshotEvent, toPbBid, toPbBidder, toPbLot, toPbLotEvent } from "../mappers";

export interface BiddingHandlerDeps {
  readonly bidding: BiddingService;
  readonly bidders: BidderService;
  readonly catalog: CatalogService;
  readonly bus: EventBus<AuctionEvent>;
  readonly stats: FloorStatsService;
  readonly heartbeatMs?: number;
}

/** Converts the protobuf request into the plain object the use case validates (Zod). */
function toBidInput(req: PlaceBidRequest) {
  return {
    lotId: req.lotId,
    amountCents: req.amountCents,
    maxAmountCents: req.maxAmountCents,
    idempotencyKey: req.idempotencyKey,
  };
}

const statsMessage = (s: FloorStatsSnapshot): WatchFloorResponse =>
  create(WatchFloorResponseSchema, {
    kind: {
      case: "stats",
      value: {
        liveLots: s.liveLots,
        bidsLastMinute: s.bidsLastMinute,
        connectedWatchers: s.connectedWatchers,
        totalSoldCents: BigInt(s.totalSoldCents),
      },
    },
  });

export function biddingHandler(deps: BiddingHandlerDeps): ServiceImpl<typeof BiddingServiceDesc> {
  const { bidding, bidders, catalog, bus, stats } = deps;
  const heartbeatMs = deps.heartbeatMs ?? 15_000;

  return {
    // ---------------------------------------------------------------- UNARY
    async placeBid(req, ctx) {
      const bidder = requireBidder(ctx);
      const outcome = await bidding.placeBid(bidder, toBidInput(req), "WEB");
      return {
        bid: outcome.bid ? toPbBid(outcome.bid) : undefined,
        lot: toPbLot(outcome.lot),
        isLeading: outcome.isLeading,
      };
    },

    // ----------------------------------------------------- SERVER STREAMING
    async *watchFloor(_req, ctx): AsyncGenerator<WatchFloorResponse> {
      const queue = new AsyncQueue<WatchFloorResponse>(ctx.signal);
      // Subscribe BEFORE reading the snapshot so no event can fall in the gap.
      const unsubscribeLots = bus.subscribe((event) =>
        queue.push(create(WatchFloorResponseSchema, { kind: { case: "lotEvent", value: toPbLotEvent(event) } })),
      );
      const unsubscribeStats = stats.updates.subscribe((s) => queue.push(statsMessage(s)));
      const heartbeat = setInterval(
        () => queue.push(create(WatchFloorResponseSchema, { kind: { case: "heartbeat", value: { serverTime: timestampNow() } } })),
        heartbeatMs,
      );
      stats.watcherJoined();
      try {
        const lots = await catalog.listLots([], 30);
        for (const lot of lots) {
          yield create(WatchFloorResponseSchema, { kind: { case: "lotEvent", value: snapshotEvent(lot, []) } });
        }
        yield statsMessage(stats.current());
        yield* queue;
      } finally {
        stats.watcherLeft();
        clearInterval(heartbeat);
        unsubscribeLots();
        unsubscribeStats();
      }
    },

    async *watchLot(req, ctx): AsyncGenerator<WatchLotResponse> {
      const queue = new AsyncQueue<WatchLotResponse>(ctx.signal);
      const unsubscribe = bus.subscribe((event) => {
        if (event.lot.id === req.lotId) queue.push(create(WatchLotResponseSchema, { event: toPbLotEvent(event) }));
      });
      try {
        const { lot, bids } = await catalog.getLot(req.lotId, 30);
        yield create(WatchLotResponseSchema, { event: snapshotEvent(lot, bids) });
        yield* queue;
      } finally {
        unsubscribe();
      }
    },

    // ----------------------------------------------------- CLIENT STREAMING
    async submitAbsenteeBook(requests, ctx) {
      const bidder = requireBidder(ctx);
      const results = [];
      for await (const item of requests) {
        results.push(await bidding.submitAbsenteeBid(bidder, { lotId: item.lotId, maxAmountCents: item.maxAmountCents }));
      }
      return {
        received: results.length,
        accepted: results.filter((r) => r.accepted).length,
        results,
      };
    },

    // ----------------------------------------------------------------- BIDI
    async *bidderSession(requests, ctx): AsyncGenerator<BidderSessionResponse> {
      const bidder = requireBidder(ctx);
      const out = new AsyncQueue<BidderSessionResponse>(ctx.signal);
      let subscription: Set<string> | "all" | null = null;

      const unsubscribe = bus.subscribe((event) => {
        if (subscription === null) return;
        if (subscription !== "all" && !subscription.has(event.lot.id)) return;
        out.push(create(BidderSessionResponseSchema, { event: { case: "lotEvent", value: toPbLotEvent(event) } }));
      });

      // Reads commands concurrently while events keep flowing out.
      const pump = (async () => {
        try {
          for await (const command of requests) {
            await handleCommand(command, bidder, ctx, out, (ids) => {
              subscription = ids.length === 0 ? "all" : new Set(ids);
            });
          }
          out.close(); // client half-closed: end the session gracefully
        } catch (error) {
          out.fail(toConnectError(error));
        }
      })();

      try {
        yield* out;
      } finally {
        unsubscribe();
        await pump.catch(() => undefined);
      }
    },
  };

  async function handleCommand(
    command: BidderSessionRequest,
    bidder: Bidder,
    _ctx: HandlerContext,
    out: AsyncQueue<BidderSessionResponse>,
    subscribe: (lotIds: readonly string[]) => void,
  ): Promise<void> {
    const correlationId = command.correlationId;
    switch (command.command.case) {
      case "subscribe": {
        subscribe(command.command.value.lotIds);
        const lots = await catalog.listLots(["LIVE", "SCHEDULED"], 50);
        for (const lot of lots) {
          out.push(create(BidderSessionResponseSchema, { correlationId, event: { case: "lotEvent", value: snapshotEvent(lot, []) } }));
        }
        return;
      }
      case "placeBid": {
        try {
          const outcome = await bidding.placeBid(bidder, toBidInput(command.command.value), "BOT");
          out.push(
            create(BidderSessionResponseSchema, {
              correlationId,
              event: { case: "bidResult", value: { accepted: true, bid: outcome.bid ? toPbBid(outcome.bid) : undefined, message: outcome.isLeading ? "Leading" : "Outbid by a proxy" } },
            }),
          );
        } catch (error) {
          if (!(error instanceof DomainError)) throw error;
          out.push(
            create(BidderSessionResponseSchema, {
              correlationId,
              event: {
                case: "bidResult",
                value: {
                  accepted: false,
                  message: error.message,
                  rejection:
                    error instanceof BidRejectedError
                      ? { reason: REJECTION[error.reason], minNextBidCents: error.minNextBidCents }
                      : undefined,
                },
              },
            }),
          );
        }
        const exposure = await bidders.exposureOf(bidder.id);
        out.push(create(BidderSessionResponseSchema, { correlationId, event: { case: "me", value: toPbBidder(bidder, exposure) } }));
        return;
      }
      case "ping":
        out.push(create(BidderSessionResponseSchema, { correlationId, event: { case: "pong", value: { serverTime: timestampNow() } } }));
        return;
      default:
        return;
    }
  }
}
