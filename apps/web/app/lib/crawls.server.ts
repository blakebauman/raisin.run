/**
 * Starting crawls. The requested config is clamped by the org's plan and by domain
 * verification here, before anything reaches the engine — the engine trusts what it is given.
 */

import { type CrawlConfig, checkTarget, crawlDoName, defaultCrawlConfig } from '@raisin/core';
import { crawls, projects } from '@raisin/db';
import { and, eq } from 'drizzle-orm';
import { sanitizeOverrides } from './config-form';
import { db, engine } from './env.server';
import { newId } from './ids';
import { activeCrawlCount, getPlan, getUsage, UNVERIFIED_LIMITS } from './plans.server';

export type Project = typeof projects.$inferSelect;
export type Crawl = typeof crawls.$inferSelect;

export class LimitError extends Error {}

/** Fields a user may set on a crawl. Everything else comes from defaults or the plan. */
export type ConfigOverrides = Partial<
  Pick<
    CrawlConfig,
    | 'maxUrls'
    | 'maxDepth'
    | 'maxUrlsPerSecond'
    | 'userAgent'
    | 'customHeaders'
    | 'respectRobots'
    | 'respectNofollow'
    | 'respectCanonical'
    | 'crawlSubdomains'
    | 'checkExternalLinks'
    | 'crawlImages'
    | 'crawlCss'
    | 'crawlJs'
    | 'crawlSitemaps'
    | 'followHreflang'
    | 'followPagination'
    | 'include'
    | 'exclude'
    | 'storeHtml'
    | 'extractors'
  >
> & { render?: Partial<CrawlConfig['render']>; ai?: Partial<CrawlConfig['ai']> };

export async function getProject(orgId: string, projectId: string): Promise<Project | null> {
  const rows = await db()
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getCrawl(orgId: string, crawlId: string): Promise<Crawl | null> {
  const rows = await db()
    .select()
    .from(crawls)
    .where(and(eq(crawls.id, crawlId), eq(crawls.organizationId, orgId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function effectiveConfig(
  orgId: string,
  project: Project,
  overrides: ConfigOverrides = {},
) {
  const plan = await getPlan(orgId);
  const saved = sanitizeOverrides(safeParse<unknown>(project.configJson));
  overrides = sanitizeOverrides(overrides);
  const merged = { ...saved, ...overrides };
  const base = defaultCrawlConfig(project.startUrl);
  const verified = project.verifiedAt !== null;
  const notes: string[] = [];

  const config: CrawlConfig = {
    ...base,
    ...merged,
    startUrl: project.startUrl,
    render: { ...base.render, ...saved.render, ...overrides.render },
    ai: { ...base.ai, ...saved.ai, ...overrides.ai },
    customHeaders: merged.customHeaders ?? {},
    include: (merged.include ?? []).slice(0, 20),
    exclude: (merged.exclude ?? []).slice(0, 20),
    extractors: (merged.extractors ?? []).slice(0, 10),
  };

  let maxUrls = Math.min(config.maxUrls, plan.maxUrlsPerCrawl);
  let rate = Math.min(config.maxUrlsPerSecond, plan.maxUrlsPerSecond);
  if (!verified) {
    if (
      maxUrls > UNVERIFIED_LIMITS.maxUrls ||
      rate > UNVERIFIED_LIMITS.maxUrlsPerSecond ||
      !config.respectRobots
    ) {
      notes.push(
        'Verify this domain to crawl more than 500 URLs, faster than 2 URLs/s, or ignore robots.txt.',
      );
    }
    maxUrls = Math.min(maxUrls, UNVERIFIED_LIMITS.maxUrls);
    rate = Math.min(rate, UNVERIFIED_LIMITS.maxUrlsPerSecond);
    config.respectRobots = true;
  }
  config.maxUrls = Math.max(1, maxUrls);
  config.maxUrlsPerSecond = Math.max(0.2, rate);
  config.maxInFlight = Math.max(5, Math.min(100, Math.ceil(config.maxUrlsPerSecond * 10)));
  config.maxDepth = Math.max(0, Math.min(config.maxDepth, 50));
  if (config.render.enabled && !plan.rendering) {
    config.render.enabled = false;
    notes.push(`JavaScript rendering is not included in the ${plan.name} plan.`);
  }
  if (config.ai.nearDuplicates && !plan.ai) {
    config.ai.nearDuplicates = false;
    notes.push(`AI similarity is not included in the ${plan.name} plan.`);
  }
  config.render.timeoutMs = Math.max(5_000, Math.min(config.render.timeoutMs, 30_000));
  return { config, plan, notes };
}

export async function startCrawl(input: {
  orgId: string;
  userId: string | null;
  project: Project;
  overrides?: ConfigOverrides;
  trigger: 'manual' | 'schedule' | 'api';
}): Promise<{ crawlId: string; notes: string[] }> {
  const target = checkTarget(input.project.startUrl);
  if (!target.ok) throw new LimitError(target.reason);
  const { config, plan, notes } = await effectiveConfig(
    input.orgId,
    input.project,
    input.overrides,
  );

  const [active, used] = await Promise.all([activeCrawlCount(input.orgId), getUsage(input.orgId)]);
  if (active >= plan.maxConcurrentCrawls) {
    throw new LimitError(
      `Your plan allows ${plan.maxConcurrentCrawls} crawl(s) at a time. Wait for a running crawl to finish.`,
    );
  }
  if (used.crawledUrls >= plan.monthlyUrls) {
    throw new LimitError(`You have used this month's ${plan.monthlyUrls.toLocaleString()} URLs.`);
  }
  config.maxUrls = Math.min(config.maxUrls, plan.monthlyUrls - used.crawledUrls);
  if (config.render.enabled && used.renderedPages >= plan.monthlyRenderedPages) {
    config.render.enabled = false;
    notes.push(
      "This month's rendering allowance is used up; this crawl runs without JavaScript rendering.",
    );
  }

  const crawlId = newId('crl');
  await db()
    .insert(crawls)
    .values({
      id: crawlId,
      organizationId: input.orgId,
      projectId: input.project.id,
      startUrl: config.startUrl,
      configJson: JSON.stringify(config),
      doName: crawlDoName(input.orgId, crawlId),
      trigger: input.trigger,
      createdBy: input.userId,
    });
  try {
    await engine().startCrawl({
      crawlId,
      orgId: input.orgId,
      config,
      ai: config.ai.nearDuplicates,
    });
  } catch (e) {
    await db()
      .update(crawls)
      .set({
        status: 'failed',
        error: e instanceof Error ? e.message : String(e),
        finishedAt: new Date(),
      })
      .where(eq(crawls.id, crawlId));
    throw e;
  }
  return { crawlId, notes };
}

export function safeParse<T>(json: string | null | undefined): T {
  try {
    return (json ? JSON.parse(json) : {}) as T;
  } catch {
    return {} as T;
  }
}
