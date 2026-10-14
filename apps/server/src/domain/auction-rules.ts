import { formatUsd, nextBidCents } from "@cafe/contracts";
import { BidRejectedError } from "./errors";
import { lotTotalCents, type AuctionRules, type Bidder, type Lot } from "./models";

/**
 * The auction house business rules, as PURE functions:
 * same input -> same output, no clock, no database, no network.
 * That is what makes them trivial to unit test (see test/auction-rules.test.ts).
 */

/** The lowest amount the next bid may have (cents per lb). */
export function minNextBid(lot: Lot): number {
  // The very first bid may be placed at the starting price.
  return lot.bidCount === 0 ? lot.startingPriceCents : nextBidCents(lot.currentPriceCents);
}

export function isAcceptingBids(lot: Lot, now: Date): boolean {
  return lot.status === "LIVE" && now >= lot.startsAt && now < lot.endsAt;
}

export function reserveMet(lot: Lot): boolean {
  return lot.bidCount > 0 && lot.currentPriceCents >= lot.reservePriceCents;
}

export interface BidCheck {
  readonly lot: Lot;
  readonly bidder: Bidder;
  readonly amountCents: number;
  /** Total committed by this bidder on OTHER live lots they are leading. */
  readonly exposureElsewhereCents: number;
  readonly now: Date;
}

/** Throws BidRejectedError when a manual bid breaks any rule. */
export function assertBidAllowed(check: BidCheck): void {
  const { lot, bidder, amountCents, now } = check;
  const minimum = minNextBid(lot);

  if (!isAcceptingBids(lot, now)) {
    throw new BidRejectedError("LOT_NOT_LIVE", `Lot ${lot.code} is not accepting bids`, minimum);
  }
  if (lot.leaderBidderId === bidder.id) {
    throw new BidRejectedError(
      "ALREADY_LEADING",
      "You are already the highest bidder on this lot",
      minimum,
    );
  }
  if (amountCents < minimum) {
    throw new BidRejectedError(
      "BELOW_MINIMUM",
      `The minimum bid is ${formatUsd(minimum)}/lb`,
      minimum,
    );
  }
  assertCredit(check.bidder, check.exposureElsewhereCents, amountCents, lot, minimum);
}

/** A bidder may never have more money committed than their credit line. */
export function assertCredit(
  bidder: Bidder,
  exposureElsewhereCents: number,
  amountCents: number,
  lot: Lot,
  minimum: number,
): void {
  if (!canAfford(bidder, exposureElsewhereCents, amountCents, lot)) {
    const available = bidder.creditLimitCents - exposureElsewhereCents;
    throw new BidRejectedError(
      "CREDIT_LIMIT_EXCEEDED",
      `This bid commits ${formatUsd(lotTotalCents(amountCents, lot.weightLb))} ` +
        `but only ${formatUsd(Math.max(0, available))} of credit is available`,
      minimum,
    );
  }
}

export function canAfford(
  bidder: Bidder,
  exposureElsewhereCents: number,
  amountCents: number,
  lot: Lot,
): boolean {
  return exposureElsewhereCents + lotTotalCents(amountCents, lot.weightLb) <= bidder.creditLimitCents;
}

export interface AppliedBid {
  readonly lot: Lot;
  /** Set when the anti-sniping rule extended the lot. */
  readonly extendedFrom: Date | null;
}

/**
 * Applies an ALREADY VALIDATED bid and the anti-sniping (soft close) rule:
 * a bid in the last `antiSnipingWindowMs` pushes the end to now + extensionMs.
 */
export function applyBid(
  lot: Lot,
  bidder: { id: string; paddle: string },
  amountCents: number,
  now: Date,
  rules: AuctionRules,
): AppliedBid {
  const remainingMs = lot.endsAt.getTime() - now.getTime();
  const shouldExtend =
    remainingMs < rules.antiSnipingWindowMs && lot.extensionCount < rules.maxExtensions;

  const endsAt = shouldExtend ? new Date(now.getTime() + rules.extensionMs) : lot.endsAt;

  return {
    lot: {
      ...lot,
      currentPriceCents: amountCents,
      bidCount: lot.bidCount + 1,
      leaderBidderId: bidder.id,
      leaderPaddle: bidder.paddle,
      endsAt,
      extensionCount: shouldExtend ? lot.extensionCount + 1 : lot.extensionCount,
    },
    extendedFrom: shouldExtend ? lot.endsAt : null,
  };
}

export function openLot(lot: Lot): Lot {
  return { ...lot, status: "LIVE" };
}

export interface ClosedLot {
  readonly lot: Lot;
  readonly sold: boolean;
  readonly totalValueCents: number;
}

/** Hammer time: sold only if somebody bid AND the secret reserve was met. */
export function closeLot(lot: Lot): ClosedLot {
  const sold = lot.leaderBidderId !== null && reserveMet(lot);
  return {
    lot: { ...lot, status: sold ? "SOLD" : "UNSOLD" },
    sold,
    totalValueCents: sold ? lotTotalCents(lot.currentPriceCents, lot.weightLb) : 0,
  };
}
