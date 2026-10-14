import { NotFoundError } from "../domain/errors";
import type { Bid, Lot, LotStatus } from "../domain/models";
import type { AuctionRepository } from "../infrastructure/repositories/auction-repository";

/** Read side (queries). Kept apart from the write side: a light CQRS split. */
export class CatalogService {
  constructor(private readonly repo: AuctionRepository) {}

  listLots(statuses: readonly LotStatus[] = [], limit = 30): Promise<Lot[]> {
    return this.repo.listLots({ statuses, limit: Math.min(Math.max(limit || 30, 1), 100) });
  }

  async getLot(lotId: string, bidLimit = 30): Promise<{ lot: Lot; bids: Bid[] }> {
    const lot = await this.repo.getLot(lotId);
    if (!lot) throw new NotFoundError("Lot", lotId);
    const bids = await this.repo.listBids(lotId, bidLimit);
    return { lot, bids };
  }
}
