import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { createLot, DEMO_CATALOG } from "../src/application/demo-catalog";
import { applyBid } from "../src/domain/auction-rules";
import { DEFAULT_RULES } from "../src/domain/models";
import { PostgresAuctionRepository, type Db } from "../src/infrastructure/repositories/postgres/postgres-auction-repository";
import * as schema from "../src/infrastructure/repositories/postgres/schema";

/**
 * Runs the REAL Drizzle adapter and the REAL SQL migrations against an
 * embedded Postgres (PGlite, WebAssembly). No Docker, no cloud account.
 */
let repo: PostgresAuctionRepository;

beforeAll(async () => {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  repo = new PostgresAuctionRepository(db as unknown as Db);
});

describe("PostgresAuctionRepository", () => {
  it("round-trips lots, bidders, bids and proxies in one unit of work", async () => {
    const now = new Date();
    const lot = createLot(DEMO_CATALOG[0]!, await repo.nextLotNumber(), now, 60_000, now);
    await repo.insertLot(lot);

    const bidder = await repo.insertBidder({
      id: crypto.randomUUID(),
      displayName: "Ana",
      company: "Co",
      country: "CO",
      creditLimitCents: 1_000_000,
      isBot: false,
      tokenHash: "h1",
      createdAt: now,
    });
    expect(bidder.paddle).toBe("P-101");

    const { lot: updated } = applyBid(lot, bidder, lot.startingPriceCents, now, DEFAULT_RULES);
    await repo.commit({
      lot: updated,
      newBids: [
        { id: crypto.randomUUID(), lotId: lot.id, bidderId: bidder.id, paddle: bidder.paddle, amountCents: lot.startingPriceCents, source: "WEB", placedAt: now, idempotencyKey: "k1" },
      ],
      upsertProxies: [
        { id: crypto.randomUUID(), lotId: lot.id, bidderId: bidder.id, paddle: bidder.paddle, maxAmountCents: 5_000, active: true, createdAt: now },
      ],
      deactivateProxyIds: [],
    });

    const loaded = await repo.getLot(lot.id);
    expect(loaded?.leaderPaddle).toBe("P-101");
    expect(loaded?.cupping.tastingNotes).toEqual(lot.cupping.tastingNotes);
    expect(await repo.listBids(lot.id, 10)).toHaveLength(1);
    expect(await repo.findBidByIdempotencyKey(bidder.id, "k1")).not.toBeNull();
    expect(await repo.listActiveProxies(lot.id)).toHaveLength(1);
    expect(await repo.exposureFor(bidder.id)).toBe(lot.startingPriceCents * lot.weightLb);
    expect(await repo.exposureFor(bidder.id, lot.id)).toBe(0);
    expect((await repo.getBidderByTokenHash("h1"))?.id).toBe(bidder.id);
    expect(await repo.countLots(["LIVE"])).toBe(1);
    expect((await repo.listLots({ statuses: ["LIVE"] }))[0]?.id).toBe(lot.id);
  });
});
