/**
 * Grid tabs. Each tab is a base predicate over `pages p`, a column set, and filters. Filters are
 * either audit rules (joined through `issues`) or extra predicates. The Crawl DO builds its grid
 * SQL only from these definitions, so sort keys and filters from the client are checked against
 * the whitelist below and never interpolated.
 */

import { RULES, type TabId } from './audits/rules';

export type ColumnType =
  | 'url'
  | 'text'
  | 'int'
  | 'float'
  | 'bytes'
  | 'ms'
  | 'status'
  | 'bool'
  | 'px';

export type Column = { key: string; label: string; type: ColumnType; width?: number };

/**
 * Columns that don't live on `pages`: the SQL expression that computes each one, correlated on
 * `p.id`. Defined here, never sent to or taken from the client.
 */
const COMPUTED = new Map([
  [
    'page_type',
    '(SELECT t.label FROM page_shapes s JOIN page_types t ON t.id = s.page_type_id WHERE s.id = p.id)',
  ],
]);

const columnSql = (key: string) => COMPUTED.get(key) ?? `p.${key}`;

export type TabFilter = { id: string; label: string; ruleId?: string; where?: string };

export type Tab = {
  id: 'internal' | 'external' | TabId;
  label: string;
  base: string;
  columns: Column[];
  filters: TabFilter[];
};

const C = {
  url: { key: 'url', label: 'Address', type: 'url', width: 420 },
  status: { key: 'status', label: 'Status', type: 'status', width: 80 },
  statusText: { key: 'status_text', label: 'Status text', type: 'text', width: 120 },
  contentType: { key: 'content_type', label: 'Content type', type: 'text', width: 180 },
  pageType: { key: 'page_type', label: 'Page type', type: 'text', width: 220 },
  indexability: {
    key: 'indexability_reason',
    label: 'Indexability status',
    type: 'text',
    width: 150,
  },
  indexable: { key: 'indexable', label: 'Indexable', type: 'bool', width: 90 },
  title: { key: 'title', label: 'Title 1', type: 'text', width: 320 },
  titleLen: { key: 'title_len', label: 'Title length', type: 'int', width: 100 },
  titlePx: { key: 'title_px', label: 'Title pixel width', type: 'px', width: 120 },
  desc: { key: 'meta_desc', label: 'Meta description 1', type: 'text', width: 360 },
  descLen: { key: 'meta_desc_len', label: 'Description length', type: 'int', width: 120 },
  descPx: { key: 'meta_desc_px', label: 'Description pixel width', type: 'px', width: 140 },
  h1: { key: 'h1', label: 'H1-1', type: 'text', width: 280 },
  h1Len: { key: 'h1_len', label: 'H1-1 length', type: 'int', width: 100 },
  h1b: { key: 'h1_2', label: 'H1-2', type: 'text', width: 240 },
  h2: { key: 'h2', label: 'H2-1', type: 'text', width: 280 },
  h2b: { key: 'h2_2', label: 'H2-2', type: 'text', width: 240 },
  canonical: { key: 'canonical', label: 'Canonical link element', type: 'url', width: 360 },
  canonicalHeader: { key: 'canonical_header', label: 'HTTP canonical', type: 'url', width: 300 },
  metaRobots: { key: 'meta_robots', label: 'Meta robots', type: 'text', width: 160 },
  xRobots: { key: 'x_robots', label: 'X-Robots-Tag', type: 'text', width: 160 },
  metaRefresh: { key: 'meta_refresh', label: 'Meta refresh', type: 'text', width: 200 },
  size: { key: 'size', label: 'Size', type: 'bytes', width: 100 },
  wordCount: { key: 'word_count', label: 'Word count', type: 'int', width: 100 },
  textRatio: { key: 'text_ratio', label: 'Text ratio %', type: 'float', width: 100 },
  depth: { key: 'depth', label: 'Crawl depth', type: 'int', width: 100 },
  inlinks: { key: 'inlinks', label: 'Inlinks', type: 'int', width: 90 },
  uniqueInlinks: { key: 'unique_inlinks', label: 'Unique inlinks', type: 'int', width: 110 },
  outlinks: { key: 'unique_outlinks', label: 'Unique outlinks', type: 'int', width: 120 },
  externalOutlinks: {
    key: 'external_outlinks',
    label: 'External outlinks',
    type: 'int',
    width: 130,
  },
  linkScore: { key: 'link_score', label: 'Link score', type: 'float', width: 100 },
  responseMs: { key: 'response_ms', label: 'Response time', type: 'ms', width: 110 },
  redirect: { key: 'redirect_target', label: 'Redirect URL', type: 'url', width: 360 },
  lang: { key: 'lang', label: 'Language', type: 'text', width: 90 },
  hreflangCount: { key: 'hreflang_count', label: 'Hreflang annotations', type: 'int', width: 140 },
  sdTypes: { key: 'structured_types', label: 'Structured data types', type: 'text', width: 240 },
  sdErrors: { key: 'sd_errors', label: 'Validation errors', type: 'int', width: 120 },
  images: { key: 'images_count', label: 'Images', type: 'int', width: 80 },
  imagesMissingAlt: {
    key: 'images_missing_alt',
    label: 'Images missing alt',
    type: 'int',
    width: 140,
  },
  nearDups: { key: 'near_dup_count', label: 'Near duplicates', type: 'int', width: 120 },
  nearDupMax: { key: 'near_dup_max', label: 'Closest similarity %', type: 'int', width: 150 },
  semanticDups: { key: 'semantic_dup_count', label: 'Semantic matches', type: 'int', width: 130 },
  jsWords: { key: 'js_word_count', label: 'Rendered word count', type: 'int', width: 150 },
  jsTitle: { key: 'js_title', label: 'Rendered title', type: 'text', width: 280 },
  jsLinks: { key: 'js_links_added', label: 'JS-only links', type: 'int', width: 110 },
  consoleErrors: { key: 'console_errors', label: 'Console errors', type: 'int', width: 120 },
  lcp: { key: 'lcp_ms', label: 'LCP (lab)', type: 'ms', width: 100 },
  cls: { key: 'cls', label: 'CLS (lab)', type: 'float', width: 90 },
  relNext: { key: 'rel_next', label: 'rel="next"', type: 'url', width: 300 },
  relPrev: { key: 'rel_prev', label: 'rel="prev"', type: 'url', width: 300 },
  inSitemap: { key: 'in_sitemap', label: 'In sitemap', type: 'bool', width: 100 },
  lastModified: { key: 'last_modified', label: 'Last modified', type: 'text', width: 200 },
} satisfies Record<string, Column>;

