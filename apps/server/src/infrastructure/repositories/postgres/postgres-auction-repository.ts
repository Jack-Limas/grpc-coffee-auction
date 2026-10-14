import { and, asc, count, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { Bid, Bidder, Lot, LotStatus, ProxyBid } from "../../../domain/models";
import type { AuctionRepository, ListLotsQuery, LotChange, NewBidder } from "../auction-repository";
import * as schema from "./schema";
import { bidders, bids, lots, proxyBids } from "./schema";

// Works with node-postgres (production) and PGlite (tests): both are PgDatabase.
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Adapter #2: Postgres through Drizzle ORM. */
export class PostgresAuctionRepository implements AuctionRepository {
  constructor(private readonly db: Db) {}

  async insertLot(lot: Lot): Promise<void> {
    await this.db.insert(lots).values(toLotRow(lot));
  }

  async getLot(id: string): Promise<Lot | null> {
    const [row] = await this.db.select().from(lots).where(eq(lots.id, id)).limit(1);
    return row ? toLot(row) : null;
  }

  async listLots(query: ListLotsQuery = {}): Promise<Lot[]> {
    const where = query.statuses?.length ? inArray(lots.status, [...query.statuses]) : undefined;
    const rows = await this.db
      .select()
      .from(lots)
      .where(where)
      .orderBy(
        sql`case ${lots.status} when 'LIVE' then 0 when 'SCHEDULED' then 1 else 2 end`,
        sql`case when ${lots.status} = 'LIVE' then ${lots.endsAt} end asc`,
        sql`case when ${lots.status} = 'SCHEDULED' then ${lots.startsAt} end asc`,
        desc(lots.endsAt),
      )
      .limit(query.limit ?? 100);
    return rows.map(toLot);
  }

  async countLots(statuses: readonly LotStatus[]): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(lots)
      .where(inArray(lots.status, [...statuses]));
    return row?.value ?? 0;
  }

  async nextLotNumber(): Promise<number> {
    const result = await this.db.execute<{ value: string | number }>(
      sql`select nextval('lot_number_seq') as value`,
    );
    const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as {
      value: string | number;
    }[];
    return Number(rows[0]?.value);
  }

  async listBids(lotId: string, limit: number): Promise<Bid[]> {
    const rows = await this.db
      .select()
      .from(bids)
      .where(eq(bids.lotId, lotId))
      .orderBy(desc(bids.placedAt), desc(bids.amountCents))
      .limit(limit);
    return rows.map(toBid);
  }

  async findBidByIdempotencyKey(bidderId: string, key: string): Promise<Bid | null> {
    const [row] = await this.db
      .select()
      .from(bids)
      .where(and(eq(bids.bidderId, bidderId), eq(bids.idempotencyKey, key)))
      .limit(1);
    return row ? toBid(row) : null;
  }

  async countBidsSince(since: Date): Promise<number> {
    const [row] = await this.db.select({ value: count() }).from(bids).where(gte(bids.placedAt, since));
    return row?.value ?? 0;
  }

  async insertBidder(input: NewBidder): Promise<Bidder> {
    const [row] = await this.db.insert(bidders).values(input).returning();
    if (!row) throw new Error("Failed to insert bidder");
    return toBidder(row);
  }

  async getBidder(id: string): Promise<Bidder | null> {
    const [row] = await this.db.select().from(bidders).where(eq(bidders.id, id)).limit(1);
    return row ? toBidder(row) : null;
  }

  async getBidderByTokenHash(tokenHash: string): Promise<Bidder | null> {
    const [row] = await this.db.select().from(bidders).where(eq(bidders.tokenHash, tokenHash)).limit(1);
    return row ? toBidder(row) : null;
  }

  async exposureFor(bidderId: string, excludeLotId?: string): Promise<number> {
    const conditions = [eq(lots.status, "LIVE"), eq(lots.leaderBidderId, bidderId)];
    if (excludeLotId) conditions.push(ne(lots.id, excludeLotId));
    const [row] = await this.db
      .select({ value: sql<string | null>`sum(${lots.currentPriceCents} * ${lots.weightLb})` })
      .from(lots)
      .where(and(...conditions));
    return Number(row?.value ?? 0);
  }

  async listActiveProxies(lotId: string): Promise<ProxyBid[]> {
    const rows = await this.db
      .select()
      .from(proxyBids)
      .where(and(eq(proxyBids.lotId, lotId), eq(proxyBids.active, true)))
      .orderBy(asc(proxyBids.createdAt));
    return rows.map(toProxy);
  }

  /** Unit of Work: lot + bids + proxies are saved in ONE transaction. */
  async commit(change: LotChange): Promise<void> {
    await this.db.transaction(async (tx) => {
      const { id, ...rest } = toLotRow(change.lot);
      await tx.update(lots).set(rest).where(eq(lots.id, id));
      if (change.newBids.length > 0) await tx.insert(bids).values(change.newBids.map(toBidRow));
      for (const proxy of change.upsertProxies) {
        await tx
          .insert(proxyBids)
          .values(proxy)
          .onConflictDoUpdate({
            target: proxyBids.id,
            set: { maxAmountCents: proxy.maxAmountCents, active: proxy.active },
          });
      }
      if (change.deactivateProxyIds.length > 0) {
        await tx
          .update(proxyBids)
          .set({ active: false })
          .where(inArray(proxyBids.id, [...change.deactivateProxyIds]));
      }
    });
  }

  async totalSoldCents(): Promise<number> {
    const [row] = await this.db
      .select({ value: sql<string | null>`sum(${lots.currentPriceCents}::bigint * ${lots.weightLb})` })
      .from(lots)
      .where(eq(lots.status, "SOLD"));
    return Number(row?.value ?? 0);
  }
}

