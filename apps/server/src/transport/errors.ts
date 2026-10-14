import { Code, ConnectError } from "@connectrpc/connect";
import { BidRejectionSchema } from "@cafe/contracts";
import { DomainError } from "../domain/errors";
import { REJECTION } from "./mappers";

/**
 * Domain errors -> gRPC status codes. The same mapping is used whatever the
 * wire protocol is (gRPC, gRPC-Web or Connect).
 * Business rejections also carry a typed `BidRejection` error DETAIL, so the
 * client gets machine-readable data (reason + minimum bid), not just text.
 */
export function toConnectError(error: unknown): ConnectError {
  if (error instanceof ConnectError) return error;
  if (error instanceof DomainError) {
    switch (error.kind) {
      case "NOT_FOUND":
        return new ConnectError(error.message, Code.NotFound);
      case "VALIDATION":
        return new ConnectError(error.message, Code.InvalidArgument);
      case "UNAUTHENTICATED":
        return new ConnectError(error.message, Code.Unauthenticated);
      case "BID_REJECTED": {
        const rejected = error as DomainError & { reason: keyof typeof REJECTION; minNextBidCents: number };
        const code = rejected.reason === "CREDIT_LIMIT_EXCEEDED" ? Code.ResourceExhausted : Code.FailedPrecondition;
        return new ConnectError(error.message, code, undefined, [
          { desc: BidRejectionSchema, value: { reason: REJECTION[rejected.reason], minNextBidCents: rejected.minNextBidCents } },
        ]);
      }
    }
  }
  console.error("[rpc] unexpected error", error);
  return new ConnectError("Internal server error", Code.Internal);
}