const HTML = 'p.internal = 1 AND p.is_html = 1';
const HTML_OK = `${HTML} AND p.status = 200`;

function ruleFilters(tab: TabId): TabFilter[] {
  return RULES.filter((r) => r.tab === tab).map((r) => ({
    id: r.id,
    label: r.label,
    ruleId: r.id,
  }));
}

const contentTypeFilters: TabFilter[] = [
  { id: 'html', label: 'HTML', where: 'p.is_html = 1' },
  { id: 'images', label: 'Images', where: 'p.is_image = 1' },
  { id: 'css', label: 'CSS', where: `p.content_type LIKE 'text/css%'` },
  { id: 'js', label: 'JavaScript', where: `p.content_type LIKE '%javascript%'` },
  { id: 'pdf', label: 'PDF', where: `p.content_type LIKE 'application/pdf%'` },
  { id: 'other', label: 'Other', where: `p.is_html = 0 AND p.is_image = 0` },
];

export const TABS: Tab[] = [
  {
    id: 'internal',
    label: 'Internal',
    base: 'p.internal = 1',
    columns: [
      C.url,
      C.pageType,
      C.contentType,
      C.status,
      C.statusText,
      C.indexability,
      C.title,
      C.titleLen,
      C.desc,
      C.h1,
      C.size,
      C.wordCount,
      C.depth,
      C.inlinks,
      C.uniqueInlinks,
      C.outlinks,
      C.linkScore,
      C.responseMs,
      C.canonical,
      C.redirect,
      C.lastModified,
    ],
    filters: contentTypeFilters,
  },
  {
    id: 'external',
    label: 'External',
    base: 'p.internal = 0',
    columns: [C.url, C.contentType, C.status, C.statusText, C.inlinks, C.responseMs, C.redirect],
    filters: contentTypeFilters,
  },
  {
    id: 'response-codes',
    label: 'Response Codes',
    base: '1 = 1',
    columns: [
      C.url,
      C.contentType,
      C.status,
      C.statusText,
      C.indexability,
      C.inlinks,
      C.responseMs,
      C.redirect,
    ],
    filters: [
      { id: 'success', label: 'Success (2xx)', where: 'p.status BETWEEN 200 AND 299' },
      { id: 'redirection', label: 'Redirection (3xx)', where: 'p.status BETWEEN 300 AND 399' },
      { id: 'client-error', label: 'Client Error (4xx)', where: 'p.status BETWEEN 400 AND 499' },
      { id: 'server-error', label: 'Server Error (5xx)', where: 'p.status >= 500' },
      ...ruleFilters('response-codes'),
    ],
  },
  {
    id: 'security',
    label: 'Security',
    base: HTML,
    columns: [C.url, C.status, C.indexability],
    filters: ruleFilters('security'),
  },
  {
    id: 'url',
    label: 'URL',
    base: HTML,
    columns: [C.url, C.status, C.indexability, C.depth],
    filters: ruleFilters('url'),
  },
  {
    id: 'titles',
    label: 'Page Titles',
    base: HTML_OK,
    columns: [C.url, C.indexability, C.title, C.titleLen, C.titlePx, C.h1],
    filters: ruleFilters('titles'),
  },
  {
    id: 'meta-description',
    label: 'Meta Description',
    base: HTML_OK,
    columns: [C.url, C.indexability, C.desc, C.descLen, C.descPx],
    filters: ruleFilters('meta-description'),
  },
  {
    id: 'h1',
    label: 'H1',
    base: HTML_OK,
    columns: [C.url, C.indexability, C.h1, C.h1Len, C.h1b],
    filters: ruleFilters('h1'),
  },
  {
    id: 'h2',
    label: 'H2',
    base: HTML_OK,
    columns: [C.url, C.indexability, C.h2, C.h2b],
    filters: ruleFilters('h2'),
  },
  {
    id: 'content',
    label: 'Content',
    base: HTML_OK,
    columns: [
      C.url,
      C.indexability,
      C.wordCount,
      C.textRatio,
      C.nearDups,
      C.nearDupMax,
      C.semanticDups,
      C.lang,
    ],
    filters: ruleFilters('content'),
  },
  {
    id: 'images',
    label: 'Images',
    base: 'p.is_image = 1',
    columns: [C.url, C.status, C.contentType, C.size, C.inlinks],
    filters: ruleFilters('images'),
  },
  {
    id: 'canonicals',
    label: 'Canonicals',
    base: HTML_OK,
    columns: [C.url, C.indexability, C.canonical, C.canonicalHeader],
    filters: [
      { id: 'self', label: 'Self referencing', where: 'p.canonical_id = p.id' },
      ...ruleFilters('canonicals'),
    ],
  },
  {
    id: 'directives',
    label: 'Directives',
    base: HTML_OK,
    columns: [C.url, C.indexability, C.metaRobots, C.xRobots, C.metaRefresh],
    filters: ruleFilters('directives'),
  },
  {
    id: 'hreflang',
    label: 'Hreflang',
    base: `${HTML_OK} AND p.hreflang_count > 0`,
    columns: [C.url, C.indexability, C.lang, C.hreflangCount],
    filters: ruleFilters('hreflang'),
  },
  {
    id: 'javascript',
    label: 'JavaScript',
    base: `${HTML_OK} AND p.rendered = 1`,
    columns: [
      C.url,
      C.title,
      C.jsTitle,
      C.wordCount,
      C.jsWords,
      C.jsLinks,
      C.consoleErrors,
      C.lcp,
      C.cls,
    ],
    filters: ruleFilters('javascript'),
  },
  {
    id: 'links',
    label: 'Links',
    base: HTML_OK,
    columns: [
      C.url,
      C.depth,
      C.inlinks,
      C.uniqueInlinks,
      C.outlinks,
      C.externalOutlinks,
      C.linkScore,
    ],
    filters: ruleFilters('links'),
  },
  {
    id: 'structured-data',
    label: 'Structured Data',
    base: HTML_OK,
    columns: [C.url, C.indexability, C.sdTypes, C.sdErrors],
    filters: [
      {
        id: 'contains',
        label: 'Contains structured data',
        where: 'p.structured_types IS NOT NULL',
      },
      ...ruleFilters('structured-data'),
    ],
  },
  {
    id: 'sitemaps',
    label: 'Sitemaps',
    base: 'p.internal = 1',
    columns: [C.url, C.status, C.indexability, C.inSitemap, C.uniqueInlinks],
    filters: [
      { id: 'in-sitemap', label: 'URLs in sitemap', where: 'p.in_sitemap = 1' },
      ...ruleFilters('sitemaps'),
    ],
  },
  {
    id: 'pagination',
    label: 'Pagination',
    base: `${HTML_OK} AND (p.rel_next IS NOT NULL OR p.rel_prev IS NOT NULL)`,
    columns: [C.url, C.indexability, C.relNext, C.relPrev],
    filters: ruleFilters('pagination'),
  },
  {
    id: 'performance',
    label: 'Performance',
    base: HTML_OK,
    columns: [C.url, C.responseMs, C.size, C.lcp, C.cls],
    filters: ruleFilters('performance'),
  },
];

