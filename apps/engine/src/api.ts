/**
 * The RPC surface the web app reaches through its service binding. The web app has already
 * authenticated the user and checked that the crawl belongs to their organization; this layer
 * trusts its caller and never accepts a DO name it didn't derive itself.
 */

import { WorkerEntrypoint } from 'cloudflare:workers';
import {
  crawlDoName,
  type EngineRpc,
  type GridQuery,
  type GridResult,
  type IssueSummary,
  type Overview,
  type PageTypeNames,
  type PageTypeSummary,
  type ProgressResult,
  type StartCrawlInput,
  type SuggestionKind,
  type UrlDetail,
} from '@raisin/core';
import { addUsage, crawls, createDb, UNCOUNTED_CRAWL_STATUSES } from '@raisin/db';
import { and, eq } from 'drizzle-orm';
import type { LifecycleParams } from './lifecycle';
import { suggest } from './suggest';

export class EngineApi extends WorkerEntrypoint<Env> implements EngineRpc {
  private crawl(orgId: string, crawlId: string) {
    return this.env.CRAWL.getByName(crawlDoName(orgId, crawlId));
  }

  async startCrawl(input: StartCrawlInput): Promise<{ doName: string }> {
    const doName = crawlDoName(input.orgId, input.crawlId);
    await this.env.CRAWL.getByName(doName).init({
      crawlId: input.crawlId,
      orgId: input.orgId,
      doName,
      config: input.config,
    });
    const params: LifecycleParams = {
      crawlId: input.crawlId,
      orgId: input.orgId,
      doName,
      ai: input.ai,
    };
    await this.env.LIFECYCLE.create({ id: input.crawlId, params });
    return { doName };
  }

  async control(orgId: string, crawlId: string, action: 'pause' | 'resume' | 'stop') {
    const stub = this.crawl(orgId, crawlId);
    if (action === 'pause') return stub.pause();
    if (action === 'resume') return stub.resume();
    return stub.stop();
  }

  async progress(orgId: string, crawlId: string): Promise<ProgressResult> {
    return this.crawl(orgId, crawlId).progress();
  }

  async grid(orgId: string, crawlId: string, q: GridQuery): Promise<GridResult> {
    return this.crawl(orgId, crawlId).grid(q);
  }

  async issues(orgId: string, crawlId: string): Promise<IssueSummary> {
    return this.crawl(orgId, crawlId).issueSummary();
  }

  async overview(orgId: string, crawlId: string): Promise<Overview> {
    return this.crawl(orgId, crawlId).overview();
  }

  async pageTypes(orgId: string, crawlId: string): Promise<PageTypeSummary[]> {
    return this.crawl(orgId, crawlId).pageTypes();
  }

  async regroupPageTypes(orgId: string, crawlId: string, names: PageTypeNames): Promise<number> {
    return this.crawl(orgId, crawlId).assignPageTypes(names);
  }

  async urlDetail(orgId: string, crawlId: string, urlId: number): Promise<UrlDetail | null> {
    return this.crawl(orgId, crawlId).urlDetail(urlId);
  }

  async suggest(
    orgId: string,
    crawlId: string,
    urlId: number,
    kind: SuggestionKind,
    imageUrl?: string,
  ) {
    return suggest(this.env, this.crawl(orgId, crawlId), urlId, kind, imageUrl);
  }

  /** `GET /ws/{orgId}/{crawlId}` with an upgrade header opens the live-progress WebSocket. */
  override async fetch(request: Request): Promise<Response> {
    const match = new URL(request.url).pathname.match(/^\/ws\/([\w-]+)\/([\w-]+)$/);
    if (!match) return new Response('Not found', { status: 404 });
    return this.crawl(match[1]!, match[2]!).fetch(request);
  }

  /** Stored HTML or a screenshot, for the URL detail pane. */
  async object(orgId: string, crawlId: string, key: string): Promise<Response> {
    if (!key.startsWith(`crawls/${crawlId}/`) && !key.startsWith(`exports/${orgId}/${crawlId}/`)) {
      return new Response('Not found', { status: 404 });
    }
    const obj = await this.env.BUCKET.get(key);
    if (!obj) return new Response('Not found', { status: 404 });
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    return new Response(obj.body, { headers });
  }

  /** Delete a crawl's stored objects and its Durable Object storage. */
  async purge(orgId: string, crawlId: string): Promise<void> {
    // A crawl deleted before it finished never reaches finalize, which is where usage is
    // recorded. Count what it consumed now, or deleting mid-crawl would reset the monthly caps.
    const db = createDb(this.env.DB);
    const row = await db
      .select({ status: crawls.status })
      .from(crawls)
      .where(and(eq(crawls.id, crawlId), eq(crawls.organizationId, orgId)))
      .limit(1);
    const status = row[0]?.status;
    if (status && (UNCOUNTED_CRAWL_STATUSES as readonly string[]).includes(status)) {
      const p = await this.crawl(orgId, crawlId).progress();
      await addUsage(db, orgId, { crawledUrls: p.crawled, renderedPages: p.rendered });
      // Mark it so a second purge (or the watchdog) doesn't count it again.
      await db.update(crawls).set({ status: 'cancelled' }).where(eq(crawls.id, crawlId));
    }
    for (const prefix of [`crawls/${crawlId}/`, `exports/${orgId}/${crawlId}/`]) {
      let cursor: string | undefined;
      do {
        const list = await this.env.BUCKET.list({ prefix, cursor });
        if (list.objects.length) await this.env.BUCKET.delete(list.objects.map((o) => o.key));
        cursor = list.truncated ? list.cursor : undefined;
      } while (cursor);
    }
    await this.crawl(orgId, crawlId).destroy();
    // Stop its Workflow too, or it waits up to 30 days for a crawl that no longer exists.
    try {
      const instance = await this.env.LIFECYCLE.get(crawlId);
      const { status } = await instance.status();
      if (
        status === 'running' ||
        status === 'waiting' ||
        status === 'queued' ||
        status === 'paused'
      ) {
        await instance.terminate();
      }
    } catch {
      // No instance (already gone): nothing to stop.
    }
  }

  async lifecycle(crawlId: string): Promise<{ status: string; error: string | null }> {
    try {
      const instance = await this.env.LIFECYCLE.get(crawlId);
      const status = await instance.status();
      return { status: status.status, error: status.error?.message ?? null };
    } catch {
      return { status: 'unknown', error: null };
    }
  }
}
