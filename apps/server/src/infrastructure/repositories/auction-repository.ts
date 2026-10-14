import type { Bid, Bidder, Lot, LotStatus, ProxyBid } from "../../domain/models";

/**
 * REPOSITORY PORT (Hexagonal architecture / Ports & Adapters).
 *
 * The application layer only knows this interface. Two adapters implement it:
 *   - InMemoryAuctionRepository  -> zero setup, local dev and tests
 *   - PostgresAuctionRepository  -> Drizzle ORM + Postgres (Neon in the cloud)
 */

export interface NewBidder {
  readonly id: string;
  readonly displayName: string;
  readonly company: string;
  readonly country: string;
  readonly creditLimitCents: number;
  readonly isBot: boolean;
  readonly tokenHash: string;
  readonly createdAt: Date;
}

/** Everything that changes atomically when a lot changes (Unit of Work). */
export interface LotChange {
  readonly lot: Lot;
  readonly newBids: readonly Bid[];
  readonly upsertProxies: readonly ProxyBid[];
  readonly deactivateProxyIds: readonly string[];
}

export interface ListLotsQuery {
  readonly statuses?: readonly LotStatus[];
  readonly limit?: number;
}

export interface AuctionRepository {
  // Lots
  insertLot(lot: Lot): Promise<void>;
  getLot(id: string): Promise<Lot | null>;
  /** Ordered: live first (ending soonest), then scheduled, then recently closed. */
  listLots(query?: ListLotsQuery): Promise<Lot[]>;
  countLots(statuses: readonly LotStatus[]): Promise<number>;
  nextLotNumber(): Promise<number>;

  // Bids
  listBids(lotId: string, limit: number): Promise<Bid[]>;
  findBidByIdempotencyKey(bidderId: string, key: string): Promise<Bid | null>;
  countBidsSince(since: Date): Promise<number>;

  // Bidders
  insertBidder(bidder: NewBidder): Promise<Bidder>;
  getBidder(id: string): Promise<Bidder | null>;
  getBidderByTokenHash(tokenHash: string): Promise<Bidder | null>;
  /** Sum of price * weight over LIVE lots the bidder leads, optionally excluding one. */
  exposureFor(bidderId: string, excludeLotId?: string): Promise<number>;

  // Proxy bids
  listActiveProxies(lotId: string): Promise<ProxyBid[]>;

  // Unit of work
  commit(change: LotChange): Promise<void>;
  totalSoldCents(): Promise<number>;
}
