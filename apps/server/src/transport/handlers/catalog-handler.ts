import type { ServiceImpl } from "@connectrpc/connect";
import { CatalogService as CatalogServiceDesc } from "@cafe/contracts";
import type { CatalogService } from "../../application/catalog-service";
import { statusesFromProto, toPbBid, toPbLot } from "../mappers";

/** gRPC adapter for the read side. Thin: parse -> use case -> map. */
export function catalogHandler(catalog: CatalogService): ServiceImpl<typeof CatalogServiceDesc> {
  return {
    async listLots(req) {
      const lots = await catalog.listLots(statusesFromProto(req.statuses), req.limit);
      return { lots: lots.map(toPbLot) };
    },

    async getLot(req) {
      const { lot, bids } = await catalog.getLot(req.lotId);
      return { lot: toPbLot(lot), bids: bids.map(toPbBid) };
    },
  };
}
