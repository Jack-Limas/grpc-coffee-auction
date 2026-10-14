import type { Clock } from "../infrastructure/clock";
import { EventBus } from "../infrastructure/event-bus";
import type { AuctionRepository } from "../infrastructure/repositories/auction-repository";

export interface FloorStatsSnapshot {
  readonly liveLots: number;
  readonly bidsLastMinute: number;
  readonly connectedWatchers: number;
  readonly totalSoldCents: number;
}

/**
 * Computes floor statistics ONCE every few seconds and broadcasts them,
 * instead of every open stream hitting the database on its own.
 */
export class FloorStatsService {
  readonly updates = new EventBus<FloorStatsSnapshot>();
  private watchers = 0;
  private latest: FloorStatsSnapshot = { liveLots: 0, bidsLastMinute: 0, connectedWatchers: 0, totalSoldCents: 0 };
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly repo: AuctionRepository,
    private readonly clock: Clock,
    private readonly intervalMs = 5_000,
  ) {}

  start(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  watcherJoined(): void {
    this.watchers++;
  }

  watcherLeft(): void {
    this.watchers = Math.max(0, this.watchers - 1);
  }

  current(): FloorStatsSnapshot {
    return { ...this.latest, connectedWatchers: this.watchers };
  }

  async refresh(): Promise<void> {
    try {
      const since = new Date(this.clock.now().getTime() - 60_000);
      const [liveLots, bidsLastMinute, totalSoldCents] = await Promise.all([
        this.repo.countLots(["LIVE"]),
        this.repo.countBidsSince(since),
        this.repo.totalSoldCents(),
      ]);
      this.latest = { liveLots, bidsLastMinute, connectedWatchers: this.watchers, totalSoldCents };
      this.updates.publish(this.current());
    } catch (error) {
      console.error("[stats] refresh failed", error);
    }
  }
}
