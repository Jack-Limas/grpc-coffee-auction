import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_API_URL: z
    .string()
    .url()
    .default("https://cafeserver-production.up.railway.app"),
});

export const env = schema.parse({
  NEXT_PUBLIC_API_URL:
    process.env.NEXT_PUBLIC_API_URL ||
    "https://cafeserver-production.up.railway.app",
});