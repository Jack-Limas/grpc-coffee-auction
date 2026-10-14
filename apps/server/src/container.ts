import { AuctionLifecycle, DEFAULT_LIFECYCLE, type LifecycleOptions } from "./application/auction-lifecycle";
import { BidderService } from "./application/bidder-service";
import { BiddingService } from "./application/bidding-service";
import { CatalogService } from "./application/catalog-service";
import type { AuctionEvent } from "./application/events";
import { FloorStatsService } from "./application/floor-stats";
import { DEFAULT_RULES, type AuctionRules } from "./domain/models";
import { systemClock, type Clock } from "./infrastructure/clock";
import { EventBus } from "./infrastructure/event-bus";
import { KeyedMutex } from "./infrastructure/keyed-mutex";
import type { AuctionRepository } from "./infrastructure/repositories/auction-repository";

/**
 * COMPOSITION ROOT (manual Dependency Injection).
 * The only place that knows concrete classes. Tests build their own
 * container with a FakeClock and an in-memory repository.
 */
export interface Container {
  readonly repo: AuctionRepository;
  readonly clock: Clock;
  readonly bus: EventBus<AuctionEvent>;
  readonly catalog: CatalogService;
  readonly bidders: BidderService;
  readonly bidding: BiddingService;
  readonly lifecycle: AuctionLifecycle;
  readonly stats: FloorStatsService;
}

export interface ContainerOptions {
  readonly repo: AuctionRepository;
  readonly clock?: Clock;
  readonly rules?: AuctionRules;
  readonly lifecycle?: Partial<LifecycleOptions>;
}

export function createContainer(options: ContainerOptions): Container {
  const clock = options.clock ?? systemClock;
  const rules = options.rules ?? DEFAULT_RULES;
  const bus = new EventBus<AuctionEvent>();
  const mutex = new KeyedMutex();

  const catalog = new CatalogService(options.repo);
  const bidders = new BidderService(options.repo, clock);
  const bidding = new BiddingService(options.repo, clock, bus, rules, mutex);
  const lifecycle = new AuctionLifecycle(options.repo, clock, bus, bidding, mutex, {
    ...DEFAULT_LIFECYCLE,
    ...options.lifecycle,
  });
  const stats = new FloorStatsService(options.repo, clock);

  return { repo: options.repo, clock, bus, catalog, bidders, bidding, lifecycle, stats };
}
