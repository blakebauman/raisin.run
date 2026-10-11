/**
 * Housekeeping run by the web Worker's cron, next to scheduled crawls:
 * - retention: crawls older than their plan's retention period are deleted with their data;
 * - watchdog: crawls whose Workflow died are marked failed, so they stop counting as active
 *   and stop showing as running.
 */

import { addUsage, crawls, orgPlans, plans } from '@raisin/db';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db, engine } from './env.server';

const BATCH = 25;
const ACTIVE = ['queued', 'running', 'paused', 'stopping', 'analysing'] as const;
/** A crawl still queued after this long never got going. */
const STALE_QUEUED_MS = 60 * 60 * 1000;

export async function purgeExpiredCrawls(now = Date.now()): Promise<number> {
  const database = db();
  const expired = await database
    .select({ id: crawls.id, orgId: crawls.organizationId })
    .from(crawls)
    // Left joins: an org without a plan row is on Free terms (7 days), not exempt from retention.
    .leftJoin(orgPlans, eq(orgPlans.organizationId, crawls.organizationId))
    .leftJoin(plans, eq(plans.id, orgPlans.planId))
    .where(
      and(
        isNotNull(crawls.finishedAt),
        sql`${crawls.finishedAt} < ${now} - coalesce(${plans.retentionDays}, 7) * 86400000`,
      ),
    )
    .limit(BATCH);
  for (const c of expired) {
    try {
      await engine().purge(c.orgId, c.id);
      await database.delete(crawls).where(eq(crawls.id, c.id));
    } catch (e) {
      console.error('retention purge failed', c.id, e);
    }
  }
  return expired.length;
}

export async function failDeadCrawls(now = Date.now()): Promise<number> {
  const database = db();
  const active = await database
    .select({
      id: crawls.id,
      orgId: crawls.organizationId,
      status: crawls.status,
      createdAt: crawls.createdAt,
    })
    .from(crawls)
    .where(inArray(crawls.status, [...ACTIVE]))
    .limit(200);
  let failed = 0;
  for (const c of active) {
    const { status, error } = await engine().lifecycle(c.id);
    const dead = status === 'errored' || status === 'terminated';
    const neverStarted =
      status === 'unknown' &&
      c.status === 'queued' &&
      now - c.createdAt.getTime() > STALE_QUEUED_MS;
    if (!dead && !neverStarted) continue;
    // The Workflow died before finalize or mark-failed could record usage; record it here.
    const p = await engine()
      .progress(c.orgId, c.id)
      .catch(() => null);
    if (p) await addUsage(database, c.orgId, { crawledUrls: p.crawled, renderedPages: p.rendered });
    await database
      .update(crawls)
      .set({
        status: 'failed',
        error: error ?? (neverStarted ? 'The crawl never started.' : `Crawl workflow ${status}.`),
        finishedAt: new Date(now),
      })
      .where(eq(crawls.id, c.id));
    failed++;
  }
  return failed;
}
