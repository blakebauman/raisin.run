import { crawls, orgPlans, plans, usage, usagePeriod } from '@raisin/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from './env.server';

export type Plan = typeof plans.$inferSelect;
export type Usage = { crawledUrls: number; renderedPages: number; aiCalls: number };

/** Unverified domains are capped regardless of plan, so the platform can't be aimed at sites people don't own. */
export const UNVERIFIED_LIMITS = { maxUrls: 500, maxUrlsPerSecond: 2 } as const;

export async function getPlan(orgId: string): Promise<Plan> {
  const database = db();
  const rows = await database
    .select({ plan: plans })
    .from(orgPlans)
    .innerJoin(plans, eq(plans.id, orgPlans.planId))
    .where(eq(orgPlans.organizationId, orgId))
    .limit(1);
  if (rows[0]) return rows[0].plan;
  const free = await database.select().from(plans).where(eq(plans.id, 'free')).limit(1);
  return free[0]!;
}

export async function getUsage(orgId: string): Promise<Usage> {
  const rows = await db()
    .select()
    .from(usage)
    .where(and(eq(usage.organizationId, orgId), eq(usage.period, usagePeriod())))
    .limit(1);
  return rows[0] ?? { crawledUrls: 0, renderedPages: 0, aiCalls: 0 };
}

export async function activeCrawlCount(orgId: string): Promise<number> {
  const rows = await db()
    .select({ n: sql<number>`count(*)` })
    .from(crawls)
    .where(
      and(
        eq(crawls.organizationId, orgId),
        inArray(crawls.status, ['queued', 'running', 'paused', 'stopping', 'analysing']),
      ),
    );
  return rows[0]?.n ?? 0;
}

export async function recordAiCall(orgId: string): Promise<void> {
  await db()
    .insert(usage)
    .values({ organizationId: orgId, period: usagePeriod(), aiCalls: 1 })
    .onConflictDoUpdate({
      target: [usage.organizationId, usage.period],
      set: { aiCalls: sql`${usage.aiCalls} + 1` },
    });
}
