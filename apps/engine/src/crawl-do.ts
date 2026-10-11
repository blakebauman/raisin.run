/**
 * One Durable Object per crawl. It owns:
 * - the frontier: every discovered URL, deduplicated by id, dispatched breadth-first at the
 *   crawl's configured rate by an alarm loop, with leases so a lost queue message is retried;
 * - the results: pages, links, images, hreflang and issues, in its SQLite database, which the
 *   dashboard queries directly over RPC;
 * - live progress, pushed to dashboards over hibernatable WebSockets.
 *
 * Queue consumers do the fetching and parsing; this object only does bookkeeping, so one crawl's
 * throughput is bounded by SQLite writes, not by CPU spent parsing HTML.
 */

import { DurableObject } from 'cloudflare:workers';
import {
  buildGridSql,
  CRAWL_RULES,
  CRAWL_SCHEMA,
  type CrawlConfig,
  type CrawlStatus,
  compileFilters,
  type DiscoveryVia,
  type FetchMode,
  type FetchOptions,
  type FetchResult,
  type FetchTask,
  type GridQuery,
  type GridResult,
  groupPageTypes,
  hammingDistance,
  type IssueBaseline,
  type IssueKey,
  type IssueSummary,
  isInternal,
  type LinkRow,
  mapResult,
  normalizeUrl,
  type Overview,
  PAGE_RULES,
  type PageRow,
  type PageTypeNames,
  type PageTypeSummary,
  type ProgressResult,
  passesFilters,
  type Row,
  RULES,
  RULES_BY_ID,
  type Scope,
  scopeFor,
  simhashSimilarity,
  type UrlDetail,
  urlId,
} from '@raisin/core';

type Meta = {
  crawlId: string;
  orgId: string;
  doName: string;
  config: CrawlConfig;
  status: CrawlStatus;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  drainedNotified: boolean;
};

type Counters = {
  seq: number;
  discovered: number;
  pending: number;
  leased: number;
  done: number;
  failed: number;
  dispatched: number;
  rendered: number;
  tokens: number;
  lastTick: number;
  buckets: Record<string, number>;
};

export type InitInput = { crawlId: string; orgId: string; doName: string; config: CrawlConfig };

const TICK_MS = 1_000;
const LEASE_MS = { fetch: 3 * 60_000, render: 6 * 60_000 };
const MAX_ATTEMPTS = 3;
const SEND_BATCH = 100;
const BROADCAST_MS = 1_000;
const MAX_DISPATCH_PER_TICK = 500;

