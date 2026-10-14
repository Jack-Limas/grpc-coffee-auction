/**
 * In-process publish/subscribe (Observer pattern).
 * Use cases publish domain events; every open gRPC stream subscribes.
 *
 * Trade-off: this works for a single server instance (the free tier).
 * To scale horizontally, swap it for Postgres LISTEN/NOTIFY, Redis Pub/Sub
 * or NATS behind the same interface — no handler would change.
 */
export type Listener<T> = (event: T) => void;

export class EventBus<T> {
  private readonly listeners = new Set<Listener<T>>();

  subscribe(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: T): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("[event-bus] listener failed", error);
      }
    }
  }

  get size(): number {
    return this.listeners.size;
  }
}
