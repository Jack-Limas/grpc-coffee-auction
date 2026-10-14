import type { Lot } from "@cafe/contracts";

/**
 * Bidding personas = STRATEGY pattern. Every bot shares the same plumbing
 * (gRPC session) and differs only in how it decides.
 */
export interface BidDecision {
  readonly amountCents: number;
  readonly maxAmountCents?: number;
}

export interface BidContext {
  readonly lot: Lot;
  /** How much this bot thinks the lot is worth (cents/lb). Private. */
  readonly valuationCents: number;
  readonly secondsLeft: number;
  readonly random: () => number;
}

export interface BiddingStrategy {
  readonly name: string;
  /** null = do nothing this time. */
  decide(ctx: BidContext): BidDecision | null;
}

/** Bids the minimum, often, while the price is comfortably below its valuation. */
export const steadyStrategy: BiddingStrategy = {
  name: "steady",
  decide: ({ lot, valuationCents, random }) => {
    if (lot.minNextBidCents > valuationCents * 0.9) return null;
    return random() < 0.35 ? { amountCents: lot.minNextBidCents } : null;
  },
};

/** Waits in silence and strikes in the last 25 seconds (and triggers anti-sniping). */
export const sniperStrategy: BiddingStrategy = {
  name: "sniper",
  decide: ({ lot, valuationCents, secondsLeft, random }) => {
    if (secondsLeft > 25 || secondsLeft <= 1) return null;
    if (lot.minNextBidCents > valuationCents) return null;
    return random() < 0.6 ? { amountCents: lot.minNextBidCents } : null;
  },
};

/** Only chases top-scoring coffees, and jumps two increments to scare others. */
export const connoisseurStrategy: BiddingStrategy = {
  name: "connoisseur",
  decide: ({ lot, valuationCents, random }) => {
    const score = lot.cupping?.scaScore ?? 0;
    if (score < 89) return null;
    const jump = lot.minNextBidCents + (lot.minNextBidCents - lot.currentPriceCents);
    if (jump > valuationCents) return null;
    return random() < 0.3 ? { amountCents: lot.bidCount === 0 ? lot.minNextBidCents : jump } : null;
  },
};

/** Places one proxy bid with its full valuation and lets the house do the rest. */
export const proxyStrategy: BiddingStrategy = {
  name: "proxy",
  decide: ({ lot, valuationCents, random }) => {
    if (lot.minNextBidCents > valuationCents * 0.95) return null;
    return random() < 0.2 ? { amountCents: lot.minNextBidCents, maxAmountCents: Math.round(valuationCents * 0.95) } : null;
  },
};

export interface Persona {
  readonly displayName: string;
  readonly company: string;
  readonly country: string;
  readonly strategy: BiddingStrategy;
  /** Multiplies the valuation: >1 = deeper pockets. */
  readonly appetite: number;
  /** Uses the client-streaming absentee book at startup. */
  readonly usesAbsenteeBook: boolean;
}

export const PERSONAS: readonly Persona[] = [
  { displayName: "Kenji", company: "Kyoto Roastworks", country: "Japan", strategy: connoisseurStrategy, appetite: 1.25, usesAbsenteeBook: false },
  { displayName: "Ingrid", company: "Nordic Bean Co.", country: "Norway", strategy: steadyStrategy, appetite: 1.0, usesAbsenteeBook: false },
  { displayName: "Lachlan", company: "Melbourne Cupping House", country: "Australia", strategy: sniperStrategy, appetite: 1.15, usesAbsenteeBook: false },
  { displayName: "Min-jun", company: "Seoul Origin Lab", country: "South Korea", strategy: proxyStrategy, appetite: 1.1, usesAbsenteeBook: true },
  { displayName: "Greta", company: "Berlin Third Wave", country: "Germany", strategy: steadyStrategy, appetite: 0.95, usesAbsenteeBook: false },
  { displayName: "Wei", company: "Shanghai Specialty Imports", country: "China", strategy: sniperStrategy, appetite: 1.05, usesAbsenteeBook: true },
  { displayName: "Chloé", company: "Maison Torréfaction", country: "France", strategy: connoisseurStrategy, appetite: 1.2, usesAbsenteeBook: false },
  { displayName: "Sam", company: "Portland Micro Roasters", country: "USA", strategy: proxyStrategy, appetite: 1.0, usesAbsenteeBook: false },
];

/** Deterministic private valuation per (bot, lot): starting price * [1.3, 2.1] * appetite. */
export function valuationFor(persona: Persona, lot: Lot): number {
  let hash = 2166136261;
  for (const ch of persona.company + lot.id) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  const unit = ((hash >>> 0) % 1000) / 1000;
  const scoreBoost = Math.max(0, (lot.cupping?.scaScore ?? 86) - 86) * 0.04;
  return Math.round(lot.startingPriceCents * (1.3 + unit * 0.8 + scoreBoost) * persona.appetite);
}
