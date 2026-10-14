import { nextBidCents } from "@cafe/contracts";
import { applyBid, minNextBid } from "./auction-rules";
import type { AuctionRules, Lot, ProxyBid } from "./models";

/**
 * PROXY BIDDING ENGINE (a.k.a. automatic bidding, like eBay).
 *
 * A buyer leaves a secret maximum. Whenever someone outbids them, the house
 * bids on their behalf the smallest amount needed to lead again, never
 * exceeding their maximum. When two proxies compete, the higher maximum
 * wins and pays one increment over the other one's maximum. Ties go to the
 * proxy that was registered first.
 *
 * Pure function: receives the state, returns the auto bids to record.
 */

export interface AutoBid {
  readonly bidderId: string;
  readonly paddle: string;
  readonly amountCents: number;
  readonly extendedFrom: Date | null;
}

export interface ProxyResolution {
  readonly lot: Lot;
  readonly autoBids: readonly AutoBid[];
  /** Proxies that can no longer win (max too low or not affordable). */
  readonly exhaustedProxyIds: readonly string[];
}

export type AffordCheck = (bidderId: string, amountCents: number) => boolean;

const MAX_ROUNDS = 1_000;

export function resolveProxies(
  initialLot: Lot,
  proxies: readonly ProxyBid[],
  now: Date,
  rules: AuctionRules,
  canAfford: AffordCheck,
): ProxyResolution {
  let lot = initialLot;
  const autoBids: AutoBid[] = [];
  const exhausted = new Set<string>();
  const active = () => proxies.filter((p) => p.active && !exhausted.has(p.id));

  const record = (proxy: ProxyBid, amountCents: number) => {
    const applied = applyBid(lot, { id: proxy.bidderId, paddle: proxy.paddle }, amountCents, now, rules);
    lot = applied.lot;
    autoBids.push({
      bidderId: proxy.bidderId,
      paddle: proxy.paddle,
      amountCents,
      extendedFrom: applied.extendedFrom,
    });
  };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const minimum = minNextBid(lot);
    const leaderProxy = active().find((p) => p.bidderId === lot.leaderBidderId) ?? null;

    // Challengers: proxies of anyone except the current leader that can still bid.
    const challengers = active()
      .filter((p) => p.bidderId !== lot.leaderBidderId)
      .filter((p) => {
        const usable = p.maxAmountCents >= minimum && canAfford(p.bidderId, minimum);
        if (!usable) exhausted.add(p.id);
        return usable;
      })
      .sort((a, b) => b.maxAmountCents - a.maxAmountCents || a.createdAt.getTime() - b.createdAt.getTime());

    const best = challengers[0];
    if (!best) break;

    // Nobody leads yet (lot just opened): the best proxy opens at the minimum,
    // or one step above the runner-up's max if there is competition.
    if (lot.leaderBidderId === null) {
      const runnerUp = challengers[1];
      if (!runnerUp) {
        record(best, minimum);
        continue;
      }
      exhausted.add(runnerUp.id);
      if (runnerUp.maxAmountCents < best.maxAmountCents) {
        if (canAfford(runnerUp.bidderId, runnerUp.maxAmountCents)) {
          record(runnerUp, runnerUp.maxAmountCents);
        }
        // Winner pays one step above the runner-up, never more than its own max.
        const price = Math.min(best.maxAmountCents, nextBidCents(runnerUp.maxAmountCents));
        if (price > lot.currentPriceCents || lot.bidCount === 0) {
          if (canAfford(best.bidderId, price)) record(best, price);
          else exhausted.add(best.id);
        }
      } else if (canAfford(best.bidderId, best.maxAmountCents)) {
        // Exact tie: the earlier proxy (sorted first) takes it at the max.
        record(best, best.maxAmountCents);
      }
      continue;
    }

    const leaderMax = leaderProxy?.maxAmountCents ?? lot.currentPriceCents;
    const challengerWins =
      best.maxAmountCents > leaderMax ||
      (leaderProxy !== null &&
        best.maxAmountCents === leaderMax &&
        best.createdAt.getTime() < leaderProxy.createdAt.getTime());

    if (challengerWins) {
      // Smallest price that beats the leader's max, capped by the challenger's max.
      const target = leaderProxy ? nextBidCents(leaderMax) : minimum;
      const price = Math.max(minimum, Math.min(best.maxAmountCents, target));
      if (!canAfford(best.bidderId, price)) {
        exhausted.add(best.id);
        continue;
      }
      if (leaderProxy) exhausted.add(leaderProxy.id);
      record(best, price);
      continue;
    }

    // The leader's proxy defends. The challenger shows its max, the leader
    // answers one step above it (or matches it when the tie is theirs).
    exhausted.add(best.id);
    if (!leaderProxy) continue; // unreachable: without a proxy the leader cannot defend
    if (best.maxAmountCents < leaderMax) {
      if (!canAfford(best.bidderId, best.maxAmountCents)) continue;
      record(best, best.maxAmountCents);
      const answer = Math.min(leaderMax, nextBidCents(best.maxAmountCents));
      if (canAfford(leaderProxy.bidderId, answer)) record(leaderProxy, answer);
    } else if (best.maxAmountCents > lot.currentPriceCents) {
      // Exact tie and the leader registered first: the leader matches the max.
      if (canAfford(leaderProxy.bidderId, best.maxAmountCents)) record(leaderProxy, best.maxAmountCents);
    }
  }

  // Anyone who is not leading and cannot beat the final price is done.
  const finalMinimum = minNextBid(lot);
  for (const p of active()) {
    if (p.bidderId !== lot.leaderBidderId && p.maxAmountCents < finalMinimum) exhausted.add(p.id);
  }

  return { lot, autoBids, exhaustedProxyIds: [...exhausted] };
}
