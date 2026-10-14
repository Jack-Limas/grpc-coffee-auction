import { z } from "zod";

/**
 * Runtime validation (Zod).
 *
 * TypeScript types are ERASED at runtime (type erasure): a `PlaceBidRequest`
 * type does not stop a client from sending a negative amount, and
 * `JSON.parse(localStorage...) as Session` is just a promise to the compiler.
 *
 * Protobuf guarantees the *shape* on the wire (an int32 is an int32), and Zod
 * guarantees the *business semantics* (amount > 0, names not empty, ...).
 * These schemas are shared by the browser (forms) and the server (handlers),
 * so both sides enforce exactly the same rules.
 */

export const MAX_PRICE_CENTS = 100_000; // $1,000.00 per lb — sanity cap

export const idSchema = z.string().trim().min(1, "Id is required").max(64);

export const registerBidderSchema = z.object({
  displayName: z.string().trim().min(2, "Name must have at least 2 characters").max(40),
  company: z.string().trim().min(2, "Company must have at least 2 characters").max(60),
  country: z.string().trim().min(2, "Country is required").max(40),
  isBot: z.boolean().default(false),
});
export type RegisterBidderInput = z.infer<typeof registerBidderSchema>;

export const centsSchema = z
  .number()
  .int("Amount must be whole cents")
  .positive("Amount must be positive")
  .max(MAX_PRICE_CENTS, "Amount exceeds the $1,000/lb sanity cap");

export const placeBidSchema = z
  .object({
    lotId: idSchema,
    amountCents: centsSchema,
    maxAmountCents: centsSchema.optional(),
    idempotencyKey: z.string().max(80).default(""),
  })
  .refine((v) => v.maxAmountCents === undefined || v.maxAmountCents >= v.amountCents, {
    message: "Proxy maximum must be greater than or equal to the bid amount",
    path: ["maxAmountCents"],
  });
export type PlaceBidInput = z.infer<typeof placeBidSchema>;

export const absenteeBidSchema = z.object({
  lotId: idSchema,
  maxAmountCents: centsSchema,
});

/** What the browser persists in localStorage after registering a paddle. */
export const storedSessionSchema = z.object({
  token: z.string().min(16),
  bidderId: z.string().min(1),
  paddle: z.string().regex(/^P-\d+$/),
  displayName: z.string(),
});
export type StoredSession = z.infer<typeof storedSessionSchema>;

/** Formats a ZodError into a single readable sentence. */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? issue.message : "Invalid input";
}
