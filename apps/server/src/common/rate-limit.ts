import { Inject, Injectable, Optional } from '@nestjs/common';
import { tooMany } from './http';

/** Key prefixes that are not limited (tests register many users from one IP). */
export const RATE_LIMIT_EXEMPT = Symbol('RATE_LIMIT_EXEMPT');

/**
 * Fixed-window counter in memory (single server process, enough for stage 2). Keys are things like
 * `login:<ip>` or `login-user:<username>`.
 */
@Injectable()
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(@Optional() @Inject(RATE_LIMIT_EXEMPT) private readonly exempt: string[] = []) {}

  /** Throws 429 when `key` was hit more than `limit` times in the current `windowMs`. */
  hit(key: string, limit: number, windowMs: number, now = Date.now()): void {
    if (this.exempt?.some((p) => key.startsWith(p))) return;
    let e = this.hits.get(key);
    if (!e || e.resetAt <= now) {
      e = { count: 0, resetAt: now + windowMs };
      this.hits.set(key, e);
      if (this.hits.size > 10_000) this.sweep(now);
    }
    e.count++;
    if (e.count > limit) throw tooMany();
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private sweep(now: number): void {
    for (const [k, e] of this.hits) if (e.resetAt <= now) this.hits.delete(k);
  }
}
