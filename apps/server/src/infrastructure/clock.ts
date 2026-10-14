/** Time is a dependency. Injecting it makes anti-sniping and closing testable. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** A clock you can move by hand in tests. */
export class FakeClock implements Clock {
  constructor(private current: Date = new Date("2026-01-01T12:00:00Z")) {}
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
  set(date: Date): void {
    this.current = new Date(date);
  }
}