export class CrawlDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private meta: Meta | null = null;
  private counters: Counters = emptyCounters();
  private scopeCache: { scope: Scope; include: RegExp[]; exclude: RegExp[] } | null = null;
  private lastBroadcast = 0;
  private rate: { at: number; done: number }[] = [];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      for (const stmt of CRAWL_SCHEMA) this.sql.exec(stmt);
      this.sql.exec('CREATE TABLE IF NOT EXISTS scratch_ids (id INTEGER PRIMARY KEY)');
      this.meta = this.readMeta('meta');
      this.counters = this.readMeta<Counters>('counters') ?? emptyCounters();
    });
  }

  // ── Lifecycle RPC ────────────────────────────────────────────────────────────

  /** Idempotent: a retried Workflow step must not reset a crawl that already started. */
  init(input: InitInput): void {
    if (this.meta) return;
    this.meta = {
      ...input,
      status: 'queued',
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      drainedNotified: false,
    };
    this.saveMeta();
  }

  /** Record a fetched sitemap and, when the crawl follows sitemaps, queue its URLs. */
  addSitemap(sitemap: {
    url: string;
    status: number;
    error: string | null;
    urls: { loc: string; lastmod: string | null }[];
  }): number {
    const meta = this.requireMeta();
    let added = 0;
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        'INSERT OR REPLACE INTO sitemaps (url, status, url_count, error) VALUES (?, ?, ?, ?)',
        sitemap.url,
        sitemap.status,
        sitemap.urls.length,
        sitemap.error,
      );
      const { scope } = this.scope();
      for (const { loc, lastmod } of sitemap.urls) {
        const url = normalizeUrl(loc);
        if (!url) continue;
        const id = urlId(url);
        this.sql.exec(
          'INSERT OR IGNORE INTO sitemap_urls (id, url, lastmod) VALUES (?, ?, ?)',
          id,
          url,
          lastmod,
        );
        if (
          meta.config.crawlSitemaps &&
          isInternal(url, scope) &&
          this.addToFrontier(url, 1, 'sitemap', null, 'page', true)
        ) {
          added++;
        }
      }
      this.saveCounters();
    });
    return added;
  }

  start(): void {
    const meta = this.requireMeta();
    if (meta.status !== 'queued') return;
    const start = normalizeUrl(meta.config.startUrl);
    if (!start) throw new Error('Invalid start URL');
    this.ctx.storage.transactionSync(() => {
      this.addToFrontier(start, 0, 'seed', null, 'page', true);
      meta.status = 'running';
      meta.startedAt = Date.now();
      this.counters.lastTick = Date.now();
      this.counters.tokens = meta.config.maxUrlsPerSecond;
      this.saveMeta();
      this.saveCounters();
    });
    void this.ctx.storage.setAlarm(Date.now());
    this.broadcast(true);
  }

  pause(): CrawlStatus {
    const meta = this.requireMeta();
    if (meta.status === 'running') {
      meta.status = 'paused';
      this.saveMeta();
      this.broadcast(true);
    }
    return meta.status;
  }

  resume(): CrawlStatus {
    const meta = this.requireMeta();
    if (meta.status === 'paused') {
      meta.status = 'running';
      this.counters.lastTick = Date.now();
      this.saveMeta();
      void this.ctx.storage.setAlarm(Date.now());
      this.broadcast(true);
    }
    return meta.status;
  }

  /** Stop dispatching; analysis then runs on whatever has been crawled. */
  stop(): CrawlStatus {
    const meta = this.requireMeta();
    if (meta.status === 'running' || meta.status === 'paused' || meta.status === 'queued') {
      meta.status = 'stopping';
      this.saveMeta();
      void this.ctx.storage.setAlarm(Date.now());
      this.broadcast(true);
    }
    return meta.status;
  }

  setStatus(status: CrawlStatus): void {
    const meta = this.requireMeta();
    meta.status = status;
    if (status === 'completed' || status === 'failed' || status === 'cancelled')
      meta.finishedAt = Date.now();
    this.saveMeta();
    this.broadcast(true);
  }

  // ── Dispatch loop ────────────────────────────────────────────────────────────

  override async alarm(): Promise<void> {
    const meta = this.meta;
    if (!meta) return;
    if (meta.status !== 'running' && meta.status !== 'stopping') return;
    const now = Date.now();

    this.expireLeases(now);

    const c = this.counters;
    const cfg = meta.config;
    const elapsed = Math.max(0, now - c.lastTick) / 1000;
    c.lastTick = now;
    c.tokens = Math.min(
      c.tokens + elapsed * cfg.maxUrlsPerSecond,
      Math.max(cfg.maxUrlsPerSecond * 2, 1),
    );

    let batch: { id: number; url: string; depth: number; mode: FetchMode; attempts: number }[] = [];
    if (meta.status === 'running') {
      const budget = Math.floor(
        Math.min(
          c.tokens,
          cfg.maxInFlight - c.leased,
          cfg.maxUrls - c.dispatched,
          MAX_DISPATCH_PER_TICK,
        ),
      );
      if (budget > 0) {
        batch = this.sql
          .exec<{ id: number; url: string; depth: number; mode: FetchMode; attempts: number }>(
            `SELECT id, url, depth, mode, attempts FROM frontier WHERE state = 'pending' ORDER BY depth, seq LIMIT ?`,
            budget,
          )
          .toArray();
      }
    }

    if (batch.length) {
      const render = cfg.render.enabled;
      this.ctx.storage.transactionSync(() => {
        for (const row of batch) {
          const lease = render && row.mode === 'page' ? LEASE_MS.render : LEASE_MS.fetch;
          this.sql.exec(
            `UPDATE frontier SET state = 'leased', attempts = attempts + 1, lease_until = ? WHERE id = ?`,
            now + lease,
            row.id,
          );
        }
        c.pending -= batch.length;
        c.leased += batch.length;
        c.dispatched += batch.length;
        c.tokens -= batch.length;
        this.saveCounters();
      });
      await this.send(batch, meta);
    } else {
      this.saveCounters();
    }

    const exhausted = c.pending <= 0 || c.dispatched >= cfg.maxUrls || meta.status === 'stopping';
    if (exhausted && c.leased <= 0) {
      await this.drained();
      return;
    }
    await this.ctx.storage.setAlarm(now + TICK_MS);
    this.broadcast();
  }

  private async send(
    batch: { id: number; url: string; depth: number; mode: FetchMode; attempts: number }[],
    meta: Meta,
  ): Promise<void> {
    const opts = this.fetchOptions(meta.config);
    const { scope } = this.scope();
    const toRender: FetchTask[] = [];
    const toFetch: FetchTask[] = [];
    for (const row of batch) {
      // Custom headers are often credentials for the site being crawled (staging auth, cookies).
      // Never send them to external links or third-party resources.
      const headers = isInternal(row.url, scope) ? opts.headers : {};
      const task: FetchTask = {
        crawlId: meta.crawlId,
        doName: meta.doName,
        urlId: row.id,
        url: row.url,
        depth: row.depth,
        mode: row.mode,
        attempt: row.attempts + 1,
        opts:
          row.mode === 'page'
            ? { ...opts, headers }
            : { ...opts, headers, render: null, extractors: [], keepText: false },
      };
      (opts.render && row.mode === 'page' ? toRender : toFetch).push(task);
    }
    for (let i = 0; i < toFetch.length; i += SEND_BATCH) {
      await this.env.FETCH_QUEUE.sendBatch(
        toFetch.slice(i, i + SEND_BATCH).map((body) => ({ body })),
      );
    }
    for (let i = 0; i < toRender.length; i += SEND_BATCH) {
      await this.env.RENDER_QUEUE.sendBatch(
        toRender.slice(i, i + SEND_BATCH).map((body) => ({ body })),
      );
    }
  }

  private fetchOptions(cfg: CrawlConfig): FetchOptions {
    return {
      userAgent: cfg.userAgent,
      headers: cfg.customHeaders,
      respectRobots: cfg.respectRobots,
      timeoutMs: cfg.requestTimeoutMs,
      storeHtml: cfg.storeHtml,
      render: cfg.render.enabled ? cfg.render : null,
      extractors: cfg.extractors,
      keepText: cfg.ai.nearDuplicates,
    };
  }

  /** Leases that outlived their consumer go back to pending, or fail after MAX_ATTEMPTS. */
  private expireLeases(now: number): void {
    const expired = this.sql
      .exec<{
        id: number;
        url: string;
        depth: number;
        mode: FetchMode;
        attempts: number;
        internal: number;
      }>(
        `SELECT id, url, depth, mode, attempts, internal FROM frontier WHERE state = 'leased' AND lease_until < ?`,
        now,
      )
      .toArray();
    if (!expired.length) return;
    this.ctx.storage.transactionSync(() => {
      for (const row of expired) {
        this.counters.leased--;
        this.counters.dispatched--;
        if (row.attempts >= MAX_ATTEMPTS) {
          this.sql.exec(
            `UPDATE frontier SET state = 'done', lease_until = NULL WHERE id = ?`,
            row.id,
          );
          this.writePage(
            {
              id: row.id,
              url: row.url,
              internal: row.internal,
              mode: row.mode,
              depth: row.depth,
              status: 0,
              error: `No result after ${MAX_ATTEMPTS} attempts`,
              crawled_at: now,
            },
            null,
          );
          this.counters.dispatched++;
          this.counters.done++;
          this.counters.failed++;
          bump(this.counters.buckets, 'error');
        } else {
          this.sql.exec(
            `UPDATE frontier SET state = 'pending', lease_until = NULL WHERE id = ?`,
            row.id,
          );
          this.counters.pending++;
        }
      }
      this.saveCounters();
    });
  }

  private async drained(): Promise<void> {
    const meta = this.requireMeta();
    if (meta.drainedNotified) return;
    meta.status = 'analysing';
    meta.drainedNotified = true;
    this.saveMeta();
    this.broadcast(true);
    try {
      const instance = await this.env.LIFECYCLE.get(meta.crawlId);
      await instance.sendEvent({ type: 'drained', payload: { crawled: this.counters.done } });
    } catch (e) {
      // Let the next alarm retry the notification rather than strand the crawl.
      meta.drainedNotified = false;
      meta.status = 'stopping';
      this.saveMeta();
      console.error('drained notification failed', e);
      await this.ctx.storage.setAlarm(Date.now() + 10_000);
    }
  }

  // ── Ingest ───────────────────────────────────────────────────────────────────

  /** Called by queue consumers with finished fetches. Safe to call twice for the same URL. */
  ingest(results: FetchResult[]): { accepted: number } {
    const meta = this.requireMeta();
    const { scope } = this.scope();
    let accepted = 0;
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('DELETE FROM scratch_ids');
      for (const r of results) {
        const row = this.sql
          .exec<{ state: string; depth: number; internal: number }>(
            'SELECT state, depth, internal FROM frontier WHERE id = ?',
            r.urlId,
          )
          .toArray()[0];
        // Queues deliver at least once; a URL already done keeps its first result.
        if (!row || row.state === 'done') continue;

        const mapped = mapResult(r, scope);
        mapped.page.depth = row.depth;
        this.writePage(mapped.page, mapped.details, mapped.shape);

        const srcInternal = mapped.page.internal === 1;
        const pageNofollow = mapped.page.nofollow === 1;
        for (const link of mapped.links) {
          this.sql.exec(
            `INSERT INTO links (src, dst, type, anchor, alt, rel, position, nofollow, internal, js_only)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            link.src,
            link.dst,
            link.type,
            link.anchor || null,
            link.alt || null,
            link.rel || null,
            link.position,
            link.nofollow,
            link.internal,
            link.jsOnly,
          );
          if (srcInternal && r.mode === 'page')
            this.discover(link, row.depth, pageNofollow, meta.config);
        }
        const target = mapped.page.redirect_target as string | null;
        if (target && srcInternal) {
          const internal = isInternal(target, scope);
          if (internal || meta.config.checkExternalLinks) {
            this.addToFrontier(
              target,
              row.depth + 1,
              'redirect',
              r.urlId,
              internal ? r.mode : 'external',
              internal,
            );
          }
        }
        for (const img of mapped.images) {
          this.sql.exec(
            'INSERT INTO images (page_id, src_id, src, alt, width, height) VALUES (?, ?, ?, ?, ?, ?)',
            img.pageId,
            img.srcId,
            img.src,
            img.alt,
            img.width,
            img.height,
          );
        }
        for (const h of mapped.hreflang) {
          this.sql.exec(
            'INSERT INTO hreflang (page_id, lang, href_id, href) VALUES (?, ?, ?, ?)',
            h.pageId,
            h.lang,
            h.hrefId,
            h.href,
          );
        }

        this.sql.exec(
          `UPDATE frontier SET state = 'done', lease_until = NULL WHERE id = ?`,
          r.urlId,
        );
        this.sql.exec('INSERT OR IGNORE INTO scratch_ids (id) VALUES (?)', r.urlId);
        if (row.state === 'leased') this.counters.leased--;
        else if (row.state === 'pending') {
          // A result for a lease that already expired and was put back: take it anyway.
          this.counters.pending--;
          this.counters.dispatched++;
        }
        this.counters.done++;
        if (r.error) this.counters.failed++;
        if (r.render) this.counters.rendered++;
        bump(this.counters.buckets, bucketFor(r));
        accepted++;
      }

      this.sql.exec(
        'UPDATE pages SET in_sitemap = 1 WHERE id IN (SELECT id FROM scratch_ids) AND id IN (SELECT id FROM sitemap_urls)',
      );
      for (const rule of PAGE_RULES) {
        this.sql.exec(
          `INSERT OR IGNORE INTO issues (rule_id, url_id)
           SELECT ?, p.id FROM pages p WHERE p.id IN (SELECT id FROM scratch_ids) AND (${rule.where})`,
          rule.id,
        );
      }
      this.saveCounters();
    });

    this.rate.push({ at: Date.now(), done: this.counters.done });
    if (this.rate.length > 30) this.rate.shift();
    if (meta.status === 'running' || meta.status === 'stopping') {
      // Ingest frees in-flight slots; make sure the loop is ticking to refill them.
      void this.ctx.storage.getAlarm().then((at) => {
        if (at === null) return this.ctx.storage.setAlarm(Date.now() + 100);
      });
    }
    this.broadcast();
    return { accepted };
  }

  private discover(link: LinkRow, srcDepth: number, pageNofollow: boolean, cfg: CrawlConfig): void {
    const depth = srcDepth + 1;
    const internal = link.internal === 1;
    const { include, exclude } = this.scope();
    const page = () => {
      if (depth > cfg.maxDepth || !passesFilters(link.dstUrl, include, exclude)) return;
      this.addToFrontier(link.dstUrl, depth, viaFor(link.type), link.src, 'page', true);
    };
    const resource = (enabled: boolean, via: DiscoveryVia) => {
      if (!enabled) return;
      if (internal) this.addToFrontier(link.dstUrl, depth, via, link.src, 'resource', true);
      else if (cfg.checkExternalLinks)
        this.addToFrontier(link.dstUrl, depth, via, link.src, 'external', false);
    };
    switch (link.type) {
      case 'a':
        if (internal) {
          if (cfg.respectNofollow && (link.nofollow === 1 || pageNofollow)) return;
          page();
        } else if (cfg.checkExternalLinks) {
          this.addToFrontier(link.dstUrl, depth, 'link', link.src, 'external', false);
        }
        return;
      case 'img':
        resource(cfg.crawlImages, 'image');
        return;
      case 'css':
        resource(cfg.crawlCss, 'css');
        return;
      case 'js':
        resource(cfg.crawlJs, 'js');
        return;
      case 'canonical':
        if (internal && cfg.respectCanonical) page();
        return;
      case 'hreflang':
        if (internal && cfg.followHreflang) page();
        return;
      case 'next':
      case 'prev':
        if (internal && cfg.followPagination) page();
        return;
      case 'iframe':
      case 'amphtml':
      case 'meta-refresh':
        if (internal) page();
        return;
    }
  }

  /** Insert a URL into the frontier if unseen. Returns whether it was new. */
  private addToFrontier(
    url: string,
    depth: number,
    via: DiscoveryVia,
    sourceId: number | null,
    mode: FetchMode,
    internal: boolean,
  ): boolean {
    const id = urlId(url);
    const seq = ++this.counters.seq;
    const cursor = this.sql.exec(
      `INSERT OR IGNORE INTO frontier (id, url, seq, depth, via, source_id, mode, internal, state, discovered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      id,
      url,
      seq,
      depth,
      via,
      sourceId,
      mode,
      internal ? 1 : 0,
      Date.now(),
    );
    if (cursor.rowsWritten === 0) return false;
    this.counters.discovered++;
    this.counters.pending++;
    return true;
  }

  private writePage(page: PageRow, details: PageRow | null, shape: PageRow | null = null): void {
    upsert(this.sql, 'pages', page);
    if (details) upsert(this.sql, 'page_details', details);
    if (shape) upsert(this.sql, 'page_shapes', shape);
    else this.sql.exec('DELETE FROM page_shapes WHERE id = ?', page.id);
  }

  // ── Queries for the dashboard ────────────────────────────────────────────────

  progress(): ProgressResult {
    const c = this.counters;
    const meta = this.meta;
    return {
      crawlId: meta?.crawlId ?? null,
      config: meta?.config ?? null,
      rendered: c.rendered,
      status: meta?.status ?? 'queued',
      discovered: c.discovered,
      crawled: c.done,
      inFlight: c.leased,
      pending: Math.max(0, Math.min(c.pending, (meta?.config.maxUrls ?? c.pending) - c.dispatched)),
      failed: c.failed,
      urlsPerSecond: this.urlsPerSecond(),
      statusBuckets: c.buckets,
      startedAt: meta?.startedAt ?? null,
      finishedAt: meta?.finishedAt ?? null,
    };
  }

  grid(q: GridQuery): GridResult {
    const built = buildGridSql(q);
    const rows = this.rows(built.sql, ...built.params);
    const total = this.sql.exec<{ n: number }>(built.countSql, ...built.params).one().n;
    return { columns: built.columns, rows, total };
  }

  issueSummary(): IssueSummary {
    const byRule = (sql: string) =>
      new Map(
        this.sql
          .exec<{ rule_id: string; n: number }>(sql)
          .toArray()
          .map((r) => [r.rule_id, r.n]),
      );
    const counts = byRule('SELECT rule_id, count(*) AS n FROM issues GROUP BY rule_id');
    const baseline = this.readMeta<IssueBaseline>('baseline');
    const added = baseline
      ? byRule(`SELECT i.rule_id, count(*) AS n FROM issues i WHERE NOT EXISTS (
          SELECT 1 FROM issue_baseline b WHERE b.rule_id = i.rule_id AND b.url_id = i.url_id)
          GROUP BY i.rule_id`)
      : new Map<string, number>();
    // Fixed only counts URLs this crawl fetched again; the grid's `fixed` filter agrees.
    const fixed = baseline
      ? byRule(`SELECT b.rule_id, count(*) AS n FROM issue_baseline b JOIN pages p ON p.id = b.url_id
          WHERE NOT EXISTS (SELECT 1 FROM issues i WHERE i.rule_id = b.rule_id AND i.url_id = b.url_id)
          GROUP BY b.rule_id`)
      : new Map<string, number>();
    const totals = { issue: 0, warning: 0, opportunity: 0 };
    const rules = RULES.map((r) => {
      const count = counts.get(r.id) ?? 0;
      totals[r.severity] += count;
      return {
        id: r.id,
        tab: r.tab,
        label: r.label,
        severity: r.severity,
        priority: r.priority,
        count,
        new: added.get(r.id) ?? 0,
        fixed: fixed.get(r.id) ?? 0,
      };
    });
    return { totals, rules, baseline };
  }

  // ── Comparison with the previous crawl (driven by the CrawlLifecycle Workflow) ──

  /** A page of this crawl's audit results after `after`, in primary-key order. */
  issueKeys(after: IssueKey | null, limit: number): IssueKey[] {
    const n = Math.min(Math.max(limit, 1), 50_000);
    return after
      ? this.sql
          .exec<IssueKey>(
            'SELECT rule_id, url_id FROM issues WHERE (rule_id, url_id) > (?, ?) ORDER BY rule_id, url_id LIMIT ?',
            after.rule_id,
            after.url_id,
            n,
          )
          .toArray()
      : this.sql
          .exec<IssueKey>('SELECT rule_id, url_id FROM issues ORDER BY rule_id, url_id LIMIT ?', n)
          .toArray();
  }

  /**
   * Baseline loading is three idempotent steps, so a retried Workflow step can't double-count:
   * `begin` empties the table and forgets any previous baseline, `add` inserts a page of keys
   * (ignoring ones already there), and `finish` records which crawl the keys came from. Until
   * `finish` runs the summary reports no baseline.
   */
  baselineBegin(): void {
    this.sql.exec('DELETE FROM issue_baseline');
    this.sql.exec(`DELETE FROM meta WHERE key = 'baseline'`);
  }

  baselineAdd(keys: IssueKey[]): void {
    for (const k of keys)
      this.sql.exec(
        'INSERT OR IGNORE INTO issue_baseline (rule_id, url_id) VALUES (?, ?)',
        k.rule_id,
        k.url_id,
      );
  }

  baselineFinish(baseline: IssueBaseline): void {
    this.sql.exec(
      'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
      'baseline',
      JSON.stringify(baseline),
    );
  }

  pageTypes(): PageTypeSummary[] {
    const types = this.sql
      .exec<{
        id: number;
        label: string;
        patterns_json: string;
        sd_type: string | null;
        page_count: number;
        indexable_count: number;
        sample_id: number;
        sample_url: string;
      }>(
        `SELECT t.id, t.label, t.patterns_json, t.sd_type, t.page_count, t.sample_id,
           s.url AS sample_url,
           (SELECT count(*) FROM page_shapes ps JOIN pages p ON p.id = ps.id
            WHERE ps.page_type_id = t.id AND p.indexable = 1) AS indexable_count
         FROM page_types t JOIN pages s ON s.id = t.sample_id
         ORDER BY t.id`,
      )
      .toArray();
    const issues = new Map<number, { ruleId: string; n: number }[]>();
    for (const r of this.sql
      .exec<{ type: number; rule_id: string; n: number }>(
        `SELECT s.page_type_id AS type, i.rule_id, count(*) AS n
         FROM issues i JOIN page_shapes s ON s.id = i.url_id
         WHERE s.page_type_id IS NOT NULL
         GROUP BY s.page_type_id, i.rule_id
         ORDER BY s.page_type_id, n DESC, i.rule_id`,
      )
      .toArray()) {
      const list = issues.get(r.type) ?? [];
      list.push({ ruleId: r.rule_id, n: r.n });
      issues.set(r.type, list);
    }
    return types.map((t) => ({
      id: t.id,
      label: t.label,
      patterns: JSON.parse(t.patterns_json) as string[],
      sdType: t.sd_type,
      pageCount: t.page_count,
      indexableCount: t.indexable_count,
      sample: { id: t.sample_id, url: t.sample_url },
      issues: issues.get(t.id) ?? [],
    }));
  }

  overview(): Overview {
    const one = <T>(sql: string) => this.sql.exec(sql).toArray() as T[];
    return {
      contentTypes: one<{ kind: string; n: number }>(
        `SELECT CASE WHEN is_html = 1 THEN 'HTML' WHEN is_image = 1 THEN 'Images'
           WHEN content_type LIKE 'text/css%' THEN 'CSS' WHEN content_type LIKE '%javascript%' THEN 'JavaScript'
           WHEN content_type LIKE 'application/pdf%' THEN 'PDF' ELSE 'Other' END AS kind, count(*) AS n
         FROM pages WHERE internal = 1 GROUP BY kind ORDER BY n DESC`,
      ),
      indexability: one<{ reason: string; n: number }>(
        `SELECT coalesce(indexability_reason, 'Indexable') AS reason, count(*) AS n
         FROM pages WHERE internal = 1 AND is_html = 1 GROUP BY reason ORDER BY n DESC`,
      ),
      depth: one<{ depth: number; n: number }>(
        `SELECT min(depth, 10) AS depth, count(*) AS n FROM pages WHERE internal = 1 AND is_html = 1 GROUP BY 1 ORDER BY 1`,
      ),
      responseTimes: one<{ bucket: string; n: number }>(
        `SELECT CASE WHEN response_ms < 200 THEN '<200ms' WHEN response_ms < 500 THEN '200–500ms'
           WHEN response_ms < 1000 THEN '0.5–1s' WHEN response_ms < 2000 THEN '1–2s' ELSE '>2s' END AS bucket,
           count(*) AS n FROM pages WHERE internal = 1 AND is_html = 1 AND status = 200 GROUP BY bucket`,
      ),
      // First path segment, ignoring any query string: /domains/root and /domains/ → /domains.
      directories: one<{ dir: string; n: number }>(
        `SELECT '/' || CASE WHEN instr(rest, '/') > 0 THEN substr(rest, 1, instr(rest, '/') - 1) ELSE rest END AS dir,
           count(*) AS n
         FROM (
           SELECT CASE WHEN instr(tail, '?') > 0 THEN substr(tail, 1, instr(tail, '?') - 1) ELSE tail END AS rest
           FROM (SELECT substr(url, instr(substr(url, 9), '/') + 9) AS tail FROM pages WHERE internal = 1 AND is_html = 1)
         )
         GROUP BY dir ORDER BY n DESC, dir LIMIT 25`,
      ),
      sitemaps: one<{ url: string; status: number; url_count: number; error: string | null }>(
        'SELECT url, status, url_count, error FROM sitemaps ORDER BY url',
      ),
    };
  }

  urlDetail(id: number): UrlDetail | null {
    const page = this.rows('SELECT * FROM pages WHERE id = ?', id)[0];
    const frontier = this.rows(
      'SELECT url, depth, via, source_id, state, attempts FROM frontier WHERE id = ?',
      id,
    )[0];
    if (!page && !frontier) return null;
    const details = this.rows('SELECT * FROM page_details WHERE id = ?', id)[0] ?? null;
    const inlinks = this.rows(
      `SELECT l.src AS id, f.url, l.type, l.anchor, l.alt, l.rel, l.nofollow, l.position, l.js_only
         FROM links l JOIN frontier f ON f.id = l.src WHERE l.dst = ? LIMIT 500`,
      id,
    );
    const outlinks = this.rows(
      `SELECT l.dst AS id, f.url, p.status, l.type, l.anchor, l.alt, l.rel, l.nofollow, l.internal, l.position, l.js_only
         FROM links l LEFT JOIN frontier f ON f.id = l.dst LEFT JOIN pages p ON p.id = l.dst WHERE l.src = ? LIMIT 1000`,
      id,
    );
    const images = this.rows(
      `SELECT i.src_id AS id, i.src, i.alt, i.width, i.height, p.size, p.status
         FROM images i LEFT JOIN pages p ON p.id = i.src_id WHERE i.page_id = ?`,
      id,
    );
    const hreflang = this.rows(
      `SELECT h.lang, h.href, p.status, EXISTS (SELECT 1 FROM hreflang r WHERE r.page_id = h.href_id AND r.href_id = h.page_id) AS returns
         FROM hreflang h LEFT JOIN pages p ON p.id = h.href_id WHERE h.page_id = ?`,
      id,
    );
    const issues = this.sql
      .exec<{ rule_id: string }>('SELECT rule_id FROM issues WHERE url_id = ?', id)
      .toArray()
      .map((r) => RULES_BY_ID.get(r.rule_id))
      .filter(Boolean)
      .map((r) => ({
        id: r!.id,
        label: r!.label,
        tab: r!.tab,
        severity: r!.severity,
        priority: r!.priority,
        description: r!.description,
        fix: r!.fix,
      }));
    const duplicates = this.rows(
      `SELECT d.kind, d.similarity, CASE WHEN d.a = ? THEN d.b ELSE d.a END AS id, f.url
         FROM duplicates d JOIN frontier f ON f.id = CASE WHEN d.a = ? THEN d.b ELSE d.a END
         WHERE d.a = ? OR d.b = ? ORDER BY d.similarity DESC LIMIT 50`,
      id,
      id,
      id,
      id,
    );
    return {
      page: page ?? null,
      frontier,
      details,
      inlinks,
      outlinks,
      images,
      hreflang,
      issues,
      duplicates,
      redirectChain: this.redirectChain(id),
    };
  }

  private redirectChain(id: number): { url: string; status: number }[] {
    const chain: { url: string; status: number }[] = [];
    const seen = new Set<number>();
    let current: number | null = id;
    while (current !== null && !seen.has(current) && chain.length < 15) {
      seen.add(current);
      const row: { url: string; status: number; redirect_target_id: number | null } | undefined =
        this.sql
          .exec<{ url: string; status: number; redirect_target_id: number | null }>(
            'SELECT url, status, redirect_target_id FROM pages WHERE id = ?',
            current,
          )
          .toArray()[0];
      if (!row) break;
      chain.push({ url: row.url, status: row.status });
      current = row.status >= 300 && row.status < 400 ? row.redirect_target_id : null;
    }
    return chain.length > 1 ? chain : [];
  }

  // ── Analysis (called step by step from the CrawlLifecycle Workflow) ─────────

  analyse(step: string): { ok: true; detail?: unknown } {
    switch (step) {
      case 'sitemap-flags':
        this.sql.exec(
          'UPDATE pages SET in_sitemap = CASE WHEN id IN (SELECT id FROM sitemap_urls) THEN 1 ELSE 0 END',
        );
        return { ok: true };
      case 'link-counts':
        this.linkCounts();
        return { ok: true };
      case 'redirect-loops':
        return { ok: true, detail: this.redirectLoops() };
      case 'near-duplicates':
        return { ok: true, detail: this.nearDuplicates() };
      case 'pagerank-init':
        this.pagerankInit();
        return { ok: true };
      case 'pagerank-iterate':
        this.pagerankIterate();
        return { ok: true };
      case 'pagerank-finish':
        this.pagerankFinish();
        return { ok: true };
      case 'page-rules':
        this.materialisePageRules();
        return { ok: true };
      case 'crawl-rules':
        return { ok: true, detail: this.materialiseCrawlRules() };
      default:
        throw new Error(`Unknown analysis step: ${step}`);
    }
  }

  /**
   * Rebuild `page_types` and `page_shapes.page_type_id` from URL patterns, template signatures
   * and the project's page-type names. Run at analysis, and again whenever someone renames,
   * merges or splits a type.
   */
  assignPageTypes(names: PageTypeNames = {}): number {
    const rows = this.sql
      .exec<{
        id: number;
        pattern: string;
        template: string;
        structuredTypes: string | null;
        linkScore: number | null;
      }>(
        `SELECT p.id, s.url_pattern AS pattern, s.tpl_minhash AS template,
           p.structured_types AS structuredTypes, p.link_score AS linkScore
         FROM pages p JOIN page_shapes s ON s.id = p.id
         WHERE p.status = 200`,
      )
      .toArray();
    const types = groupPageTypes(rows, names);
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('DELETE FROM page_types');
      this.sql.exec('UPDATE page_shapes SET page_type_id = NULL WHERE page_type_id IS NOT NULL');
      for (const t of types) {
        this.sql.exec(
          'INSERT INTO page_types (id, label, patterns_json, sd_type, page_count, sample_id) VALUES (?, ?, ?, ?, ?, ?)',
          t.id,
          t.label,
          JSON.stringify(t.patterns),
          t.sdType,
          t.pageIds.length,
          t.sampleId,
        );
        // Durable Object SQL binds at most 100 parameters per statement.
        for (let i = 0; i < t.pageIds.length; i += 99) {
          const ids = t.pageIds.slice(i, i + 99);
          this.sql.exec(
            `UPDATE page_shapes SET page_type_id = ? WHERE id IN (${ids.map(() => '?').join(', ')})`,
            t.id,
            ...ids,
          );
        }
      }
    });
    return types.length;
  }

  private linkCounts(): void {
    this.sql.exec(`
      UPDATE pages SET
        inlinks = coalesce((SELECT count(*) FROM links l WHERE l.dst = pages.id AND l.type IN ('a', 'img', 'iframe', 'css', 'js')), 0),
        unique_inlinks = coalesce((SELECT count(DISTINCT l.src) FROM links l WHERE l.dst = pages.id AND l.type IN ('a', 'img', 'iframe', 'css', 'js')), 0)`);
  }

  private redirectLoops(): number {
    const edges = new Map(
      this.sql
        .exec<{ id: number; target: number }>(
          'SELECT id, redirect_target_id AS target FROM pages WHERE status BETWEEN 300 AND 399 AND redirect_target_id IS NOT NULL',
        )
        .toArray()
        .map((r) => [r.id, r.target]),
    );
    const looping = new Set<number>();
    for (const startId of edges.keys()) {
      const path = new Set<number>();
      let node: number | undefined = startId;
      while (node !== undefined && edges.has(node)) {
        if (path.has(node)) {
          for (const p of path) looping.add(p);
          break;
        }
        path.add(node);
        node = edges.get(node);
      }
    }
    this.sql.exec(`DELETE FROM issues WHERE rule_id = 'response.redirect_loop'`);
    for (const id of looping) {
      this.sql.exec(
        `INSERT OR IGNORE INTO issues (rule_id, url_id) VALUES ('response.redirect_loop', ?)`,
        id,
      );
    }
    return looping.size;
  }

  /**
   * Simhash near-duplicates (≥ 95% similar = ≤ 3 differing bits). Candidates share a 16-bit band;
   * bands shared by more than 200 pages (boilerplate-only templates) are skipped to keep this
   * linear rather than quadratic.
   */
  private nearDuplicates(): number {
    this.sql.exec(`DELETE FROM duplicates WHERE kind = 'simhash'`);
    const eligible = (t: string) =>
      `${t}.internal = 1 AND ${t}.is_html = 1 AND ${t}.status = 200 AND ${t}.indexable = 1 AND ${t}.word_count >= 50`;
    const pairs = new Map<string, { a: number; b: number; sim: number }>();
    for (const band of ['sh0', 'sh1', 'sh2', 'sh3']) {
      const rows = this.sql
        .exec<{ a: number; b: number; ha: string; hb: string }>(
          `SELECT x.id AS a, y.id AS b, x.simhash AS ha, y.simhash AS hb
           FROM pages x JOIN pages y ON y.${band} = x.${band} AND y.id > x.id
           WHERE ${eligible('x')} AND ${eligible('y')} AND x.content_hash != y.content_hash
             AND x.${band} IN (SELECT q.${band} FROM pages q WHERE ${eligible('q')} GROUP BY q.${band} HAVING count(*) <= 200)`,
        )
        .toArray();
      for (const r of rows) {
        const key = `${r.a}:${r.b}`;
        if (pairs.has(key) || hammingDistance(r.ha, r.hb) > 3) continue;
        pairs.set(key, { a: r.a, b: r.b, sim: simhashSimilarity(r.ha, r.hb) });
      }
    }
    this.ctx.storage.transactionSync(() => {
      for (const p of pairs.values()) {
        this.sql.exec(
          `INSERT OR IGNORE INTO duplicates (a, b, kind, similarity) VALUES (?, ?, 'simhash', ?)`,
          p.a,
          p.b,
          p.sim,
        );
      }
      this.sql.exec(`
        UPDATE pages SET
          near_dup_count = (SELECT count(*) FROM duplicates d WHERE d.kind = 'simhash' AND (d.a = pages.id OR d.b = pages.id)),
          near_dup_max = (SELECT max(similarity) FROM duplicates d WHERE d.kind = 'simhash' AND (d.a = pages.id OR d.b = pages.id))`);
      this.sql.exec(`DELETE FROM issues WHERE rule_id = 'content.near_duplicate'`);
      this.sql.exec(
        `INSERT OR IGNORE INTO issues (rule_id, url_id) SELECT 'content.near_duplicate', id FROM pages WHERE near_dup_count > 0`,
      );
    });
    return pairs.size;
  }

  /** Link Score: PageRank over followed internal hyperlinks between 200 HTML pages, scaled 0–100. */
  private pagerankInit(): void {
    this.sql.exec('DROP TABLE IF EXISTS pr');
    this.sql.exec('DROP TABLE IF EXISTS pr_next');
    this.sql.exec(
      'CREATE TABLE pr (id INTEGER PRIMARY KEY, score REAL NOT NULL, outdeg INTEGER NOT NULL)',
    );
    this.sql.exec('CREATE TABLE pr_next (id INTEGER PRIMARY KEY, score REAL NOT NULL)');
    this.sql.exec(`
      INSERT INTO pr (id, score, outdeg)
      SELECT p.id, 1.0, (SELECT count(*) FROM links l JOIN pages d ON d.id = l.dst
                         WHERE l.src = p.id AND l.type = 'a' AND l.internal = 1 AND l.nofollow = 0
                           AND d.is_html = 1 AND d.status = 200)
      FROM pages p WHERE p.internal = 1 AND p.is_html = 1 AND p.status = 200`);
    const n = this.sql.exec<{ n: number }>('SELECT count(*) AS n FROM pr').one().n;
    if (n > 0) this.sql.exec('UPDATE pr SET score = 1.0 / ?', n);
  }

  private pagerankIterate(): void {
    const n = this.sql.exec<{ n: number }>('SELECT count(*) AS n FROM pr').one().n;
    if (n === 0) return;
    const d = 0.85;
    this.sql.exec('DELETE FROM pr_next');
    this.sql.exec(
      `INSERT INTO pr_next (id, score)
       SELECT t.id, ? + ? * coalesce((
         SELECT sum(s.score / s.outdeg) FROM links l JOIN pr s ON s.id = l.src
         WHERE l.dst = t.id AND l.type = 'a' AND l.internal = 1 AND l.nofollow = 0 AND s.outdeg > 0), 0)
       FROM pr t`,
      (1 - d) / n,
      d,
    );
    this.sql.exec('UPDATE pr SET score = (SELECT score FROM pr_next WHERE pr_next.id = pr.id)');
  }

  private pagerankFinish(): void {
    const range = this.sql
      .exec<{ lo: number | null; hi: number | null }>(
        'SELECT min(score) AS lo, max(score) AS hi FROM pr',
      )
      .one();
    if (range.lo !== null && range.hi !== null && range.hi > range.lo) {
      const lo = Math.max(range.lo, 1e-12);
      this.sql.exec(
        `UPDATE pages SET link_score = (SELECT round(100.0 * ln(max(pr.score, ?) / ?) / ln(? / ?), 0) FROM pr WHERE pr.id = pages.id)
         WHERE id IN (SELECT id FROM pr)`,
        lo,
        lo,
        range.hi,
        lo,
      );
    } else if (range.hi !== null) {
      this.sql.exec('UPDATE pages SET link_score = 100 WHERE id IN (SELECT id FROM pr)');
    }
    this.sql.exec('DROP TABLE IF EXISTS pr');
    this.sql.exec('DROP TABLE IF EXISTS pr_next');
  }

  private materialisePageRules(): void {
    this.ctx.storage.transactionSync(() => {
      for (const rule of PAGE_RULES) {
        this.sql.exec('DELETE FROM issues WHERE rule_id = ?', rule.id);
        this.sql.exec(
          `INSERT OR IGNORE INTO issues (rule_id, url_id) SELECT ?, p.id FROM pages p WHERE ${rule.where}`,
          rule.id,
        );
      }
    });
  }

  private materialiseCrawlRules(): Record<string, number> {
    const out: Record<string, number> = {};
    this.ctx.storage.transactionSync(() => {
      for (const rule of CRAWL_RULES) {
        this.sql.exec('DELETE FROM issues WHERE rule_id = ?', rule.id);
        // Every crawl rule selects exactly one column: the URL id.
        const cursor = this.sql.exec(
          `INSERT OR IGNORE INTO issues (rule_id, url_id) SELECT ?, * FROM (${rule.sql})`,
          rule.id,
        );
        out[rule.id] = cursor.rowsWritten;
      }
    });
    return out;
  }

  // ── AI similarity support ────────────────────────────────────────────────────

  textsForEmbedding(afterId: number, limit: number): { id: number; text: string }[] {
    return this.sql
      .exec<{ id: number; text: string }>(
        `SELECT d.id, d.text FROM page_details d JOIN pages p ON p.id = d.id
         WHERE d.id > ? AND p.internal = 1 AND p.is_html = 1 AND p.status = 200 AND p.indexable = 1
           AND d.text IS NOT NULL AND length(d.text) >= 200
         ORDER BY d.id LIMIT ?`,
        afterId,
        limit,
      )
      .toArray();
  }

  recordSemanticMatches(pairs: { a: number; b: number; score: number }[]): void {
    this.ctx.storage.transactionSync(() => {
      for (const p of pairs) {
        const [a, b] = p.a < p.b ? [p.a, p.b] : [p.b, p.a];
        this.sql.exec(
          `INSERT OR REPLACE INTO duplicates (a, b, kind, similarity) VALUES (?, ?, 'semantic', ?)`,
          a,
          b,
          Math.round(p.score * 1000) / 1000,
        );
      }
    });
  }

  finalizeSemantic(): number {
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(`
        UPDATE pages SET
          semantic_dup_count = (SELECT count(*) FROM duplicates d WHERE d.kind = 'semantic' AND (d.a = pages.id OR d.b = pages.id)),
          semantic_dup_max = (SELECT max(similarity) FROM duplicates d WHERE d.kind = 'semantic' AND (d.a = pages.id OR d.b = pages.id))`);
      this.sql.exec(`DELETE FROM issues WHERE rule_id = 'content.semantic_duplicate'`);
      this.sql.exec(
        `INSERT OR IGNORE INTO issues (rule_id, url_id) SELECT 'content.semantic_duplicate', id FROM pages WHERE semantic_dup_count > 0`,
      );
    });
    return this.sql
      .exec<{ n: number }>(`SELECT count(*) AS n FROM duplicates WHERE kind = 'semantic'`)
      .one().n;
  }

  /** Whether `src` is one of the images the crawl found on page `id`. */
  pageHasImage(id: number, src: string): boolean {
    return (
      this.sql.exec('SELECT 1 FROM images WHERE page_id = ? AND src = ? LIMIT 1', id, src).toArray()
        .length > 0
    );
  }

  pageForSuggestion(id: number): {
    url: string;
    title: string | null;
    h1: string | null;
    metaDesc: string | null;
    text: string | null;
  } | null {
    return (
      this.sql
        .exec<{
          url: string;
          title: string | null;
          h1: string | null;
          metaDesc: string | null;
          text: string | null;
        }>(
          `SELECT p.url, p.title, p.h1, p.meta_desc AS metaDesc, d.text FROM pages p LEFT JOIN page_details d ON d.id = p.id WHERE p.id = ?`,
          id,
        )
        .toArray()[0] ?? null
    );
  }

  /** Permanently delete this crawl's data. */
  async destroy(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) ws.close(1000, 'Crawl deleted');
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.meta = null;
    this.counters = emptyCounters();
  }

  // ── WebSocket progress ───────────────────────────────────────────────────────

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ type: 'progress', data: this.progress() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (message === 'ping') ws.send(JSON.stringify({ type: 'progress', data: this.progress() }));
  }

  override webSocketClose(ws: WebSocket, code: number): void {
    ws.close(code === 1005 ? 1000 : code, 'closing');
  }

  private broadcast(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastBroadcast < BROADCAST_MS) return;
    this.lastBroadcast = now;
    const sockets = this.ctx.getWebSockets();
    if (!sockets.length) return;
    const message = JSON.stringify({ type: 'progress', data: this.progress() });
    for (const ws of sockets) {
      try {
        ws.send(message);
      } catch {
        // Closed sockets are cleaned up by webSocketClose.
      }
    }
  }

  private rows(query: string, ...params: (string | number | null)[]): Row[] {
    return this.sql.exec(query, ...params).toArray() as Row[];
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private urlsPerSecond(): number {
    const first = this.rate[0];
    const last = this.rate[this.rate.length - 1];
    if (!first || !last || last.at - first.at < 1000) return 0;
    return Math.round(((last.done - first.done) / ((last.at - first.at) / 1000)) * 10) / 10;
  }

  private scope() {
    if (!this.scopeCache) {
      const cfg = this.requireMeta().config;
      this.scopeCache = {
        scope: scopeFor(cfg.startUrl, cfg.crawlSubdomains),
        include: compileFilters(cfg.include),
        exclude: compileFilters(cfg.exclude),
      };
    }
    return this.scopeCache;
  }

  private requireMeta(): Meta {
    if (!this.meta) throw new Error('Crawl not initialised');
    return this.meta;
  }

  private readMeta<T = Meta>(key: string): T | null {
    const row = this.sql
      .exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', key)
      .toArray()[0];
    return row ? (JSON.parse(row.value) as T) : null;
  }

  private saveMeta(): void {
    this.sql.exec(
      'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
      'meta',
      JSON.stringify(this.meta),
    );
  }

  private saveCounters(): void {
    this.sql.exec(
      'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
      'counters',
      JSON.stringify(this.counters),
    );
  }
}

