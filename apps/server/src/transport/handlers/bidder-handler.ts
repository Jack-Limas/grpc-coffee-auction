import type { ServiceImpl } from "@connectrpc/connect";
import { BidderService as BidderServiceDesc } from "@cafe/contracts";
import type { BidderService } from "../../application/bidder-service";
import { requireBidder } from "../interceptors";
import { toPbBidder } from "../mappers";

export function bidderHandler(bidders: BidderService): ServiceImpl<typeof BidderServiceDesc> {
  return {
    async registerBidder(req) {
      const { bidder, token } = await bidders.register({
        displayName: req.displayName,
        company: req.company,
        country: req.country,
        isBot: req.isBot,
      });
      return { bidder: toPbBidder(bidder, 0), token };
    },

    async getMe(_req, ctx) {
      const bidder = requireBidder(ctx);
      return { bidder: toPbBidder(bidder, await bidders.exposureOf(bidder.id)) };
    },
  };
}
