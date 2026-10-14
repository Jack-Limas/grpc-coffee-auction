import { registerBidderSchema, firstIssue } from "@cafe/contracts";
import { UnauthenticatedError, ValidationError } from "../domain/errors";
import type { Bidder } from "../domain/models";
import type { Clock } from "../infrastructure/clock";
import { hashToken, newId, newToken } from "../infrastructure/ids";
import type { AuctionRepository } from "../infrastructure/repositories/auction-repository";

/** Credit lines granted on registration (in a real house this follows KYC). */
export const CREDIT_POLICY = Object.freeze({
  humanCreditCents: 6_000_000, // $60,000
  botCreditCents: 4_000_000, // $40,000
});

export interface RegisteredBidder {
  readonly bidder: Bidder;
  readonly token: string;
}

/** Use cases around bidder identity (paddles) and authentication. */
export class BidderService {
  private readonly tokenCache = new Map<string, Bidder>();

  constructor(
    private readonly repo: AuctionRepository,
    private readonly clock: Clock,
  ) {}

  async register(input: unknown): Promise<RegisteredBidder> {
    const parsed = registerBidderSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError(firstIssue(parsed.error));

    const token = newToken();
    const bidder = await this.repo.insertBidder({
      id: newId(),
      displayName: parsed.data.displayName,
      company: parsed.data.company,
      country: parsed.data.country,
      isBot: parsed.data.isBot,
      creditLimitCents: parsed.data.isBot ? CREDIT_POLICY.botCreditCents : CREDIT_POLICY.humanCreditCents,
      tokenHash: hashToken(token),
      createdAt: this.clock.now(),
    });
    return { bidder, token };
  }

  /** Resolves "Bearer <token>" into a bidder, with a small in-memory cache. */
  async authenticate(authorization: string | null): Promise<Bidder> {
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (!token) throw new UnauthenticatedError();

    const tokenHash = hashToken(token);
    const cached = this.tokenCache.get(tokenHash);
    if (cached) return cached;

    const bidder = await this.repo.getBidderByTokenHash(tokenHash);
    if (!bidder) throw new UnauthenticatedError("Unknown or expired bidder token");
    if (this.tokenCache.size > 10_000) this.tokenCache.clear();
    this.tokenCache.set(tokenHash, bidder);
    return bidder;
  }

  async exposureOf(bidderId: string): Promise<number> {
    return this.repo.exposureFor(bidderId);
  }
}
