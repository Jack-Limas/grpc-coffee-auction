import type { Bid, Lot } from "../domain/models";

/**
 * Domain events published after a successful commit.
 * The transport layer turns them into Protobuf `LotEvent`s for every stream.
 */
export type AuctionEvent =
  | { readonly type: "bid_placed"; readonly lot: Lot; readonly bid: Bid; readonly previousLeaderPaddle: string | null }
  | { readonly type: "extended"; readonly lot: Lot; readonly previousEndsAt: Date; readonly extensionSeconds: number }
  | { readonly type: "opened"; readonly lot: Lot }
  | { readonly type: "closed"; readonly lot: Lot; readonly sold: boolean; readonly totalValueCents: number }
  | { readonly type: "lot_listed"; readonly lot: Lot };
