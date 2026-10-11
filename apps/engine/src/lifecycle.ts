/**
 * CrawlLifecycle: one Workflow instance per crawl, id = crawl id. Every phase is a durable,
 * retryable step, so a deploy or an isolate crash mid-crawl resumes where it stopped:
 *
 *   mark running → discover sitemaps → start the Crawl DO → wait for "drained"
 *   → analysis (link counts, redirect loops, near-duplicates, Link Score, audit rules)
 *   → AI similarity (optional) → baseline from the previous crawl → CSV export to R2
 *   → write the summary to D1.
 */

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import {
  checkTarget,
  crawlFinishedEmail,
  type IssueKey,
  parseSender,
  parseSitemap,
  parseTextSitemap,
  readSitemapBody,
  robotsFromStatus,
} from '@raisin/core';
import {
  addUsage,
  crawls,
  createDb,
  member,
  notificationPrefs,
  projects,
  usage,
  usagePeriod,
  user,
} from '@raisin/db';
import { and, desc, eq, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { exportCsv } from './export';
import { fetchRobots } from './robots-cache';

export type LifecycleParams = { crawlId: string; orgId: string; doName: string; ai: boolean };

const MAX_SITEMAP_FILES = 100;
const EMBED_BATCH = 50;
const SIMILAR_BATCH = 50;
const SEMANTIC_THRESHOLD = 0.92;
const PAGERANK_ITERATIONS = 10;
/** Audit results copied per baseline step: about 1 MB over RPC, well inside step limits. */
const BASELINE_BATCH = 20_000;
export const EMBEDDING_MODEL = '@cf/qwen/qwen3-embedding-0.6b';

const retry = {
  retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' },
  timeout: '10 minutes',
} as const;

export class CrawlLifecycle extends WorkflowEntrypoint<Env, LifecycleParams> {
  override async run(event: WorkflowEvent<LifecycleParams>, step: WorkflowStep): Promise<unknown> {
    const { crawlId, doName } = event.payload;
    const crawl = () => this.env.CRAWL.getByName(doName);
    const db = createDb(this.env.DB);

    try {
      await step.do('mark-running', retry, async () => {
        await db
          .update(crawls)
          .set({ status: 'running', startedAt: new Date() })
          .where(eq(crawls.id, crawlId));
      });

      const progress = await step.do('read-config', retry, async () => {
        const p = await crawl().progress();
        return { startUrl: p.config!.startUrl, userAgent: p.config!.userAgent };
      });

      // Sitemaps: robots.txt declarations plus /sitemap.xml, expanding indexes breadth-first.
      const queue = await step.do('discover-sitemaps', retry, async () => {
        const origin = new URL(progress.startUrl).origin;
        const snapshot = await fetchRobots(origin, progress.userAgent);
        const robots = robotsFromStatus(snapshot.status, snapshot.body);
        return [...new Set([...robots.sitemaps, `${origin}/sitemap.xml`])];
      });
      const seen = new Set<string>();
      for (let i = 0; i < queue.length && seen.size < MAX_SITEMAP_FILES; i++) {
        const url = queue[i]!;
        if (seen.has(url)) continue;
        seen.add(url);
        const children = await step.do(`sitemap-${i}`, retry, async () => {
          return this.loadSitemap(url, progress.userAgent, doName);
        });
        queue.push(...children);
      }

      await step.do('start', retry, async () => {
        await crawl().start();
      });

      await step.waitForEvent('drained', { type: 'drained', timeout: '30 days' });

      await step.do('mark-analysing', retry, async () => {
        const p = await crawl().progress();
        await db
          .update(crawls)
          .set({ status: 'analysing', urlsCrawled: p.crawled, urlsDiscovered: p.discovered })
          .where(eq(crawls.id, crawlId));
      });

      for (const s of ['sitemap-flags', 'link-counts', 'redirect-loops', 'near-duplicates']) {
        await step.do(`analyse-${s}`, retry, async () => crawl().analyse(s));
      }
      await step.do('analyse-pagerank-init', retry, async () => crawl().analyse('pagerank-init'));
      for (let i = 0; i < PAGERANK_ITERATIONS; i++) {
        await step.do(`analyse-pagerank-${i}`, retry, async () =>
          crawl().analyse('pagerank-iterate'),
        );
      }
      await step.do('analyse-pagerank-finish', retry, async () =>
        crawl().analyse('pagerank-finish'),
      );
      await step.do('analyse-page-types', retry, async () => crawl().analyse('page-types'));

      let aiCalls = 0;
      if (event.payload.ai) aiCalls = await this.semanticSimilarity(step, crawlId, doName);

      await step.do('analyse-page-rules', retry, async () => crawl().analyse('page-rules'));
      await step.do('analyse-crawl-rules', retry, async () => crawl().analyse('crawl-rules'));
      await this.loadBaseline(step, crawlId, crawl);

      const exportKey = await step.do('export', retry, async () => {
        const key = `exports/${event.payload.orgId}/${crawlId}/internal.csv`;
        await exportCsv(this.env.BUCKET, key, (q) => crawl().grid(q), { tab: 'internal' });
        return key;
      });

      await step.do('finalize', retry, async () => {
        const stub = crawl();
        const [p, summary] = await Promise.all([stub.progress(), stub.issueSummary()]);
        const byRule = Object.fromEntries(
          summary.rules.filter((r) => r.count > 0).map((r) => [r.id, r.count]),
        );
        await db
          .update(crawls)
          .set({
            status: 'completed',
            renderedPages: p.rendered,
            finishedAt: new Date(),
            urlsCrawled: p.crawled,
            urlsDiscovered: p.discovered,
            summaryJson: JSON.stringify({ ...summary.totals, byRule }),
            exportKey,
          })
          .where(eq(crawls.id, crawlId));
        const rendered = p.rendered;
        await db
          .insert(usage)
          .values({
            organizationId: event.payload.orgId,
            period: usagePeriod(),
            crawledUrls: p.crawled,
            renderedPages: rendered,
            aiCalls,
          })
          .onConflictDoUpdate({
            target: [usage.organizationId, usage.period],
            set: {
              crawledUrls: sql`${usage.crawledUrls} + ${p.crawled}`,
              renderedPages: sql`${usage.renderedPages} + ${rendered}`,
              aiCalls: sql`${usage.aiCalls} + ${aiCalls}`,
            },
          });
        await stub.setStatus('completed');
      });

      // Its own step, after the crawl is marked complete: a failed email never fails the crawl,
      // and a replayed Workflow doesn't send it twice.
      await step.do(
        'notify',
        { retries: { limit: 2, delay: '30 seconds' }, timeout: '1 minute' },
        async () => this.notify(crawlId),
      );
      return { ok: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await step.do('mark-failed', retry, async () => {
        await db
          .update(crawls)
          .set({ status: 'failed', error: message.slice(0, 1000), finishedAt: new Date() })
          .where(eq(crawls.id, crawlId));
        // Finalize never ran, so count what the crawl consumed before it failed.
        const p = await crawl().progress();
        await addUsage(db, event.payload.orgId, {
          crawledUrls: p.crawled,
          renderedPages: p.rendered,
        });
        await crawl().setStatus('failed');
      });
      throw e;
    }
  }

  /**
   * Email the crawl's summary: to whoever started it, or, for scheduled and API crawls, to the
   * organization's owners and admins. Returns how many messages were sent.
   */
  private async notify(crawlId: string): Promise<number> {
    const from = parseSender(this.env.EMAIL_FROM ?? '');
    if (!from) return 0;
    const db = createDb(this.env.DB);
    const rows = await db
      .select({ crawl: crawls, projectName: projects.name })
      .from(crawls)
      .innerJoin(projects, eq(projects.id, crawls.projectId))
      .where(eq(crawls.id, crawlId))
      .limit(1);
    const row = rows[0];
    if (!row) return 0;
    const { crawl } = row;

    // People who turned crawl emails off in Settings are skipped; no preference row means on.
    const wantsEmail = or(
      isNull(notificationPrefs.userId),
      eq(notificationPrefs.crawlFinished, true),
    );
    const recipients = crawl.createdBy
      ? await db
          .select({ email: user.email })
          .from(user)
          .leftJoin(notificationPrefs, eq(notificationPrefs.userId, user.id))
          .where(and(eq(user.id, crawl.createdBy), wantsEmail))
      : await db
          .select({ email: user.email })
          .from(member)
          .innerJoin(user, eq(user.id, member.userId))
          .leftJoin(notificationPrefs, eq(notificationPrefs.userId, user.id))
          .where(
            and(
              eq(member.organizationId, crawl.organizationId),
              inArray(member.role, ['owner', 'admin']),
              wantsEmail,
            ),
          );
    if (!recipients.length) return 0;

    const summary = await this.env.CRAWL.getByName(crawl.doName).issueSummary();
    const change = summary.baseline
      ? summary.rules.reduce((acc, r) => ({ new: acc.new + r.new, fixed: acc.fixed + r.fixed }), {
          new: 0,
          fixed: 0,
        })
      : null;
    const content = crawlFinishedEmail({
      projectName: row.projectName,
      startUrl: crawl.startUrl,
      crawled: crawl.urlsCrawled,
      totals: summary.totals,
      change,
      link: `${this.env.APP_URL}/app/crawls/${crawl.id}`,
    });

    let sent = 0;
    for (const { email } of recipients) {
      try {
        await this.env.EMAIL.send({ from, to: email, ...content });
        sent++;
      } catch (e) {
        const err = e as { code?: string; message?: string };
        console.error('crawl notice failed', err.code ?? '', err.message ?? String(e));
      }
    }
    return sent;
  }

  /**
   * Copies the project's previous completed crawl's audit results into this crawl, so the
   * dashboard can show which issues are new and which were fixed. URL ids hash the normalised
   * URL, so a key from one crawl names the same URL in the next.
   */
  private async loadBaseline(
    step: WorkflowStep,
    crawlId: string,
    crawl: () => ReturnType<Env['CRAWL']['getByName']>,
  ): Promise<void> {
    const db = createDb(this.env.DB);
    const previous = await step.do('baseline-find', retry, async () => {
      const self = await db
        .select({ projectId: crawls.projectId, createdAt: crawls.createdAt })
        .from(crawls)
        .where(eq(crawls.id, crawlId))
        .limit(1);
      if (!self[0]) return null;
      const rows = await db
        .select({ id: crawls.id, doName: crawls.doName, createdAt: crawls.createdAt })
        .from(crawls)
        .where(
          and(
            eq(crawls.projectId, self[0].projectId),
            eq(crawls.status, 'completed'),
            ne(crawls.id, crawlId),
            lte(crawls.createdAt, self[0].createdAt),
          ),
        )
        .orderBy(desc(crawls.createdAt))
        .limit(1);
      const prev = rows[0];
      if (!prev) return null;
      // A crawl purged by retention has no results left; comparing with it would call
      // every current issue new.
      const p = await this.env.CRAWL.getByName(prev.doName).progress();
      if (p.status !== 'completed') return null;
      return { crawlId: prev.id, doName: prev.doName, createdAt: prev.createdAt.getTime() };
    });
    if (!previous) return;

    await step.do('baseline-begin', retry, async () => crawl().baselineBegin());
    let after: IssueKey | null = null;
    for (let i = 0; ; i++) {
      const cursor: IssueKey | null = after;
      const last: IssueKey | null = await step.do(`baseline-${i}`, retry, async () => {
        const keys = await this.env.CRAWL.getByName(previous.doName).issueKeys(
          cursor,
          BASELINE_BATCH,
        );
        if (keys.length) await crawl().baselineAdd(keys);
        return keys.length === BASELINE_BATCH ? keys[keys.length - 1]! : null;
      });
      if (!last) break;
      after = last;
    }
    await step.do('baseline-finish', retry, async () =>
      crawl().baselineFinish({ crawlId: previous.crawlId, createdAt: previous.createdAt }),
    );
  }

  /** Fetch one sitemap, record it in the Crawl DO, and return child sitemaps of an index. */
  private async loadSitemap(url: string, userAgent: string, doName: string): Promise<string[]> {
    const crawl = this.env.CRAWL.getByName(doName);
    // Sitemap URLs come from the site itself (robots.txt, sitemap indexes): hold them to the
    // same target rules as any crawled URL.
    const target = checkTarget(url);
    if (!target.ok) {
      await crawl.addSitemap({ url, status: 0, error: target.reason, urls: [] });
      return [];
    }
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'user-agent': userAgent },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      await crawl.addSitemap({
        url,
        status: 0,
        error: e instanceof Error ? e.message : 'Fetch failed',
        urls: [],
      });
      return [];
    }
    if (!res.ok) {
      await res.body?.cancel();
      // A missing default /sitemap.xml is normal; record only sitemaps that were declared or linked.
      if (!(res.status === 404 && url.endsWith('/sitemap.xml'))) {
        await crawl.addSitemap({ url, status: res.status, error: res.statusText, urls: [] });
      }
      return [];
    }
    const body = await readSitemapBody(res, url);
    const parsed = parseSitemap(body);
    if (parsed.kind === 'index') {
      await crawl.addSitemap({ url, status: res.status, error: null, urls: [] });
      return parsed.sitemaps;
    }
    const urls =
      parsed.kind === 'urlset'
        ? parsed.urls
        : parseTextSitemap(body).map((loc) => ({ loc, lastmod: null }));
    // Step outputs are capped at 1 MiB, so the DO stores the URLs and the step returns nothing large.
    await crawl.addSitemap({
      url,
      status: res.status,
      error: parsed.kind === 'unknown' && !urls.length ? 'Not a sitemap' : null,
      urls,
    });
    return [];
  }

  /** Embed indexable pages, then ask Vectorize for each page's nearest neighbours. */
  private async semanticSimilarity(
    step: WorkflowStep,
    crawlId: string,
    doName: string,
  ): Promise<number> {
    const crawl = () => this.env.CRAWL.getByName(doName);
    const gateway = this.env.AI_GATEWAY_ID
      ? { gateway: { id: this.env.AI_GATEWAY_ID } }
      : undefined;
    const ids: number[] = [];
    let cursor = 0;
    let calls = 0;
    for (let batch = 0; ; batch++) {
      const result = await step.do(`embed-${batch}`, retry, async () => {
        const rows = await crawl().textsForEmbedding(cursor, EMBED_BATCH);
        if (!rows.length) return { ids: [] as number[], last: cursor };
        const out = (await this.env.AI.run(
          EMBEDDING_MODEL as keyof AiModels,
          { text: rows.map((r) => r.text.slice(0, 6000)) } as never,
          gateway,
        )) as unknown as { data: number[][] };
        await vectors(this.env).upsert(
          rows.map((r, i) => ({
            id: `${crawlId}:${r.id}`,
            values: out.data[i]!,
            namespace: crawlId,
          })),
        );
        return { ids: rows.map((r) => r.id), last: rows[rows.length - 1]!.id };
      });
      if (!result.ids.length) break;
      ids.push(...result.ids);
      cursor = result.last;
      calls++;
    }
    if (ids.length < 2) return calls;

    // Vectorize indexes asynchronously; give fresh vectors a moment before querying them.
    await step.sleep('await-vector-index', '30 seconds');

    for (let i = 0; i < ids.length; i += SIMILAR_BATCH) {
      await step.do(`similar-${i / SIMILAR_BATCH}`, retry, async () => {
        const pairs: { a: number; b: number; score: number }[] = [];
        await Promise.all(
          ids.slice(i, i + SIMILAR_BATCH).map(async (id) => {
            const res = await vectors(this.env).queryById(`${crawlId}:${id}`, {
              topK: 4,
              namespace: crawlId,
            });
            for (const m of res.matches) {
              const other = Number(m.id.split(':')[1]);
              if (other !== id && m.score >= SEMANTIC_THRESHOLD)
                pairs.push({ a: id, b: other, score: m.score });
            }
          }),
        );
        if (pairs.length) await crawl().recordSemanticMatches(pairs);
      });
    }
    await step.do('semantic-finalize', retry, async () => crawl().finalizeSemantic());
    return calls;
  }
}

/** `wrangler types` still emits the V1 `VectorizeIndex` type; the binding is a V2 index. */
function vectors(env: Env): Vectorize {
  return env.VECTORS as unknown as Vectorize;
}
