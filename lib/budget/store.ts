import "server-only";

type DayBucket = { usd: number; tokens: number };

export type RateCheck = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
};

const WINDOW_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

class BudgetStore {
  private rate = new Map<string, number[]>();
  private days = new Map<string, DayBucket>();
  private dedupe = new Map<string, number>();
  private streams = new Map<string, number>();

  constructor() {
    const timer = setInterval(() => this.sweep(), 60_000);
    if (typeof timer.unref === "function") timer.unref();
  }

  static dayKey(now = Date.now()): string {
    return new Date(now - (now % DAY_MS)).toISOString().slice(0, 10);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, hits] of this.rate) {
      const alive = hits.filter((t) => now - t < WINDOW_MS);
      if (alive.length === 0) this.rate.delete(key);
      else this.rate.set(key, alive);
    }
    for (const [key, at] of this.dedupe) {
      if (now - at > DAY_MS) this.dedupe.delete(key);
    }
    const today = BudgetStore.dayKey(now);
    for (const key of this.days.keys()) {
      if (key !== today) this.days.delete(key);
    }
  }

  private bucket(): DayBucket {
    const key = BudgetStore.dayKey();
    let bucket = this.days.get(key);
    if (!bucket) {
      bucket = { usd: 0, tokens: 0 };
      this.days.set(key, bucket);
    }
    return bucket;
  }

  rateCheck(key: string, limit: number): RateCheck {
    const now = Date.now();
    const hits = (this.rate.get(key) ?? []).filter((t) => now - t < WINDOW_MS);

    if (hits.length >= limit) {
      const oldest = hits[0];
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetMs: Math.max(oldest + WINDOW_MS - now, 0),
      };
    }

    hits.push(now);
    this.rate.set(key, hits);
    return { allowed: true, limit, remaining: limit - hits.length, resetMs: WINDOW_MS };
  }

  ratePeek(key: string, limit: number): RateCheck {
    const now = Date.now();
    const hits = (this.rate.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    const remaining = Math.max(limit - hits.length, 0);
    const oldest = hits[0];
    return {
      allowed: remaining > 0,
      limit,
      remaining,
      resetMs: oldest ? Math.max(oldest + WINDOW_MS - now, 0) : 0,
    };
  }

  isDuplicate(key: string, windowMs: number): boolean {
    if (windowMs <= 0) return false;
    const now = Date.now();
    const seen = this.dedupe.get(key);
    this.dedupe.set(key, now);
    return seen !== undefined && now - seen < windowMs;
  }

  addCost(usd: number, tokens: number): void {
    const bucket = this.bucket();
    bucket.usd += Math.max(usd, 0);
    bucket.tokens += Math.max(tokens, 0);
  }

  usage(): DayBucket {
    const { usd, tokens } = this.bucket();
    return { usd, tokens };
  }

  acquireStream(identity: string, max: number): (() => void) | null {
    const active = this.streams.get(identity) ?? 0;
    if (active >= max) return null;
    this.streams.set(identity, active + 1);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = (this.streams.get(identity) ?? 1) - 1;
      if (current <= 0) this.streams.delete(identity);
      else this.streams.set(identity, current);
    };
  }

  activeStreams(identity: string): number {
    return this.streams.get(identity) ?? 0;
  }
}

const globalStore = globalThis as typeof globalThis & { __callmissedBudgetStore?: BudgetStore };

export const store = (globalStore.__callmissedBudgetStore ??= new BudgetStore());
