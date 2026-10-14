import { parseArgs } from "node:util";
import { startBotFleet } from "./index";

/**
 * Usage:
 *   npm run bots                                    (local server on :8080)
 *   npm run bots -- --target https://your-app.koyeb.app --count 6
 */
const { values } = parseArgs({
  options: {
    target: { type: "string", default: "http://localhost:8080" },
    count: { type: "string", default: "4" },
  },
});

const count = Math.min(Math.max(Number(values.count) || 4, 1), 8);
console.log(`🤖 Launching ${count} bidding bots against ${values.target} (native gRPC over HTTP/2)`);

const fleet = await startBotFleet({ baseUrl: values.target!, count });
// Keep the process alive until Ctrl+C.
const keepAlive = setInterval(() => {}, 1 << 30);
process.on("SIGINT", () => {
  fleet.stop();
  clearInterval(keepAlive);
  console.log("\nBots stopped.");
  process.exit(0);
});
