/**
 * Domain model. Plain, immutable-by-convention data. No framework, no I/O.
 * The transport layer maps these to Protobuf messages (see transport/mappers.ts)
 * and the persistence layer maps them to rows (see infrastructure/repositories).
 */

export type LotStatus = "SCHEDULED" | "LIVE" | "SOLD" | "UNSOLD";

export type CoffeeProcess = "WASHED" | "NATURAL" | "HONEY" | "ANAEROBIC" | "THERMAL_SHOCK";

export type BidSource = "WEB" | "BOT" | "PROXY";

export interface Origin {
  readonly farm: string;
  readonly producer: string;
  readonly region: string;
  readonly municipality: string;
  readonly altitudeMasl: number;
}

export interface Cupping {
  readonly scaScore: number;
  readonly tastingNotes: readonly string[];
  readonly cuppedBy: string;
}

export interface Lot {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly variety: string;
  readonly process: CoffeeProcess;
  readonly origin: Origin;
  readonly cupping: Cupping;
  readonly weightLb: number;

  readonly status: LotStatus;
  readonly startingPriceCents: number;
  /** Secret. Never leaves the server. */
  readonly reservePriceCents: number;
  readonly currentPriceCents: number;
  readonly bidCount: number;
  readonly leaderBidderId: string | null;
  readonly leaderPaddle: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly extensionCount: number;
  readonly createdAt: Date;
}

export interface Bid {
  readonly id: string;
  readonly lotId: string;
  readonly bidderId: string;
  readonly paddle: string;
  readonly amountCents: number;
  readonly source: BidSource;
  readonly placedAt: Date;
  readonly idempotencyKey: string | null;
}

export interface Bidder {
  readonly id: string;
  readonly paddle: string;
  readonly displayName: string;
  readonly company: string;
  readonly country: string;
  readonly creditLimitCents: number;
  readonly isBot: boolean;
  readonly tokenHash: string;
  readonly createdAt: Date;
}

/** A standing instruction: "bid for me, one step at a time, up to max". */
export interface ProxyBid {
  readonly id: string;
  readonly lotId: string;
  readonly bidderId: string;
  readonly paddle: string;
  readonly maxAmountCents: number;
  readonly active: boolean;
  readonly createdAt: Date;
}

/** Tunable auction house rules (injected, so tests can change them). */
export interface AuctionRules {
  /** If a bid lands with less than this left, the lot is extended. */
  readonly antiSnipingWindowMs: number;
  /** The lot's end time becomes `now + extensionMs`. */
  readonly extensionMs: number;
  /** Safety cap so a bidding war cannot run forever. */
  readonly maxExtensions: number;
}

export const DEFAULT_RULES: AuctionRules = Object.freeze({
  antiSnipingWindowMs: 30_000,
  extensionMs: 30_000,
  maxExtensions: 20,
});

export const lotTotalCents = (pricePerLbCents: number, weightLb: number): number =>
  pricePerLbCents * weightLb;