// ---------------------------------------------------------------------------
// Row <-> domain mappers
// ---------------------------------------------------------------------------

function toLotRow(lot: Lot): typeof lots.$inferInsert {
  return {
    id: lot.id,
    code: lot.code,
    name: lot.name,
    variety: lot.variety,
    process: lot.process,
    farm: lot.origin.farm,
    producer: lot.origin.producer,
    region: lot.origin.region,
    municipality: lot.origin.municipality,
    altitudeMasl: lot.origin.altitudeMasl,
    scaScore: lot.cupping.scaScore,
    tastingNotes: [...lot.cupping.tastingNotes],
    cuppedBy: lot.cupping.cuppedBy,
    weightLb: lot.weightLb,
    status: lot.status,
    startingPriceCents: lot.startingPriceCents,
    reservePriceCents: lot.reservePriceCents,
    currentPriceCents: lot.currentPriceCents,
    bidCount: lot.bidCount,
    leaderBidderId: lot.leaderBidderId,
    leaderPaddle: lot.leaderPaddle,
    startsAt: lot.startsAt,
    endsAt: lot.endsAt,
    extensionCount: lot.extensionCount,
    createdAt: lot.createdAt,
  };
}

function toLot(row: schema.LotRow): Lot {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    variety: row.variety,
    process: row.process,
    origin: {
      farm: row.farm,
      producer: row.producer,
      region: row.region,
      municipality: row.municipality,
      altitudeMasl: row.altitudeMasl,
    },
    cupping: { scaScore: row.scaScore, tastingNotes: row.tastingNotes, cuppedBy: row.cuppedBy },
    weightLb: row.weightLb,
    status: row.status,
    startingPriceCents: row.startingPriceCents,
    reservePriceCents: row.reservePriceCents,
    currentPriceCents: row.currentPriceCents,
    bidCount: row.bidCount,
    leaderBidderId: row.leaderBidderId,
    leaderPaddle: row.leaderPaddle,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    extensionCount: row.extensionCount,
    createdAt: row.createdAt,
  };
}

function toBidRow(bid: Bid): typeof bids.$inferInsert {
  return { ...bid };
}

function toBid(row: schema.BidRow): Bid {
  return { ...row };
}

function toBidder(row: schema.BidderRow): Bidder {
  const { paddleNo, ...rest } = row;
  return { ...rest, paddle: `P-${100 + paddleNo}` };
}

function toProxy(row: schema.ProxyBidRow): ProxyBid {
  return { ...row };
}
