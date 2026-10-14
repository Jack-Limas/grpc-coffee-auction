import type { Bidder, Lot, ProxyBid } from "../src/domain/models";

export const T0 = new Date("2026-01-01T12:00:00Z");

export function makeLot(overrides: Partial<Lot> = {}): Lot {
  return {
    id: "lot-1",
    code: "CS-0001",
    name: "Test Geisha",
    variety: "Geisha",
    process: "WASHED",
    origin: { farm: "F", producer: "P", region: "Huila", municipality: "Pitalito", altitudeMasl: 1900 },
    cupping: { scaScore: 90, tastingNotes: ["jasmine"], cuppedBy: "Q" },
    weightLb: 100,
    status: "LIVE",
    startingPriceCents: 1_000,
    reservePriceCents: 1_500,
    currentPriceCents: 1_000,
    bidCount: 0,
    leaderBidderId: null,
    leaderPaddle: null,
    startsAt: new Date(T0.getTime() - 60_000),
    endsAt: new Date(T0.getTime() + 5 * 60_000),
    extensionCount: 0,
    createdAt: T0,
    ...overrides,
  };
}

export function makeBidder(id: string, overrides: Partial<Bidder> = {}): Bidder {
  return {
    id,
    paddle: `P-${id}`,
    displayName: id,
    company: "Co",
    country: "CO",
    creditLimitCents: 10_000_000,
    isBot: false,
    tokenHash: `hash-${id}`,
    createdAt: T0,
    ...overrides,
  };
}

export function makeProxy(bidderId: string, max: number, createdOffsetMs = 0): ProxyBid {
  return {
    id: `proxy-${bidderId}`,
    lotId: "lot-1",
    bidderId,
    paddle: `P-${bidderId}`,
    maxAmountCents: max,
    active: true,
    createdAt: new Date(T0.getTime() + createdOffsetMs),
  };
}
