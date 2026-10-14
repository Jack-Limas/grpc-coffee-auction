import { fileURLToPath } from "node:url";
import { loadEnv } from "./config/env";
import { createContainer } from "./container";
import type { AuctionRepository } from "./infrastructure/repositories/auction-repository";
import { InMemoryAuctionRepository } from "./infrastructure/repositories/in-memory-auction-repository";
import { connectPostgres } from "./infrastructure/repositories/postgres/database";
import { PostgresAuctionRepository } from "./infrastructure/repositories/postgres/postgres-auction-repository";
import { authInterceptor, errorInterceptor, loggingInterceptor } from "./transport/interceptors";
import { createRoutes } from "./transport/routes";
import { createDualProtocolServer } from "./transport/server";

async function main(): Promise<void> {
  // Loads apps/server/.env when it exists (local development only).
  try {
    process.loadEnvFile();
  } catch {
    /* no .env file: rely on real environment variables */
  }
  const env = loadEnv();

  // Persistence adapter chosen by configuration (Ports & Adapters).
  let repo: AuctionRepository;
  let closeDb = async () => {};
  if (env.DATABASE_URL) {
    // Works from src/main.ts (tsx) and dist/main.js (bundle): both sit one level below apps/server.
    const migrations = fileURLToPath(new URL("../drizzle", import.meta.url));
    const pg = await connectPostgres(env.DATABASE_URL, migrations);
    repo = new PostgresAuctionRepository(pg.db);
    closeDb = pg.close;
    console.log("[db] connected to Postgres and migrations applied");
  } else {
    repo = new InMemoryAuctionRepository();
    console.log("[db] DATABASE_URL not set -> using the in-memory repository");
  }

  const container = createContainer({ repo, lifecycle: { demoMode: env.DEMO_MODE } });

  const server = createDualProtocolServer({
    routes: createRoutes(container),
    // Order matters: logging wraps errors, errors wrap auth, auth wraps the handler.
    interceptors: [loggingInterceptor(env.LOG_RPC), errorInterceptor, authInterceptor(container.bidders)],
    corsOrigins: env.CORS_ORIGINS,
    health: async () => ({
      storage: env.DATABASE_URL ? "postgres" : "memory",
      liveLots: container.stats.current().liveLots,
      watchers: container.stats.current().connectedWatchers,
    }),
  });

  await container.lifecycle.start();
  container.stats.start();

  server.listen(env.PORT, env.HOST, () => {
    console.log(`☕ Cafe Subasta API listening on http://${env.HOST}:${env.PORT}`);
    console.log("   protocols: gRPC (HTTP/2 h2c) · gRPC-Web · Connect (HTTP/1.1 + HTTP/2)");
  });

  let stopBots: (() => void) | null = null;
  if (env.HOUSE_BOTS) {
    const { startBotFleet } = await import("@cafe/bots");
    const fleet = await startBotFleet({
      baseUrl: `http://127.0.0.1:${env.PORT}`,
      count: env.HOUSE_BOTS_COUNT,
      log: env.LOG_RPC,
    });
    stopBots = fleet.stop;
    console.log(`[bots] ${env.HOUSE_BOTS_COUNT} house bots trading over native gRPC`);
  }

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received, shutting down...`);
    stopBots?.();
    container.lifecycle.stop();
    container.stats.stop();
    server.close();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

void main();
