import { createContextKey, type HandlerContext, type Interceptor } from "@connectrpc/connect";
import type { BidderService } from "../application/bidder-service";
import { UnauthenticatedError } from "../domain/errors";
import type { Bidder } from "../domain/models";
import { toConnectError } from "./errors";

/**
 * INTERCEPTORS = gRPC middleware. They run around every RPC regardless of
 * the protocol the client used (gRPC, gRPC-Web or Connect).
 */

/** Per-RPC slot where the auth interceptor stores the authenticated bidder. */
export const bidderKey = createContextKey<Bidder | null>(null, { description: "authenticated bidder" });

export function requireBidder(ctx: HandlerContext): Bidder {
  const bidder = ctx.values.get(bidderKey);
  if (!bidder) throw new UnauthenticatedError();
  return bidder;
}

/** Methods that need "authorization: Bearer <token>". */
const PROTECTED = new Set(["GetMe", "PlaceBid", "SubmitAbsenteeBook", "BidderSession"]);

export function authInterceptor(bidders: BidderService): Interceptor {
  return (next) => async (req) => {
    if (PROTECTED.has(req.method.name)) {
      try {
        const bidder = await bidders.authenticate(req.header.get("authorization"));
        req.contextValues.set(bidderKey, bidder);
      } catch (error) {
        throw toConnectError(error);
      }
    }
    return next(req);
  };
}

/** Converts domain errors into gRPC status codes, also inside streams. */
export const errorInterceptor: Interceptor = (next) => async (req) => {
  try {
    const res = await next(req);
    if (!res.stream) return res;
    const source = res.message;
    return {
      ...res,
      message: (async function* () {
        try {
          yield* source;
        } catch (error) {
          throw toConnectError(error);
        }
      })(),
    };
  } catch (error) {
    throw toConnectError(error);
  }
};

/** Identifies which of the 3 wire protocols the client spoke. */
export function wireProtocol(contentType: string | null): string {
  const ct = contentType ?? "";
  if (ct.startsWith("application/grpc-web")) return "grpc-web";
  if (ct.startsWith("application/grpc")) return "grpc";
  if (ct.startsWith("application/connect+") || ct.startsWith("application/proto") || ct.startsWith("application/json")) {
    return "connect";
  }
  return "unknown";
}

/** One log line per call: method, protocol, duration and status. */
export function loggingInterceptor(enabled: boolean): Interceptor {
  return (next) => async (req) => {
    if (!enabled) return next(req);
    const started = performance.now();
    const label = `${req.service.name}/${req.method.name}`;
    const protocol = wireProtocol(req.header.get("content-type"));
    try {
      const res = await next(req);
      const ms = (performance.now() - started).toFixed(1);
      console.log(`[rpc] ${label.padEnd(36)} ${protocol.padEnd(8)} ${res.stream ? "stream opened" : "OK"} ${ms}ms`);
      return res;
    } catch (error) {
      const ms = (performance.now() - started).toFixed(1);
      const code = (error as { code?: number }).code ?? "?";
      console.log(`[rpc] ${label.padEnd(36)} ${protocol.padEnd(8)} ERROR(code=${code}) ${ms}ms`);
      throw error;
    }
  };
}
