import { closeLot, openLot } from "../domain/auction-rules";
import type { Lot } from "../domain/models";
import type { Clock } from "../infrastructure/clock";
import type { EventBus } from "../infrastructure/event-bus";
import type { KeyedMutex } from "../infrastructure/keyed-mutex";
import type { AuctionRepository } from "../infrastructure/repositories/auction-repository";
import type { BiddingService } from "./bidding-service";
import { createLot, DEMO_CATALOG } from "./demo-catalog";
import type { AuctionEvent } from "./events";

export interface LifecycleOptions {
  /** Keep the floor alive forever by listing new lots as old ones close. */
  readonly demoMode: boolean;
  readonly targetActiveLots: number;
  readonly minDurationMs: number;
  readonly maxDurationMs: number;
  readonly tickMs: number;
}

export const DEFAULT_LIFECYCLE: LifecycleOptions = {
  demoMode: true,
  targetActiveLots: 6,
  minDurationMs: 4 * 60_000,
  maxDurationMs: 9 * 60_000,
  tickMs: 1_000,
};

/**
 * The auctioneer: a ticking state machine.
 *
 *   SCHEDULED --(startsAt)--> LIVE --(endsAt)--> SOLD | UNSOLD
 *
 * Opening a lot also fires the proxy engine, because absentee proxies may
 * have been waiting for it.
 */
export class AuctionLifecycle {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    private readonly repo: AuctionRepository,
    private readonly clock: Clock,
    private readonly bus: EventBus<AuctionEvent>,
    private readonly bidding: BiddingService,
    private readonly mutex: KeyedMutex,
    private readonly options: LifecycleOptions = DEFAULT_LIFECYCLE,
    private readonly random: () => number = Math.random,
  ) {}

  async start(): Promise<void> {
    if (this.options.demoMode) await this.seedIfEmpty();
    await this.tick();
    this.timer = setInterval(() => void this.tick(), this.options.tickMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One heartbeat of the auctioneer. Public so tests can drive it. */
  async tick(): Promise<void> {
    if (this.ticking) return; // never overlap ticks
    this.ticking = true;
    try {
      const now = this.clock.now();
      const active = await this.repo.listLots({ statuses: ["SCHEDULED", "LIVE"], limit: 100 });
      for (const lot of active) {
        if (lot.status === "SCHEDULED" && lot.startsAt <= now) await this.open(lot.id);
        else if (lot.status === "LIVE" && lot.endsAt <= now) await this.close(lot.id);
      }
      if (this.options.demoMode) await this.replenish();
    } catch (error) {
      console.error("[lifecycle] tick failed", error);
    } finally {
      this.ticking = false;
    }
  }

  private async open(lotId: string): Promise<void> {
    await this.mutex.run(lotId, async () => {
      const lot = await this.repo.getLot(lotId);
      const now = this.clock.now();
      if (!lot || lot.status !== "SCHEDULED" || lot.startsAt > now) return;

      const opened = openLot(lot);
      const proxies = await this.repo.listActiveProxies(lot.id);
      const resolution = await this.bidding.runProxyEngine(opened, proxies, now);
      const autoBids = this.bidding.toBids(lot.id, resolution, now);

      await this.repo.commit({
        lot: resolution.lot,
        newBids: autoBids,
        upsertProxies: [],
        deactivateProxyIds: resolution.exhaustedProxyIds,
      });
      this.bus.publish({ type: "opened", lot: resolution.lot });
      this.bidding.publishAutoBids(resolution, autoBids, null);
    });
  }

  private async close(lotId: string): Promise<void> {
    await this.mutex.run(lotId, async () => {
      const lot = await this.repo.getLot(lotId);
      if (!lot || lot.status !== "LIVE" || lot.endsAt > this.clock.now()) return;

      const result = closeLot(lot);
      const proxies = await this.repo.listActiveProxies(lot.id);
      await this.repo.commit({
        lot: result.lot,
        newBids: [],
        upsertProxies: [],
        deactivateProxyIds: proxies.map((p) => p.id),
      });
      this.bus.publish({ type: "closed", lot: result.lot, sold: result.sold, totalValueCents: result.totalValueCents });
    });
  }

  private async seedIfEmpty(): Promise<void> {
    const existing = await this.repo.countLots(["SCHEDULED", "LIVE"]);
    if (existing > 0) return;
    const now = this.clock.now();
    const liveCount = Math.ceil(this.options.targetActiveLots * 0.66);
    for (let i = 0; i < this.options.targetActiveLots; i++) {
      const isLive = i < liveCount;
      // Live lots end at staggered times so something is always about to close.
      const startsAt = isLive ? now : new Date(now.getTime() + (i - liveCount + 1) * 45_000);
      const duration = isLive ? (2 + i * 1.5) * 60_000 : this.randomDuration();
      await this.list(startsAt, duration);
    }
  }

  private async replenish(): Promise<void> {
    const active = await this.repo.countLots(["SCHEDULED", "LIVE"]);
    const missing = this.options.targetActiveLots - active;
    if (missing <= 0) return;
    const scheduled = await this.repo.listLots({ statuses: ["SCHEDULED"], limit: 100 });
    const lastStart = scheduled.reduce((max, l) => Math.max(max, l.startsAt.getTime()), this.clock.now().getTime());
    for (let i = 0; i < missing; i++) {
      await this.list(new Date(lastStart + (i + 1) * 40_000), this.randomDuration());
    }
  }

  private async list(startsAt: Date, durationMs: number): Promise<Lot> {
    const number = await this.repo.nextLotNumber();
    const template = DEMO_CATALOG[(number - 1) % DEMO_CATALOG.length]!;
    const lot = createLot(template, number, startsAt, durationMs, this.clock.now());
    await this.repo.insertLot(lot);
    this.bus.publish({ type: "lot_listed", lot });
    return lot;
  }

  private randomDuration(): number {
    const { minDurationMs: min, maxDurationMs: max } = this.options;
    return Math.round(min + this.random() * (max - min));
  }
}