export const TABS_BY_ID = new Map(TABS.map((t) => [t.id, t]));

/** Every column key any tab can show; the only identifiers grid SQL may sort or select by. */
export const SORTABLE_COLUMNS = new Set(TABS.flatMap((t) => t.columns.map((c) => c.key)));

/** With a rule filter: only the URLs that are new to the rule, or fixed, since the baseline. */
export type IssueChange = 'new' | 'fixed';

/** Reads a `change` query parameter; anything else means no change filter. */
export function parseIssueChange(value: string | null | undefined): IssueChange | null {
  return value === 'new' || value === 'fixed' ? value : null;
}

export type GridQuery = {
  tab: string;
  filter?: string | null;
  change?: IssueChange | null;
  search?: string | null;
  /** Only pages of this page type (`page_types.id`). */
  pageType?: number | null;
  sort?: string | null;
  dir?: 'asc' | 'desc';
  offset?: number;
  limit?: number;
};

export type GridSql = {
  sql: string;
  countSql: string;
  params: (string | number)[];
  columns: Column[];
};

/** Build the grid query for a tab. Throws on unknown tabs or filters. */
export function buildGridSql(q: GridQuery): GridSql {
  const tab = TABS_BY_ID.get(q.tab as Tab['id']);
  if (!tab) throw new Error(`Unknown tab: ${q.tab}`);
  const where: string[] = [];
  const params: (string | number)[] = [];
  const f = q.filter ? tab.filters.find((x) => x.id === q.filter) : null;
  if (q.filter && !f) throw new Error(`Unknown filter: ${q.filter}`);
  if (f?.ruleId) {
    // An audit rule defines its own set of URLs, which need not sit inside the tab's base set
    // (image rules flag the pages that embed the images). Showing exactly the flagged URLs keeps
    // the grid's count equal to the rule's count in the issues panel.
    if (q.change === 'new') {
      where.push(`p.id IN (SELECT i.url_id FROM issues i WHERE i.rule_id = ? AND NOT EXISTS (
        SELECT 1 FROM issue_baseline b WHERE b.rule_id = i.rule_id AND b.url_id = i.url_id))`);
    } else if (q.change === 'fixed') {
      // Selecting from pages keeps this to URLs crawled again; ones not re-crawled aren't fixed.
      where.push(`p.id IN (SELECT b.url_id FROM issue_baseline b WHERE b.rule_id = ? AND NOT EXISTS (
        SELECT 1 FROM issues i WHERE i.rule_id = b.rule_id AND i.url_id = b.url_id))`);
    } else {
      where.push('p.id IN (SELECT url_id FROM issues WHERE rule_id = ?)');
    }
    params.push(f.ruleId);
  } else {
    where.push(`(${tab.base})`);
    if (f?.where) where.push(`(${f.where})`);
  }
  if (q.pageType != null) {
    where.push('p.id IN (SELECT s.id FROM page_shapes s WHERE s.page_type_id = ?)');
    params.push(Math.trunc(q.pageType));
  }
  if (q.search) {
    where.push(`(p.url LIKE ? ESCAPE '\\' OR p.title LIKE ? ESCAPE '\\')`);
    const like = `%${q.search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    params.push(like, like);
  }
  const sortKey = q.sort && SORTABLE_COLUMNS.has(q.sort) ? q.sort : 'id';
  const dir = q.dir === 'desc' ? 'DESC' : 'ASC';
  const order =
    sortKey === 'id'
      ? 'p.depth ASC, p.crawled_at ASC'
      : `${columnSql(sortKey)} ${dir} NULLS LAST, p.id ASC`;
  const select = ['p.id', ...tab.columns.map((c) => `${columnSql(c.key)} AS ${c.key}`)].join(', ');
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 1000);
  const offset = Math.max(q.offset ?? 0, 0);
  const whereSql = where.join(' AND ');
  return {
    sql: `SELECT ${select} FROM pages p WHERE ${whereSql} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`,
    countSql: `SELECT count(*) AS n FROM pages p WHERE ${whereSql}`,
    params,
    columns: tab.columns,
  };
}
