import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export * from './schema';
export { schema };

export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Db = ReturnType<typeof createDb>;

/** `YYYY-MM` usage period for a timestamp, UTC. */
export function usagePeriod(at = Date.now()): string {
  return new Date(at).toISOString().slice(0, 7);
}

/** Crawl statuses whose usage has not been recorded yet (finalize and mark-failed record it). */
export const UNCOUNTED_CRAWL_STATUSES = [
  'queued',
  'running',
  'paused',
  'stopping',
  'analysing',
] as const;

/** Add to an organization's usage for the current month. */
export async function addUsage(
  db: Db,
  orgId: string,
  add: { crawledUrls?: number; renderedPages?: number; aiCalls?: number },
): Promise<void> {
  const crawledUrls = add.crawledUrls ?? 0;
  const renderedPages = add.renderedPages ?? 0;
  const aiCalls = add.aiCalls ?? 0;
  if (!crawledUrls && !renderedPages && !aiCalls) return;
  await db
    .insert(schema.usage)
    .values({ organizationId: orgId, period: usagePeriod(), crawledUrls, renderedPages, aiCalls })
    .onConflictDoUpdate({
      target: [schema.usage.organizationId, schema.usage.period],
      set: {
        crawledUrls: sql`${schema.usage.crawledUrls} + ${crawledUrls}`,
        renderedPages: sql`${schema.usage.renderedPages} + ${renderedPages}`,
        aiCalls: sql`${schema.usage.aiCalls} + ${aiCalls}`,
      },
    });
}

/** A project's page-type names, as `groupPageTypes` takes them: URL pattern → name. */
export async function loadPageTypeNames(
  db: Db,
  projectId: string,
): Promise<Record<string, string>> {
  const rows = await db
    .select({ pattern: schema.pageTypeNames.pattern, name: schema.pageTypeNames.name })
    .from(schema.pageTypeNames)
    .where(eq(schema.pageTypeNames.projectId, projectId));
  return Object.fromEntries(rows.map((r) => [r.pattern, r.name]));
}
