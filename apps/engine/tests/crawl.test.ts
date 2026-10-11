import { env } from 'cloudflare:workers';
import { crawlDoName, defaultCrawlConfig, RULES } from '@raisin/core';
import { EXPECTED, EXPECTED_PAGE_TYPES, FIXTURE_ORIGIN, NOT_CRAWLED } from '@raisin/fixture-site';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const ORG = 'org_test';
const CRAWL = 'crawl_e2e';

async function seedTenant() {
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO user (id, name, email) VALUES ('u1', 'Test', 't@example.com')`),
    env.DB.prepare(`INSERT INTO organization (id, name, slug) VALUES (?, 'Test', 'test')`).bind(
      ORG,
    ),
    env.DB.prepare(
      `INSERT INTO projects (id, organization_id, name, host, start_url, verification_token) VALUES ('p1', ?, 'Fixture', 'fixture.raisin.test', ?, 'tok')`,
    ).bind(ORG, `${FIXTURE_ORIGIN}/`),
  ]);
}

describe('end-to-end crawl of the fixture site', () => {
  const doName = crawlDoName(ORG, CRAWL);
  const crawl = () => env.CRAWL.getByName(doName);
  let issuesByPath: Map<string, Set<string>>;

  beforeAll(async () => {
    await seedTenant();
    const config = {
      ...defaultCrawlConfig(`${FIXTURE_ORIGIN}/`),
      maxUrlsPerSecond: 100,
      maxInFlight: 100,
    };
    await env.DB.prepare(
      `INSERT INTO crawls (id, organization_id, project_id, start_url, config_json, do_name) VALUES (?, ?, 'p1', ?, ?, ?)`,
    )
      .bind(CRAWL, ORG, config.startUrl, JSON.stringify(config), doName)
      .run();
    await crawl().init({ crawlId: CRAWL, orgId: ORG, doName, config });
    await env.LIFECYCLE.create({
      id: CRAWL,
      params: { crawlId: CRAWL, orgId: ORG, doName, ai: false },
    });

    await vi.waitFor(
      async () => {
        const row = await env.DB.prepare('SELECT status, error FROM crawls WHERE id = ?')
          .bind(CRAWL)
          .first<{ status: string; error: string | null }>();
        if (row?.status === 'failed') throw new Error(`crawl failed: ${row.error}`);
        expect(row?.status).toBe('completed');
      },
      { timeout: 55_000, interval: 500 },
    );

    // Collect issues through the same tab filters the dashboard uses.
    issuesByPath = new Map();
    const all = await crawl().grid({ tab: 'internal', limit: 1000 });
    for (const row of all.rows) issuesByPath.set(new URL(String(row.url)).pathname, new Set());
    for (const rule of RULES) {
      const tab = rule.tab;
      try {
        const res = await crawl().grid({ tab, filter: rule.id, limit: 1000 });
        for (const row of res.rows) {
          const path = new URL(String(row.url)).pathname;
          const set = issuesByPath.get(path) ?? new Set<string>();
          set.add(rule.id);
          issuesByPath.set(path, set);
        }
      } catch {
        // Every rule has a tab filter (core's tests check this), so this is unreachable.
      }
    }
  }, 60_000);

  it('records the D1 summary and an export', async () => {
    const row = await env.DB.prepare(
      'SELECT urls_crawled, summary_json, export_key FROM crawls WHERE id = ?',
    )
      .bind(CRAWL)
      .first<{ urls_crawled: number; summary_json: string; export_key: string }>();
    expect(row!.urls_crawled).toBeGreaterThan(20);
    expect(JSON.parse(row!.summary_json).issue).toBeGreaterThan(0);
    const csv = await env.BUCKET.get(row!.export_key);
    const text = await csv!.text();
    expect(text.split('\r\n')[0]).toContain('Address');
    expect(text).toContain(`${FIXTURE_ORIGIN}/about`);
  });

  it.each(Object.entries(EXPECTED))('flags %s', (path, rules) => {
    const found = issuesByPath.get(path) ?? new Set();
    for (const rule of rules) expect([...found], `${path} should have ${rule}`).toContain(rule);
  });

  it('never fetches nofollowed or robots-blocked content', async () => {
    for (const path of NOT_CRAWLED) expect(issuesByPath.has(path)).toBe(false);
    const blocked = await crawl().grid({
      tab: 'response-codes',
      filter: 'response.blocked_robots',
    });
    expect(blocked.rows.map((r) => r.url)).toEqual([`${FIXTURE_ORIGIN}/private/page`]);
  });

  it('computes link counts and Link Score', async () => {
    const links = await crawl().grid({ tab: 'links', sort: 'link_score', dir: 'desc', limit: 5 });
    expect(Number(links.rows[0]!.link_score)).toBe(100);
    expect(Number(links.rows[0]!.unique_inlinks)).toBeGreaterThan(5);
  });

  it('serves URL detail with inlinks, redirect chains and duplicates', async () => {
    const all = await crawl().grid({ tab: 'internal', search: '/redirect-1', limit: 5 });
    const detail = await crawl().urlDetail(Number(all.rows[0]!.id));
    expect(detail!.redirectChain.map((h) => new URL(h.url).pathname)).toEqual([
      '/redirect-1',
      '/redirect-2',
      '/final',
    ]);
    expect(detail!.inlinks.length).toBeGreaterThan(0);

    const widget = await crawl().grid({ tab: 'internal', search: '/products/widget-b', limit: 5 });
    const widgetDetail = await crawl().urlDetail(Number(widget.rows[0]!.id));
    expect(widgetDetail!.duplicates.some((d) => d.kind === 'simhash')).toBe(true);
  });

  it('groups pages into page types', async () => {
    const types = await crawl().pageTypes();
    for (const expected of EXPECTED_PAGE_TYPES) {
      const type = types.find((t) => t.patterns.includes(expected.patterns[0]!));
      expect(type, `a type for ${expected.patterns[0]}`).toBeDefined();
      expect([...type!.patterns].sort()).toEqual([...expected.patterns].sort());
      expect(type!.sdType).toBe(expected.sdType);
      expect(type!.pageCount).toBe(expected.pages);
    }
    const ids = EXPECTED_PAGE_TYPES.map(
      (e) => types.find((t) => t.patterns.includes(e.patterns[0]!))!.id,
    );
    expect(new Set(ids).size).toBe(ids.length);

    const widgets = types.find((t) => t.patterns.includes('/products/{slug}'));
    expect(widgets!.pageCount).toBeGreaterThanOrEqual(3);

    const products = types.find((t) => t.patterns.includes('/shop/{slug}'))!;
    expect(products.sample.url).toMatch(/\/(shop|gifts)\//);

    // The grid narrows to a type and labels every page with its type.
    const grid = await crawl().grid({ tab: 'internal', pageType: products.id, limit: 50 });
    expect(grid.rows.map((r) => new URL(String(r.url)).pathname).sort()).toEqual([
      '/gifts/brass-bottle-opener',
      '/shop/linen-apron',
      '/shop/oak-chopping-board',
    ]);
    expect(new Set(grid.rows.map((r) => r.page_type))).toEqual(new Set([products.label]));
  });

  it('reports progress as completed', async () => {
    const p = await crawl().progress();
    expect(p.status).toBe('completed');
    expect(p.inFlight).toBe(0);
  });
});

describe('comparison with the previous crawl', () => {
  const SECOND = 'crawl_e2e_2';
  const doName = crawlDoName(ORG, SECOND);
  const crawl = () => env.CRAWL.getByName(doName);

  beforeAll(async () => {
    const config = {
      ...defaultCrawlConfig(`${FIXTURE_ORIGIN}/`),
      maxUrlsPerSecond: 100,
      maxInFlight: 100,
    };
    await env.DB.prepare(
      `INSERT INTO crawls (id, organization_id, project_id, start_url, config_json, do_name) VALUES (?, ?, 'p1', ?, ?, ?)`,
    )
      .bind(SECOND, ORG, config.startUrl, JSON.stringify(config), doName)
      .run();
    await crawl().init({ crawlId: SECOND, orgId: ORG, doName, config });
    await env.LIFECYCLE.create({
      id: SECOND,
      params: { crawlId: SECOND, orgId: ORG, doName, ai: false },
    });
    await vi.waitFor(
      async () => {
        const row = await env.DB.prepare('SELECT status, error FROM crawls WHERE id = ?')
          .bind(SECOND)
          .first<{ status: string; error: string | null }>();
        if (row?.status === 'failed') throw new Error(`crawl failed: ${row.error}`);
        expect(row?.status).toBe('completed');
      },
      { timeout: 55_000, interval: 500 },
    );
  }, 60_000);

  it('uses the first crawl as its baseline', async () => {
    const summary = await crawl().issueSummary();
    expect(summary.baseline?.crawlId).toBe(CRAWL);
  });

  it('finds nothing new or fixed when the site has not changed', async () => {
    const summary = await crawl().issueSummary();
    const flagged = summary.rules.filter((r) => r.count > 0);
    expect(flagged.length).toBeGreaterThan(0);
    for (const r of summary.rules) {
      expect(r.new, `${r.id} new`).toBe(0);
      expect(r.fixed, `${r.id} fixed`).toBe(0);
    }
    const rule = flagged[0]!;
    const all = await crawl().grid({ tab: rule.tab, filter: rule.id });
    const added = await crawl().grid({ tab: rule.tab, filter: rule.id, change: 'new' });
    const fixed = await crawl().grid({ tab: rule.tab, filter: rule.id, change: 'fixed' });
    expect(all.total).toBe(rule.count);
    expect(added.total).toBe(0);
    expect(fixed.total).toBe(0);
  });

  it('reports new and fixed issues against the baseline', async () => {
    // Rewrite the baseline to simulate a changed site: one URL the rule flags now wasn't flagged
    // before (new), and one URL it no longer flags was flagged before (fixed).
    const summary = await crawl().issueSummary();
    const rule = summary.rules.find((r) => r.count > 0)!;
    const flagged = await crawl().grid({ tab: rule.tab, filter: rule.id, limit: 1000 });
    const flaggedIds = new Set(flagged.rows.map((r) => Number(r.id)));
    const added = Number(flagged.rows[0]!.id);
    const internal = await crawl().grid({ tab: 'internal', limit: 1000 });
    const fixed = internal.rows.map((r) => Number(r.id)).find((id) => !flaggedIds.has(id))!;
    const keys = await crawl().issueKeys(null, 50_000);
    await crawl().baselineBegin();
    await crawl().baselineAdd([
      ...keys.filter((k) => !(k.rule_id === rule.id && k.url_id === added)),
      { rule_id: rule.id, url_id: fixed },
    ]);
    await crawl().baselineFinish({ crawlId: CRAWL, createdAt: 0 });

    const after = (await crawl().issueSummary()).rules.find((r) => r.id === rule.id)!;
    expect(after.new).toBe(1);
    expect(after.fixed).toBe(1);
    const newRows = await crawl().grid({ tab: rule.tab, filter: rule.id, change: 'new' });
    const fixedRows = await crawl().grid({ tab: rule.tab, filter: rule.id, change: 'fixed' });
    expect(newRows.rows.map((r) => Number(r.id))).toEqual([added]);
    expect(fixedRows.rows.map((r) => Number(r.id))).toEqual([fixed]);
  });
});
