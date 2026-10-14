import { z } from "zod";

/**
 * NEXT_PUBLIC_* values are baked into the bundle at build time.
 * Validating them with Zod turns a silent "undefined/api" bug into a clear error.
 */
const schema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url().default("http://localhost:8080"),
});

export const env = schema.parse({
  // Must be referenced literally so Next.js can inline it.
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || undefined,
});
