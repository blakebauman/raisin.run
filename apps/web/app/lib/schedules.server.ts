import { projects, schedules } from '@raisin/db';
import { and, eq, lte } from 'drizzle-orm';
import { LimitError, startCrawl } from './crawls.server';
import { db } from './env.server';
import { getPlan } from './plans.server';
import { nextRun } from './schedule-time';

/** Cron entry point: start every due, enabled schedule whose plan still includes schedules. */
export async function runDueSchedules(
  now = new Date(),
): Promise<{ started: number; skipped: number }> {
  const database = db();
  const due = await database
    .select({ schedule: schedules, project: projects })
    .from(schedules)
    .innerJoin(projects, eq(projects.id, schedules.projectId))
    .where(and(eq(schedules.enabled, true), lte(schedules.nextRunAt, now)))
    .limit(50);
  let started = 0;
  let skipped = 0;
  for (const { schedule, project } of due) {
    await database
      .update(schedules)
      .set({ lastRunAt: now, nextRunAt: nextRun(schedule.frequency, schedule.hourUtc, now) })
      .where(eq(schedules.id, schedule.id));
    const plan = await getPlan(schedule.organizationId);
    if (!plan.schedules) {
      skipped++;
      continue;
    }
    try {
      await startCrawl({
        orgId: schedule.organizationId,
        userId: null,
        project,
        trigger: 'schedule',
      });
      started++;
    } catch (e) {
      skipped++;
      if (!(e instanceof LimitError))
        console.error('scheduled crawl failed to start', schedule.id, e);
    }
  }
  return { started, skipped };
}
