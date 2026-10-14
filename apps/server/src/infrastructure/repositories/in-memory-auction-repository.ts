import { lotTotalCents, type Bid, type Bidder, type Lot, type ProxyBid } from "../../domain/models";
import type {
  AuctionRepository,
  ListLotsQuery,
  LotChange,
  NewBidder,
} from "./auction-repository";
import { sortLotsForFloor } from "./lot-ordering";

/** Adapter #1: everything in memory. Perfect for development and tests. */
export class InMemoryAuctionRepository implements AuctionRepository {
  private readonly lots = new Map<string, Lot>();
  private readonly bids: Bid[] = [];
  private readonly bidders = new Map<string, Bidder>();
  private readonly proxies = new Map<string, ProxyBid>();
  private lotSequence = 0;
  private paddleSequence = 100;

  async insertLot(lot: Lot): Promise<void> {
    this.lots.set(lot.id, lot);
  }

  async getLot(id: string): Promise<Lot | null> {
    return this.lots.get(id) ?? null;
  }

  async listLots(query: ListLotsQuery = {}): Promise<Lot[]> {
    const statuses = query.statuses?.length ? new Set(query.statuses) : null;
    const lots = [...this.lots.values()].filter((l) => !statuses || statuses.has(l.status));
    return sortLotsForFloor(lots).slice(0, query.limit ?? 100);
  }

  async countLots(statuses: readonly Lot["status"][]): Promise<number> {
    return [...this.lots.values()].filter((l) => statuses.includes(l.status)).length;
  }

  async nextLotNumber(): Promise<number> {
    return ++this.lotSequence;
  }

  async listBids(lotId: string, limit: number): Promise<Bid[]> {
    return this.bids
      .filter((b) => b.lotId === lotId)
      .sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime() || b.amountCents - a.amountCents)
      .slice(0, limit);
  }

  async findBidByIdempotencyKey(bidderId: string, key: string): Promise<Bid | null> {
    return this.bids.find((b) => b.bidderId === bidderId && b.idempotencyKey === key) ?? null;
  }

  async countBidsSince(since: Date): Promise<number> {
    return this.bids.filter((b) => b.placedAt >= since).length;
  }

  async insertBidder(input: NewBidder): Promise<Bidder> {
    const bidder: Bidder = { ...input, paddle: `P-${++this.paddleSequence}` };
    this.bidders.set(bidder.id, bidder);
    return bidder;
  }

  async getBidder(id: string): Promise<Bidder | null> {
    return this.bidders.get(id) ?? null;
  }

  async getBidderByTokenHash(tokenHash: string): Promise<Bidder | null> {
    for (const bidder of this.bidders.values()) if (bidder.tokenHash === tokenHash) return bidder;
    return null;
  }

  async exposureFor(bidderId: string, excludeLotId?: string): Promise<number> {
    let total = 0;
    for (const lot of this.lots.values()) {
      if (lot.status === "LIVE" && lot.leaderBidderId === bidderId && lot.id !== excludeLotId) {
        total += lotTotalCents(lot.currentPriceCents, lot.weightLb);
      }
    }
    return total;
  }

  async listActiveProxies(lotId: string): Promise<ProxyBid[]> {
    return [...this.proxies.values()].filter((p) => p.lotId === lotId && p.active);
  }

  async commit(change: LotChange): Promise<void> {
    this.lots.set(change.lot.id, change.lot);
    this.bids.push(...change.newBids);
    for (const proxy of change.upsertProxies) this.proxies.set(proxy.id, proxy);
    for (const id of change.deactivateProxyIds) {
      const proxy = this.proxies.get(id);
      if (proxy) this.proxies.set(id, { ...proxy, active: false });
    }
  }

  async totalSoldCents(): Promise<number> {
    let total = 0;
    for (const lot of this.lots.values()) {
      if (lot.status === "SOLD") total += lotTotalCents(lot.currentPriceCents, lot.weightLb);
    }
    return total;
  }
}
