/**
 * robots.txt per origin, cached in KV for an hour so thousands of fetch consumers don't each
 * re-request it. The KV value is the raw fetch outcome; parsing happens on read so the RFC 9309
 * status rules in core stay the single source of truth.
 */

import { type Robots, type RobotsSnapshot, robotsFromStatus } from '@raisin/core';

const TTL_SECONDS = 3600;
const memo = new Map<string, { robots: Robots; snapshot: RobotsSnapshot; at: number }>();
const MEMO_MS = 60_000;

export async function getRobots(
  env: Env,
  origin: string,
  userAgent: string,
): Promise<{ robots: Robots; snapshot: RobotsSnapshot }> {
  const hit = memo.get(origin);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit;

  const key = `robots:${origin}`;
  let snapshot = await env.ROBOTS_CACHE.get<RobotsSnapshot>(key, 'json');
  if (!snapshot) {
    snapshot = await fetchRobots(origin, userAgent);
    await env.ROBOTS_CACHE.put(key, JSON.stringify(snapshot), { expirationTtl: TTL_SECONDS });
  }
  const entry = {
    robots: robotsFromStatus(snapshot.status, snapshot.body),
    snapshot,
    at: Date.now(),
  };
  memo.set(origin, entry);
  return entry;
}

export async function fetchRobots(origin: string, userAgent: string): Promise<RobotsSnapshot> {
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { 'user-agent': userAgent, accept: 'text/plain,*/*' },
      signal: AbortSignal.timeout(10_000),
      // Follow up to the runtime's redirect limit; RFC 9309 asks for at least five hops.
      redirect: 'follow',
    });
    const body = res.ok ? (await res.text()).slice(0, 512 * 1024) : '';
    if (!res.ok) await res.body?.cancel();
    return { status: res.status, body, fetchedAt: Date.now() };
  } catch {
    // Unreachable robots.txt is treated like a 5xx: crawl nothing on that origin.
    return { status: 599, body: '', fetchedAt: Date.now() };
  }
}
