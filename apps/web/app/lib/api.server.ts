/**
 * Public REST API, `/api/v1/*`, authenticated with an org API key (`Authorization: Bearer rsn_…`).
 * Available on plans with `api` enabled.
 */

import { parseIssueChange, TABS_BY_ID } from '@raisin/core';
import { crawls, projects } from '@raisin/db';
import { desc, eq } from 'drizzle-orm';
import { authenticateApiKey } from './api-keys.server';
import {
  type ConfigOverrides,
  getCrawl,
  getProject,
  LimitError,
  startCrawl,
} from './crawls.server';
import { db, engine } from './env.server';
import { getPlan } from './plans.server';

const json = (data: unknown, status = 200) => Response.json(data, { status });
const error = (status: number, message: string) => json({ error: message }, status);

export async function handleApi(request: Request): Promise<Response> {
  const auth = await authenticateApiKey(request);
  if (!auth) return error(401, 'Missing or invalid API key');
  const plan = await getPlan(auth.orgId);
  if (!plan.api) return error(403, `The ${plan.name} plan does not include API access`);

  const { orgId } = auth;
  const path = new URL(request.url).pathname.replace(/^\/api\/v1/, '');
  const method = request.method;
  const params = new URL(request.url).searchParams;
  const projectCrawls = path.match(/^\/projects\/([\w-]+)\/crawls$/);
  const crawlPath = path.match(/^\/crawls\/([\w-]+)(\/.*)?$/);

  try {
    if (method === 'GET' && path === '/projects') {
      const rows = await db().select().from(projects).where(eq(projects.organizationId, orgId));
      return json({ projects: rows.map(publicProject) });
    }
    if (method === 'POST' && projectCrawls) {
      const project = await getProject(orgId, projectCrawls[1]!);
      if (!project) return error(404, 'Project not found');
      const body = (await request.json().catch(() => ({}))) as { config?: ConfigOverrides };
      const started = await startCrawl({
        orgId,
        userId: null,
        project,
        overrides: body.config,
        trigger: 'api',
      });
      return json(started, 201);
    }
    if (method === 'GET' && projectCrawls) {
      const rows = await db()
        .select()
        .from(crawls)
        .where(eq(crawls.projectId, projectCrawls[1]!))
        .orderBy(desc(crawls.createdAt))
        .limit(50);
      return json({ crawls: rows.filter((c) => c.organizationId === orgId).map(publicCrawl) });
    }
    if (crawlPath) {
      const crawl = await getCrawl(orgId, crawlPath[1]!);
      if (!crawl) return error(404, 'Crawl not found');
      const rest = crawlPath[2] ?? '';
      const urlDetail = rest.match(/^\/urls\/(\d+)$/);
      const control = rest.match(/^\/(pause|resume|stop)$/);
      if (method === 'GET' && rest === '') {
        return json({
          crawl: publicCrawl(crawl),
          progress: await engine().progress(orgId, crawl.id),
        });
      }
      if (method === 'GET' && rest === '/issues')
        return json(await engine().issues(orgId, crawl.id));
      if (method === 'GET' && rest === '/urls') {
        const tab = params.get('tab') ?? 'internal';
        if (!TABS_BY_ID.has(tab as never)) return error(400, `Unknown tab: ${tab}`);
        return json(
          await engine().grid(orgId, crawl.id, {
            tab,
            filter: params.get('filter'),
            change: parseIssueChange(params.get('change')),
            search: params.get('q'),
            sort: params.get('sort'),
            dir: params.get('dir') === 'desc' ? 'desc' : 'asc',
            offset: Number(params.get('offset') ?? 0),
            limit: Number(params.get('limit') ?? 100),
          }),
        );
      }
      if (method === 'GET' && urlDetail) {
        const detail = await engine().urlDetail(orgId, crawl.id, Number(urlDetail[1]));
        return detail ? json(detail) : error(404, 'URL not found');
      }
      if (method === 'POST' && control) {
        return json({
          status: await engine().control(
            orgId,
            crawl.id,
            control[1] as 'pause' | 'resume' | 'stop',
          ),
        });
      }
    }
    return error(404, 'Not found');
  } catch (e) {
    if (e instanceof LimitError) return error(429, e.message);
    if (e instanceof Error && e.message.startsWith('Unknown')) return error(400, e.message);
    console.error('api error', e);
    return error(500, 'Internal error');
  }
}

function publicProject(p: typeof projects.$inferSelect) {
  return {
    id: p.id,
    name: p.name,
    host: p.host,
    startUrl: p.startUrl,
    verified: p.verifiedAt !== null,
    createdAt: p.createdAt,
  };
}

function publicCrawl(c: typeof crawls.$inferSelect) {
  return {
    id: c.id,
    projectId: c.projectId,
    status: c.status,
    startUrl: c.startUrl,
    trigger: c.trigger,
    urlsCrawled: c.urlsCrawled,
    urlsDiscovered: c.urlsDiscovered,
    summary: c.summaryJson ? JSON.parse(c.summaryJson) : null,
    createdAt: c.createdAt,
    startedAt: c.startedAt,
    finishedAt: c.finishedAt,
    error: c.error,
  };
}
