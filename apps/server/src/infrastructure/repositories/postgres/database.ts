import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import type { Db } from "./postgres-auction-repository";
import * as schema from "./schema";

/** Opens a pooled connection (Neon works with a plain connection string) and migrates. */
export async function connectPostgres(
  databaseUrl: string,
  migrationsFolder: string,
): Promise<{ db: Db; close: () => Promise<void> }> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder });
  return { db: db as unknown as Db, close: () => pool.end() };
}
