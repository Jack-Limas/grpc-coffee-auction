/**
 * A push-based queue you can consume with `for await`.
 * It is the bridge between callback-style events (EventBus) and the async
 * generators that ConnectRPC uses for server-streaming and bidi streaming.
 *
 * Backpressure policy: if a slow client lets more than `capacity` messages
 * pile up, the stream fails instead of eating the server's memory.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly buffer: T[] = [];
  private waiting: ((result: IteratorResult<T>) => void) | null = null;
  private failWaiting: ((error: unknown) => void) | null = null;
  private closed = false;
  private error: unknown = null;

  constructor(
    signal?: AbortSignal,
    private readonly capacity = 2_000,
  ) {
    signal?.addEventListener("abort", () => this.close(), { once: true });
  }

  push(item: T): void {
    if (this.closed) return;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = this.failWaiting = null;
      resolve({ value: item, done: false });
      return;
    }
    if (this.buffer.length >= this.capacity) {
      this.fail(new Error("Client is too slow: stream buffer overflow"));
      return;
    }
    this.buffer.push(item);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = this.failWaiting = null;
      resolve({ value: undefined, done: true });
    }
  }

  fail(error: unknown): void {
    if (this.closed) return;
    this.error = error;
    this.closed = true;
    if (this.failWaiting) {
      const reject = this.failWaiting;
      this.waiting = this.failWaiting = null;
      reject(error);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift() as T, done: false });
        }
        if (this.error) return Promise.reject(this.error);
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.waiting = resolve;
          this.failWaiting = reject;
        });
      },
      return: () => {
        this.close();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}
