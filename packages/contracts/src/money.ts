/**
 * Money helpers shared by every layer (server, web, bots).
 *
 * All prices travel as integer US cents per pound. Never floats.
 */

/** A rung of the bid increment ladder (real auctions use tiered increments). */
export interface IncrementTier {
  /** Applies while the current price is strictly below this value (cents/lb). */
  readonly belowCents: number;
  /** Minimum raise over the current price (cents/lb). */
  readonly incrementCents: number;
}

/**
 * The increment ladder. It is shared so the UI can render "+1 step" buttons
 * that always agree with the server, but the SERVER is still the authority:
 * it returns `min_next_bid_cents` on every lot.
 */
export const INCREMENT_LADDER: readonly IncrementTier[] = Object.freeze([
  { belowCents: 1_000, incrementCents: 10 }, //  < $10.00/lb -> $0.10
  { belowCents: 2_500, incrementCents: 25 }, //  < $25.00/lb -> $0.25
  { belowCents: 5_000, incrementCents: 50 }, //  < $50.00/lb -> $0.50
  { belowCents: Number.POSITIVE_INFINITY, incrementCents: 100 }, // -> $1.00
]);

export function incrementFor(priceCents: number): number {
  const tier = INCREMENT_LADDER.find((t) => priceCents < t.belowCents);
  // The last tier is infinite, so `tier` is always defined.
  return tier!.incrementCents;
}

/** Next valid bid after `priceCents`, `steps` increments above it. */
export function nextBidCents(priceCents: number, steps = 1): number {
  let price = priceCents;
  for (let i = 0; i < steps; i++) price += incrementFor(price);
  return price;
}

/** 123456 -> "$1,234.56" */
export function formatUsd(cents: number | bigint): string {
  const value = Number(cents) / 100;
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Parses "12.35" or "$12.35" into 1235 cents. Returns NaN if invalid. */
export function parseUsdToCents(input: string): number {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return Number.NaN;
  const [whole = "0", fraction = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
