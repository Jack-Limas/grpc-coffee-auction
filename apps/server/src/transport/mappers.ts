import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  BidRejectionReason as PbRejectionReason,
  BidSchema,
  BidSource as PbBidSource,
  BidderSchema,
  CoffeeProcess as PbCoffeeProcess,
  LotEventSchema,
  LotSchema,
  LotStatus as PbLotStatus,
  type Bid as PbBid,
  type Bidder as PbBidder,
  type Lot as PbLot,
  type LotEvent as PbLotEvent,
} from "@cafe/contracts";
import type { AuctionEvent } from "../application/events";
import { minNextBid, reserveMet } from "../domain/auction-rules";
import type { BidRejectionReason } from "../domain/errors";
import type { Bid, Bidder, BidSource, CoffeeProcess, Lot, LotStatus } from "../domain/models";

/**
 * MAPPER layer: domain model <-> Protobuf messages.
 * The domain stays free of generated code, and secrets (reserve price,
 * bidder ids, token hashes) can never leak because they are simply not mapped.
 */

const LOT_STATUS: Record<LotStatus, PbLotStatus> = {
  SCHEDULED: PbLotStatus.SCHEDULED,
  LIVE: PbLotStatus.LIVE,
  SOLD: PbLotStatus.SOLD,
  UNSOLD: PbLotStatus.UNSOLD,
};

const FROM_PB_STATUS = new Map<PbLotStatus, LotStatus>(
  Object.entries(LOT_STATUS).map(([k, v]) => [v, k as LotStatus]),
);

const PROCESS: Record<CoffeeProcess, PbCoffeeProcess> = {
  WASHED: PbCoffeeProcess.WASHED,
  NATURAL: PbCoffeeProcess.NATURAL,
  HONEY: PbCoffeeProcess.HONEY,
  ANAEROBIC: PbCoffeeProcess.ANAEROBIC,
  THERMAL_SHOCK: PbCoffeeProcess.THERMAL_SHOCK,
};

const SOURCE: Record<BidSource, PbBidSource> = {
  WEB: PbBidSource.WEB,
  BOT: PbBidSource.BOT,
  PROXY: PbBidSource.PROXY,
};

export const REJECTION: Record<BidRejectionReason, PbRejectionReason> = {
  LOT_NOT_LIVE: PbRejectionReason.LOT_NOT_LIVE,
  BELOW_MINIMUM: PbRejectionReason.BELOW_MINIMUM,
  ALREADY_LEADING: PbRejectionReason.ALREADY_LEADING,
  CREDIT_LIMIT_EXCEEDED: PbRejectionReason.CREDIT_LIMIT_EXCEEDED,
  INVALID_PROXY_MAX: PbRejectionReason.INVALID_PROXY_MAX,
};

export function statusesFromProto(statuses: readonly PbLotStatus[]): LotStatus[] {
  return statuses.map((s) => FROM_PB_STATUS.get(s)).filter((s): s is LotStatus => s !== undefined);
}

export function toPbLot(lot: Lot): PbLot {
  return create(LotSchema, {
    id: lot.id,
    code: lot.code,
    name: lot.name,
    variety: lot.variety,
    process: PROCESS[lot.process],
    origin: { ...lot.origin },
    cupping: { ...lot.cupping, tastingNotes: [...lot.cupping.tastingNotes] },
    weightLb: lot.weightLb,
    status: LOT_STATUS[lot.status],
    startingPriceCents: lot.startingPriceCents,
    currentPriceCents: lot.currentPriceCents,
    minNextBidCents: minNextBid(lot),
    reserveMet: reserveMet(lot),
    bidCount: lot.bidCount,
    leadingPaddle: lot.leaderPaddle ?? "",
    startsAt: timestampFromDate(lot.startsAt),
    endsAt: timestampFromDate(lot.endsAt),
    extensionCount: lot.extensionCount,
  });
}

export function toPbBid(bid: Bid): PbBid {
  return create(BidSchema, {
    id: bid.id,
    lotId: bid.lotId,
    paddle: bid.paddle,
    amountCents: bid.amountCents,
    source: SOURCE[bid.source],
    placedAt: timestampFromDate(bid.placedAt),
  });
}

export function toPbBidder(bidder: Bidder, exposureCents: number): PbBidder {
  return create(BidderSchema, {
    id: bidder.id,
    paddle: bidder.paddle,
    displayName: bidder.displayName,
    company: bidder.company,
    country: bidder.country,
    creditLimitCents: bidder.creditLimitCents,
    exposureCents,
    isBot: bidder.isBot,
  });
}

export function toPbLotEvent(event: AuctionEvent): PbLotEvent {
  const lot = toPbLot(event.lot);
  switch (event.type) {
    case "bid_placed":
      return create(LotEventSchema, {
        lot,
        kind: {
          case: "bidPlaced",
          value: { bid: toPbBid(event.bid), previousLeadingPaddle: event.previousLeaderPaddle ?? "" },
        },
      });
    case "extended":
      return create(LotEventSchema, {
        lot,
        kind: {
          case: "extended",
          value: { previousEndsAt: timestampFromDate(event.previousEndsAt), extensionSeconds: event.extensionSeconds },
        },
      });
    case "opened":
    case "lot_listed":
      return create(LotEventSchema, { lot, kind: { case: "opened", value: {} } });
    case "closed":
      return create(LotEventSchema, {
        lot,
        kind: {
          case: "closed",
          value: {
            sold: event.sold,
            winningPaddle: event.sold ? (event.lot.leaderPaddle ?? "") : "",
            hammerPriceCents: event.sold ? event.lot.currentPriceCents : 0,
            totalValueCents: event.totalValueCents,
          },
        },
      });
  }
}

export function snapshotEvent(lot: Lot, recentBids: readonly Bid[]): PbLotEvent {
  return create(LotEventSchema, {
    lot: toPbLot(lot),
    kind: { case: "snapshot", value: { recentBids: recentBids.map(toPbBid) } },
  });
}
