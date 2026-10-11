/**
 * One instance per target hostname, shared by every crawl on the platform. Each crawl already
 * paces itself (the Crawl DO's dispatch rate); this is the floor that stops many tenants crawling
 * the same site at once from adding up to an overload. It also honours robots.txt Crawl-delay
 * and backs a host off after 429/503 responses.
 *
 * State is in memory only. Losing it on eviction just means the next request goes immediately.
 */

import { DurableObject } from 'cloudflare:workers';

export class HostLimiter extends DurableObject<Env> {
  private next = 0;
  private penaltyUntil = 0;

  /** Reserve the next slot for this host. Returns how long the caller must wait, in ms. */
  acquire(minIntervalMs: number): number {
    const now = Date.now();
    const start = Math.max(now, this.next, this.penaltyUntil);
    this.next = start + Math.max(0, minIntervalMs);
    return start - now;
  }

  /** Push every caller back after the host signalled overload (429/503 + Retry-After). */
  penalize(ms: number): void {
    this.penaltyUntil = Math.max(this.penaltyUntil, Date.now() + Math.min(ms, 300_000));
  }
}
