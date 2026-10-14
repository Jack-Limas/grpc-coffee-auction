import { describe, expect, it } from "vitest";
import { applyBid } from "../src/domain/auction-rules";
import { DEFAULT_RULES } from "../src/domain/models";
import { resolveProxies } from "../src/domain/proxy-engine";
import { makeLot, makeProxy, T0 } from "./fixtures";

const always = () => true;

describe("proxy bidding engine", () => {
  it("does nothing without proxies", () => {
    const res = resolveProxies(makeLot(), [], T0, DEFAULT_RULES, always);
    expect(res.autoBids).toHaveLength(0);
  });

  it("answers a manual bid one increment above it, up to the max", () => {
    // B has a proxy up to $15.00. A bids $12.00 manually.
    const lot = applyBid(makeLot(), { id: "a", paddle: "P-a" }, 1_200, T0, DEFAULT_RULES).lot;
    const res = resolveProxies(lot, [makeProxy("b", 1_500)], T0, DEFAULT_RULES, always);
    expect(res.lot.leaderBidderId).toBe("b");
    expect(res.lot.currentPriceCents).toBe(1_225);
    expect(res.autoBids.map((b) => b.amountCents)).toEqual([1_225]);
  });

  it("lets the higher max win and pay one step over the other max", () => {
    // A leads at $10 with a max of $14; B's proxy goes up to $20.
    const lot = applyBid(makeLot(), { id: "a", paddle: "P-a" }, 1_000, T0, DEFAULT_RULES).lot;
    const res = resolveProxies(lot, [makeProxy("a", 1_400, 0), makeProxy("b", 2_000, 10)], T0, DEFAULT_RULES, always);
    expect(res.lot.leaderBidderId).toBe("b");
    expect(res.lot.currentPriceCents).toBe(1_425); // 14.00 + 0.25
    expect(res.exhaustedProxyIds).toContain("proxy-a");
  });

  it("lets the leader's proxy defend against a weaker challenger", () => {
    // A leads with max $20; B's proxy only reaches $14.
    const lot = applyBid(makeLot(), { id: "a", paddle: "P-a" }, 1_000, T0, DEFAULT_RULES).lot;
    const res = resolveProxies(lot, [makeProxy("a", 2_000, 0), makeProxy("b", 1_400, 10)], T0, DEFAULT_RULES, always);
    expect(res.lot.leaderBidderId).toBe("a");
    expect(res.autoBids.map((b) => [b.bidderId, b.amountCents])).toEqual([
      ["b", 1_400],
      ["a", 1_425],
    ]);
  });

  it("breaks ties in favour of the earlier proxy", () => {
    const lot = applyBid(makeLot(), { id: "a", paddle: "P-a" }, 1_000, T0, DEFAULT_RULES).lot;
    const res = resolveProxies(lot, [makeProxy("a", 1_500, 0), makeProxy("b", 1_500, 10)], T0, DEFAULT_RULES, always);
    expect(res.lot.leaderBidderId).toBe("a");
    expect(res.lot.currentPriceCents).toBe(1_500);
  });

  it("opens a lot between two waiting proxies at one step over the runner-up", () => {
    const res = resolveProxies(makeLot(), [makeProxy("a", 1_300, 0), makeProxy("b", 1_800, 10)], T0, DEFAULT_RULES, always);
    expect(res.lot.leaderBidderId).toBe("b");
    expect(res.lot.currentPriceCents).toBe(1_325);
  });

  it("skips proxies whose owner cannot afford the bid", () => {
    const lot = applyBid(makeLot(), { id: "a", paddle: "P-a" }, 1_200, T0, DEFAULT_RULES).lot;
    const res = resolveProxies(lot, [makeProxy("b", 1_500)], T0, DEFAULT_RULES, (id) => id !== "b");
    expect(res.lot.leaderBidderId).toBe("a");
    expect(res.exhaustedProxyIds).toContain("proxy-b");
  });

  it("always terminates in a three-way proxy war", () => {
    const lot = applyBid(makeLot(), { id: "x", paddle: "P-x" }, 1_000, T0, DEFAULT_RULES).lot;
    const res = resolveProxies(
      lot,
      [makeProxy("a", 3_000, 0), makeProxy("b", 4_200, 10), makeProxy("c", 3_900, 20)],
      T0,
      DEFAULT_RULES,
      always,
    );
    expect(res.lot.leaderBidderId).toBe("b");
    expect(res.lot.currentPriceCents).toBe(3_950); // one step over C's $39.00
  });
});
