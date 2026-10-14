import { describe, expect, it } from "vitest";
import { incrementFor, nextBidCents, parseUsdToCents } from "@cafe/contracts";
import { applyBid, assertBidAllowed, closeLot, minNextBid, reserveMet } from "../src/domain/auction-rules";
import { BidRejectedError } from "../src/domain/errors";
import { DEFAULT_RULES } from "../src/domain/models";
import { makeBidder, makeLot, T0 } from "./fixtures";

const rejectReason = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof BidRejectedError) return e.reason;
    throw e;
  }
  return "ACCEPTED";
};

describe("increment ladder", () => {
  it("uses tiered increments", () => {
    expect(incrementFor(999)).toBe(10);
    expect(incrementFor(1_000)).toBe(25);
    expect(incrementFor(2_500)).toBe(50);
    expect(incrementFor(5_000)).toBe(100);
    expect(nextBidCents(2_475, 2)).toBe(2_550); // 2475 -> 2500 (+25) -> 2550 (+50)
  });

  it("parses dollars safely into integer cents", () => {
    expect(parseUsdToCents("$12.5")).toBe(1_250);
    expect(parseUsdToCents("7")).toBe(700);
    expect(parseUsdToCents("1.234")).toBeNaN();
  });
});

describe("bid validation", () => {
  const bidder = makeBidder("a");

  it("lets the first bid match the starting price", () => {
    const lot = makeLot();
    expect(minNextBid(lot)).toBe(1_000);
    expect(rejectReason(() => assertBidAllowed({ lot, bidder, amountCents: 1_000, exposureElsewhereCents: 0, now: T0 }))).toBe("ACCEPTED");
  });

  it("requires one increment over the current price afterwards", () => {
    const lot = makeLot({ bidCount: 1, currentPriceCents: 1_200, leaderBidderId: "b" });
    expect(minNextBid(lot)).toBe(1_225);
    expect(rejectReason(() => assertBidAllowed({ lot, bidder, amountCents: 1_210, exposureElsewhereCents: 0, now: T0 }))).toBe("BELOW_MINIMUM");
  });

  it("rejects bids on lots that are not live or already ended", () => {
    expect(rejectReason(() => assertBidAllowed({ lot: makeLot({ status: "SCHEDULED" }), bidder, amountCents: 1_000, exposureElsewhereCents: 0, now: T0 }))).toBe("LOT_NOT_LIVE");
    expect(rejectReason(() => assertBidAllowed({ lot: makeLot({ endsAt: T0 }), bidder, amountCents: 1_000, exposureElsewhereCents: 0, now: T0 }))).toBe("LOT_NOT_LIVE");
  });

  it("does not let the leader outbid themselves", () => {
    const lot = makeLot({ bidCount: 1, leaderBidderId: "a" });
    expect(rejectReason(() => assertBidAllowed({ lot, bidder, amountCents: 5_000, exposureElsewhereCents: 0, now: T0 }))).toBe("ALREADY_LEADING");
  });

  it("enforces the credit line across all lots", () => {
    const poor = makeBidder("p", { creditLimitCents: 150_000 }); // $1,500
    const lot = makeLot(); // 100 lb * $10 = $1,000
    expect(rejectReason(() => assertBidAllowed({ lot, bidder: poor, amountCents: 1_000, exposureElsewhereCents: 0, now: T0 }))).toBe("ACCEPTED");
    expect(rejectReason(() => assertBidAllowed({ lot, bidder: poor, amountCents: 1_000, exposureElsewhereCents: 60_000, now: T0 }))).toBe("CREDIT_LIMIT_EXCEEDED");
  });
});

describe("anti-sniping (soft close)", () => {
  const bidder = { id: "a", paddle: "P-1" };

  it("extends the lot when a bid lands in the last 30 seconds", () => {
    const lot = makeLot({ endsAt: new Date(T0.getTime() + 10_000) });
    const { lot: after, extendedFrom } = applyBid(lot, bidder, 1_000, T0, DEFAULT_RULES);
    expect(extendedFrom).toEqual(lot.endsAt);
    expect(after.endsAt.getTime()).toBe(T0.getTime() + 30_000);
    expect(after.extensionCount).toBe(1);
  });

  it("does not extend when there is plenty of time left", () => {
    const { extendedFrom } = applyBid(makeLot(), bidder, 1_000, T0, DEFAULT_RULES);
    expect(extendedFrom).toBeNull();
  });

  it("stops extending after the maximum number of extensions", () => {
    const lot = makeLot({ endsAt: new Date(T0.getTime() + 5_000), extensionCount: DEFAULT_RULES.maxExtensions });
    expect(applyBid(lot, bidder, 1_000, T0, DEFAULT_RULES).extendedFrom).toBeNull();
  });
});

describe("closing", () => {
  it("sells only when the secret reserve is met", () => {
    const below = makeLot({ bidCount: 3, currentPriceCents: 1_400, leaderBidderId: "a", leaderPaddle: "P-1" });
    const above = makeLot({ bidCount: 5, currentPriceCents: 1_500, leaderBidderId: "a", leaderPaddle: "P-1" });
    expect(reserveMet(below)).toBe(false);
    expect(closeLot(below)).toMatchObject({ sold: false, totalValueCents: 0, lot: { status: "UNSOLD" } });
    expect(closeLot(above)).toMatchObject({ sold: true, totalValueCents: 150_000, lot: { status: "SOLD" } });
  });

  it("is unsold when nobody bid", () => {
    expect(closeLot(makeLot()).sold).toBe(false);
  });
});