function emptyCounters(): Counters {
  return {
    seq: 0,
    discovered: 0,
    pending: 0,
    leased: 0,
    done: 0,
    failed: 0,
    dispatched: 0,
    rendered: 0,
    tokens: 0,
    lastTick: 0,
    buckets: {},
  };
}

function bump(buckets: Record<string, number>, key: string): void {
  buckets[key] = (buckets[key] ?? 0) + 1;
}

function bucketFor(r: FetchResult): string {
  if (r.blockedByRobots) return 'blocked';
  if (r.error || r.status === 0) return 'error';
  return `${Math.floor(r.status / 100)}xx`;
}

function viaFor(type: LinkRow['type']): DiscoveryVia {
  switch (type) {
    case 'canonical':
      return 'canonical';
    case 'hreflang':
      return 'hreflang';
    case 'next':
    case 'prev':
      return 'pagination';
    case 'iframe':
      return 'iframe';
    default:
      return 'link';
  }
}

const PAGE_COLUMNS_CACHE = new Map<string, string>();

function upsert(sql: SqlStorage, table: string, row: PageRow): void {
  const keys = Object.keys(row);
  const cacheKey = `${table}:${keys.join(',')}`;
  let statement = PAGE_COLUMNS_CACHE.get(cacheKey);
  if (!statement) {
    statement = `INSERT OR REPLACE INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
    PAGE_COLUMNS_CACHE.set(cacheKey, statement);
  }
  sql.exec(statement, ...keys.map((k) => row[k] ?? null));
}
