import { createClient, type Interceptor } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { BidderService, BiddingService, CatalogService } from "@cafe/contracts";
import { env } from "./env";
import { readSession } from "./session";
import { wireInspector } from "./wire-inspector";

/** Adds "authorization: Bearer <token>" to every call when a paddle exists. */
const auth: Interceptor = (next) => async (req) => {
  const session = readSession();
  if (session) req.header.set("authorization", `Bearer ${session.token}`);
  return next(req);
};

/**
 * Browsers cannot speak native gRPC (no HTTP/2 trailers through fetch), so the
 * browser uses the Connect protocol. `useBinaryFormat: true` keeps the payload
 * as compact Protobuf bytes instead of JSON. Same contract, same server.
 */
export const transport = createConnectTransport({
  baseUrl: env.NEXT_PUBLIC_API_URL,
  useBinaryFormat: true,
  interceptors: [wireInspector, auth],
});

export const catalogClient = createClient(CatalogService, transport);
export const bidderClient = createClient(BidderService, transport);
export const biddingClient = createClient(BiddingService, transport);
