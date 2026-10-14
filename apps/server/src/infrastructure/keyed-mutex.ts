/**
 * Serializes async work per key (one queue per lot).
 * Two bids on the same lot are processed strictly one after the other, so the
 * read -> validate -> write sequence can never interleave (no lost updates).
 * Bids on different lots still run concurrently.
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const current = previous.then(task, task);
    const tail = current.catch(() => undefined);
    this.tails.set(key, tail);
    try {
      return await current;
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
