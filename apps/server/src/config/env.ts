import { z } from "zod";

/**
 * Environment variables are untrusted strings: validate them ONCE at boot
 * with Zod and fail fast, instead of discovering a typo at 3 a.m.
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  HOST: z.string().default("0.0.0.0"),
  /** Postgres connection string (Neon). Empty = in-memory repository. */
  DATABASE_URL: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  /** Comma separated list of allowed browser origins, or "*". */
  CORS_ORIGINS: z.string().default("*"),
  /** Keeps the auction floor alive by listing new lots automatically. */
  DEMO_MODE: z.stringbool().default(true),
  /** Starts a fleet of bidding bots inside the server (they talk native gRPC to it). */
  HOUSE_BOTS: z.stringbool().default(false),
  HOUSE_BOTS_COUNT: z.coerce.number().int().min(1).max(12).default(4),
  LOG_RPC: z.stringbool().default(true),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    console.error("Invalid environment variables:\n" + z.prettifyError(parsed.error));
    process.exit(1);
  }
  return parsed.data;
}
