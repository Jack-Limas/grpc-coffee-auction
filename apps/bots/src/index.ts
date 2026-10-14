import { TradingBot } from "./bot";
import { PERSONAS } from "./personas";

export { TradingBot } from "./bot";
export * from "./personas";

export interface FleetOptions {
  readonly baseUrl: string;
  readonly count: number;
  readonly log?: boolean;
}

/** Starts `count` bots with different personas, staggered by a second each. */
export async function startBotFleet(options: FleetOptions): Promise<{ stop: () => void }> {
  const bots: TradingBot[] = [];
  for (let i = 0; i < options.count; i++) {
    const persona = PERSONAS[i % PERSONAS.length]!;
    const bot = new TradingBot(persona, options.baseUrl, options.log ?? true);
    bots.push(bot);
    // Fire and forget: a bot that fails to start retries on its own session loop.
    setTimeout(() => bot.start().catch((e) => console.error(`[bots] ${persona.company} failed to start`, e)), i * 1_000).unref();
  }
  return { stop: () => bots.forEach((b) => b.stop()) };
}
