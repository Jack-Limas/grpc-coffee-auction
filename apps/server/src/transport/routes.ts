import type { ConnectRouter } from "@connectrpc/connect";
import { BidderService, BiddingService, CatalogService } from "@cafe/contracts";
import type { Container } from "../container";
import { bidderHandler } from "./handlers/bidder-handler";
import { biddingHandler } from "./handlers/bidding-handler";
import { catalogHandler } from "./handlers/catalog-handler";

/** Registers the three gRPC services generated from the contract. */
export const createRoutes = (c: Container) => (router: ConnectRouter) => {
  router.service(CatalogService, catalogHandler(c.catalog));
  router.service(BidderService, bidderHandler(c.bidders));
  router.service(
    BiddingService,
    biddingHandler({ bidding: c.bidding, bidders: c.bidders, catalog: c.catalog, bus: c.bus, stats: c.stats }),
  );
};
