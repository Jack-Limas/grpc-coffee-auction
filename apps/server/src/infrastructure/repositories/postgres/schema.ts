import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgSequence,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Database schema (Drizzle ORM). This is link #1 of the end-to-end type chain:
 *   Postgres table -> Drizzle inferred row type -> domain model -> Protobuf -> React
 * `typeof lots.$inferSelect` is derived from these definitions, so a renamed
 * column breaks the build instead of breaking production.
 */

export const lotStatusEnum = pgEnum("lot_status", ["SCHEDULED", "LIVE", "SOLD", "UNSOLD"]);
export const coffeeProcessEnum = pgEnum("coffee_process", [
  "WASHED",
  "NATURAL",
  "HONEY",
  "ANAEROBIC",
  "THERMAL_SHOCK",
]);
export const bidSourceEnum = pgEnum("bid_source", ["WEB", "BOT", "PROXY"]);

export const lotNumberSeq = pgSequence("lot_number_seq", { startWith: 1 });

export const lots = pgTable(
  "lots",
  {
    id: uuid("id").primaryKey(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    variety: text("variety").notNull(),
    process: coffeeProcessEnum("process").notNull(),
    farm: text("farm").notNull(),
    producer: text("producer").notNull(),
    region: text("region").notNull(),
    municipality: text("municipality").notNull(),
    altitudeMasl: integer("altitude_masl").notNull(),
    scaScore: doublePrecision("sca_score").notNull(),
    tastingNotes: text("tasting_notes").array().notNull(),
    cuppedBy: text("cupped_by").notNull(),
    weightLb: integer("weight_lb").notNull(),
    status: lotStatusEnum("status").notNull(),
    startingPriceCents: integer("starting_price_cents").notNull(),
    reservePriceCents: integer("reserve_price_cents").notNull(),
    currentPriceCents: integer("current_price_cents").notNull(),
    bidCount: integer("bid_count").notNull().default(0),
    leaderBidderId: uuid("leader_bidder_id"),
    leaderPaddle: text("leader_paddle"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    extensionCount: integer("extension_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("lots_status_idx").on(t.status), index("lots_leader_idx").on(t.leaderBidderId)],
);

export const bidders = pgTable(
  "bidders",
  {
    id: uuid("id").primaryKey(),
    paddleNo: serial("paddle_no").notNull(),
    displayName: text("display_name").notNull(),
    company: text("company").notNull(),
    country: text("country").notNull(),
    creditLimitCents: integer("credit_limit_cents").notNull(),
    isBot: boolean("is_bot").notNull().default(false),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("bidders_token_hash_idx").on(t.tokenHash)],
);

export const bids = pgTable(
  "bids",
  {
    id: uuid("id").primaryKey(),
    lotId: uuid("lot_id")
      .notNull()
      .references(() => lots.id, { onDelete: "cascade" }),
    bidderId: uuid("bidder_id")
      .notNull()
      .references(() => bidders.id),
    paddle: text("paddle").notNull(),
    amountCents: integer("amount_cents").notNull(),
    source: bidSourceEnum("source").notNull(),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull(),
    idempotencyKey: text("idempotency_key"),
  },
  (t) => [
    index("bids_lot_idx").on(t.lotId, t.placedAt),
    index("bids_placed_at_idx").on(t.placedAt),
    uniqueIndex("bids_idempotency_idx")
      .on(t.bidderId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
  ],
);

export const proxyBids = pgTable(
  "proxy_bids",
  {
    id: uuid("id").primaryKey(),
    lotId: uuid("lot_id")
      .notNull()
      .references(() => lots.id, { onDelete: "cascade" }),
    bidderId: uuid("bidder_id")
      .notNull()
      .references(() => bidders.id),
    paddle: text("paddle").notNull(),
    maxAmountCents: integer("max_amount_cents").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("proxy_bids_lot_idx").on(t.lotId, t.active)],
);

export type LotRow = typeof lots.$inferSelect;
export type BidRow = typeof bids.$inferSelect;
export type BidderRow = typeof bidders.$inferSelect;
export type ProxyBidRow = typeof proxyBids.$inferSelect;
