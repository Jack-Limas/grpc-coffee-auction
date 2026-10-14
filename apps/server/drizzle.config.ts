import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/infrastructure/repositories/postgres/schema.ts",
  out: "./drizzle",
});
