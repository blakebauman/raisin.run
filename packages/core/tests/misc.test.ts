import { describe, expect, it } from 'vitest';
import { RULES } from '../src/audits/rules';
import { featureSimhash, hammingDistance, simhash, simhashBands } from '../src/hash';
import { canonicalFromLinkHeader, indexability, isValidHreflang } from '../src/indexability';
import { descriptionWidth, titleWidth, truncateToWidth } from '../src/serp';
import { parseSitemap, parseTextSitemap } from '../src/sitemap';
import { buildGridSql, TABS } from '../src/tabs';

describe('sitemaps', () => {
  it('parses urlsets with CDATA, entities and namespaces', () => {
    const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://e.com/a?x=1&amp;y=2</loc><lastmod>2026-01-01</lastmod></url>
      <url><loc><![CDATA[https://e.com/b]]></loc></url></urlset>`;
    expect(parseSitemap(xml)).toEqual({
      kind: 'urlset',
      urls: [
        { loc: 'https://e.com/a?x=1&y=2', lastmod: '2026-01-01' },
        { loc: 'https://e.com/b', lastmod: null },
      ],
    });
  });
  it('parses sitemap indexes', () => {
    const xml = `<sitemapindex><sitemap><loc>https://e.com/s1.xml</loc></sitemap><sitemap><loc>https://e.com/s2.xml.gz</loc></sitemap></sitemapindex>`;
    expect(parseSitemap(xml)).toEqual({
      kind: 'index',
      sitemaps: ['https://e.com/s1.xml', 'https://e.com/s2.xml.gz'],
    });
  });
  it('parses text sitemaps', () => {
    expect(parseTextSitemap('https://e.com/a\nnot a url\n https://e.com/b ')).toEqual([
      'https://e.com/a',
      'https://e.com/b',
    ]);
  });
});

describe('serp widths', () => {
  it('measures Arial widths', () => {
    expect(titleWidth('iiii')).toBe(18);
    expect(titleWidth('WWWW')).toBe(76);
    expect(descriptionWidth('a')).toBe(8);
  });
  it('truncates with an ellipsis within the budget', () => {
    const long = 'The quick brown fox jumps over the lazy dog '.repeat(4);
    const cut = truncateToWidth(long, 561, 20);
    expect(cut.endsWith('...')).toBe(true);
    expect(titleWidth(cut)).toBeLessThanOrEqual(561);
  });
});

describe('simhash', () => {
  const base =
    'the quick brown fox jumps over the lazy dog and keeps running through the forest until night falls on the quiet village';
  it('is close for near-identical text and far for different text', () => {
    const near = simhash(`${base} today`);
    const far = simhash(
      'completely unrelated content about databases indexes queries and storage engines for analytics',
    );
    expect(hammingDistance(simhash(base), near)).toBeLessThanOrEqual(10);
    expect(hammingDistance(simhash(base), far)).toBeGreaterThan(15);
  });
  it('hashes no features to all zeros', () => {
    expect(simhash('')).toBe('0'.repeat(16));
    expect(featureSimhash([])).toBe('0'.repeat(16));
  });
  it('splits into four 16-bit bands', () => {
    expect(simhashBands('0001000200030004')).toEqual([1, 2, 3, 4]);
  });
});

describe('indexability', () => {
  const base = {
    url: 'https://e.com/a',
    status: 200,
    error: null,
    blockedByRobots: false,
    isHtml: true,
    directives: new Set<string>(),
    canonical: null,
  };
  it('applies reasons in priority order', () => {
    expect(indexability(base)).toEqual({ indexable: true, reason: null });
    expect(indexability({ ...base, status: 404, directives: new Set(['noindex']) }).reason).toBe(
      'Client Error',
    );
    expect(indexability({ ...base, directives: new Set(['noindex']) }).reason).toBe('noindex');
    expect(indexability({ ...base, canonical: 'https://e.com/b' }).reason).toBe('Canonicalised');
    expect(indexability({ ...base, canonical: 'https://e.com/a' }).indexable).toBe(true);
    expect(indexability({ ...base, status: 301 }).reason).toBe('Redirected');
    expect(indexability({ ...base, blockedByRobots: true }).reason).toBe('Blocked by robots.txt');
  });
  it('reads canonicals from Link headers', () => {
    expect(
      canonicalFromLinkHeader(
        '<https://e.com/x>; rel="preload", <https://e.com/c>; rel="canonical"',
      ),
    ).toBe('https://e.com/c');
    expect(canonicalFromLinkHeader('<https://e.com/x>; rel=preload')).toBeNull();
  });
  it('validates hreflang codes', () => {
    for (const ok of ['en', 'en-gb', 'zh-Hant-TW', 'x-default', 'es-419'])
      expect(isValidHreflang(ok)).toBe(true);
    for (const bad of ['english', 'en_gb', 'e', 'en-gbr-x'])
      expect(isValidHreflang(bad)).toBe(false);
  });
});

describe('rules and tabs', () => {
  it('have unique rule ids and every tab filter resolves', () => {
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
    for (const tab of TABS) {
      for (const f of tab.filters)
        expect(() => buildGridSql({ tab: tab.id, filter: f.id })).not.toThrow();
    }
  });
  it('whitelists sort keys and escapes search', () => {
    const q = buildGridSql({ tab: 'titles', sort: 'title; DROP TABLE pages', search: '100%_off' });
    expect(q.sql).not.toContain('DROP');
    expect(q.params).toEqual(['%100\\%\\_off%', '%100\\%\\_off%']);
    expect(() => buildGridSql({ tab: 'nope' })).toThrow();
    expect(() => buildGridSql({ tab: 'titles', filter: 'nope' })).toThrow();
  });
  it('shows exactly the flagged URLs for a rule filter, not just those in the tab base', () => {
    // Image rules flag the pages that embed the images, which the Images tab base excludes.
    const q = buildGridSql({ tab: 'images', filter: 'images.missing_alt_text' });
    expect(q.countSql).not.toContain('is_image');
    expect(q.countSql).toContain('FROM issues WHERE rule_id = ?');
    expect(q.params).toEqual(['images.missing_alt_text']);
    expect(
      buildGridSql({ tab: 'images', filter: 'images.missing_alt_text', search: 'x' }).params,
    ).toHaveLength(3);
    expect(buildGridSql({ tab: 'images' }).countSql).toContain('is_image');
  });
  it('binds the page-type filter and sorts by the computed page-type column', () => {
    const q = buildGridSql({
      tab: 'internal',
      filter: 'html',
      pageType: 3,
      sort: 'page_type',
      dir: 'desc',
    });
    expect(q.countSql).toContain('page_type_id = ?');
    expect(q.params).toEqual([3]);
    expect(q.sql).toContain(
      'JOIN page_types t ON t.id = s.page_type_id WHERE s.id = p.id) AS page_type',
    );
    expect(q.sql).toMatch(/ORDER BY \(SELECT t\.label .*\) DESC NULLS LAST/);
    expect(q.columns.some((c) => c.key === 'page_type')).toBe(true);
  });
});
