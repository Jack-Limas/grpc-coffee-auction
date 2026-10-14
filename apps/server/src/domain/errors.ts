/**
 * Domain errors carry a stable machine-readable code. The transport layer
 * translates them into gRPC status codes (transport/errors.ts); the domain
 * never knows that gRPC exists.
 */

export type BidRejectionReason =
  | "LOT_NOT_LIVE"
  | "BELOW_MINIMUM"
  | "ALREADY_LEADING"
  | "CREDIT_LIMIT_EXCEEDED"
  | "INVALID_PROXY_MAX";

export abstract class DomainError extends Error {
  abstract readonly kind: "NOT_FOUND" | "VALIDATION" | "UNAUTHENTICATED" | "BID_REJECTED";
}

export class NotFoundError extends DomainError {
  readonly kind = "NOT_FOUND" as const;
  constructor(entity: string, id: string) {
    super(`${entity} "${id}" was not found`);
  }
}

export class ValidationError extends DomainError {
  readonly kind = "VALIDATION" as const;
}

export class UnauthenticatedError extends DomainError {
  readonly kind = "UNAUTHENTICATED" as const;
  constructor(message = "A valid bidder token is required") {
    super(message);
  }
}

export class BidRejectedError extends DomainError {
  readonly kind = "BID_REJECTED" as const;
  constructor(
    readonly reason: BidRejectionReason,
    message: string,
    readonly minNextBidCents: number,
  ) {
    super(message);
  }
}
