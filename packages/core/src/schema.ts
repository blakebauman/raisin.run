/**
 * The per-crawl SQLite schema, owned by one Crawl Durable Object per crawl. It lives in core so
 * the audit SQL and the tab queries are written against the same definition the DO creates.
 *
 * Identity: every table keys URLs on `urlId(normalizedUrl)` — see url.ts.
 */

export const CRAWL_SCHEMA_VERSION = 2;

export const CRAWL_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,

  // Every URL ever discovered, crawled or not. `seq` gives breadth-first dispatch order.
  `CREATE TABLE IF NOT EXISTS frontier (
    id INTEGER PRIMARY KEY,
    url TEXT NOT NULL UNIQUE,
    seq INTEGER NOT NULL,
    depth INTEGER NOT NULL,
    via TEXT NOT NULL,
    source_id INTEGER,
    mode TEXT NOT NULL,
    internal INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    lease_until INTEGER,
    discovered_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS frontier_dispatch ON frontier (state, depth, seq)`,
  `CREATE INDEX IF NOT EXISTS frontier_lease ON frontier (state, lease_until)`,

  // One row per fetched URL: the "Internal"/"External" tab columns.
  `CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY,
    url TEXT NOT NULL,
    internal INTEGER NOT NULL,
    mode TEXT NOT NULL,
    depth INTEGER NOT NULL,
    is_html INTEGER NOT NULL DEFAULT 0,
    is_image INTEGER NOT NULL DEFAULT 0,
    status INTEGER NOT NULL,
    status_text TEXT,
    error TEXT,
    blocked_robots INTEGER NOT NULL DEFAULT 0,
    content_type TEXT,
    size INTEGER NOT NULL DEFAULT 0,
    response_ms INTEGER NOT NULL DEFAULT 0,
    redirect_target TEXT,
    redirect_target_id INTEGER,
    indexable INTEGER NOT NULL DEFAULT 0,
    indexability_reason TEXT,
    title TEXT,
    title_len INTEGER,
    title_px INTEGER,
    title_count INTEGER NOT NULL DEFAULT 0,
    meta_desc TEXT,
    meta_desc_len INTEGER,
    meta_desc_px INTEGER,
    meta_desc_count INTEGER NOT NULL DEFAULT 0,
    meta_keywords TEXT,
    h1 TEXT,
    h1_len INTEGER,
    h1_count INTEGER NOT NULL DEFAULT 0,
    h1_2 TEXT,
    h2 TEXT,
    h2_count INTEGER NOT NULL DEFAULT 0,
    h2_2 TEXT,
    headings_nonsequential INTEGER NOT NULL DEFAULT 0,
    canonical TEXT,
    canonical_id INTEGER,
    canonical_count INTEGER NOT NULL DEFAULT 0,
    canonical_header TEXT,
    canonical_relative INTEGER NOT NULL DEFAULT 0,
    canonical_conflict INTEGER NOT NULL DEFAULT 0,
    meta_robots TEXT,
    x_robots TEXT,
    noindex INTEGER NOT NULL DEFAULT 0,
    nofollow INTEGER NOT NULL DEFAULT 0,
    meta_refresh TEXT,
    lang TEXT,
    viewport TEXT,
    word_count INTEGER,
    text_ratio REAL,
    lorem INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT,
    simhash TEXT,
    sh0 INTEGER, sh1 INTEGER, sh2 INTEGER, sh3 INTEGER,
    inlinks INTEGER NOT NULL DEFAULT 0,
    unique_inlinks INTEGER NOT NULL DEFAULT 0,
    outlinks INTEGER NOT NULL DEFAULT 0,
    unique_outlinks INTEGER NOT NULL DEFAULT 0,
    external_outlinks INTEGER NOT NULL DEFAULT 0,
    nofollow_internal_outlinks INTEGER NOT NULL DEFAULT 0,
    link_score REAL,
    hsts INTEGER NOT NULL DEFAULT 0,
    csp INTEGER NOT NULL DEFAULT 0,
    xcto INTEGER NOT NULL DEFAULT 0,
    x_frame INTEGER NOT NULL DEFAULT 0,
    referrer_policy INTEGER NOT NULL DEFAULT 0,
    rel_next TEXT,
    rel_prev TEXT,
    amphtml TEXT,
    hreflang_count INTEGER NOT NULL DEFAULT 0,
    hreflang_invalid INTEGER NOT NULL DEFAULT 0,
    hreflang_x_default INTEGER NOT NULL DEFAULT 0,
    structured_types TEXT,
    sd_errors INTEGER NOT NULL DEFAULT 0,
    images_count INTEGER NOT NULL DEFAULT 0,
    images_missing_alt INTEGER NOT NULL DEFAULT 0,
    mixed_content INTEGER NOT NULL DEFAULT 0,
    insecure_forms INTEGER NOT NULL DEFAULT 0,
    rendered INTEGER NOT NULL DEFAULT 0,
    js_word_count INTEGER,
    js_title TEXT,
    js_h1 TEXT,
    js_canonical TEXT,
    js_noindex INTEGER,
    js_links_added INTEGER NOT NULL DEFAULT 0,
    console_errors INTEGER NOT NULL DEFAULT 0,
    lcp_ms INTEGER,
    cls REAL,
    screenshot_key TEXT,
    html_key TEXT,
    in_sitemap INTEGER NOT NULL DEFAULT 0,
    near_dup_count INTEGER NOT NULL DEFAULT 0,
    near_dup_max INTEGER,
    semantic_dup_count INTEGER NOT NULL DEFAULT 0,
    semantic_dup_max REAL,
    last_modified TEXT,
    crawled_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS pages_internal_status ON pages (internal, status)`,
  `CREATE INDEX IF NOT EXISTS pages_title ON pages (title) WHERE title IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS pages_meta_desc ON pages (meta_desc) WHERE meta_desc IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS pages_h1 ON pages (h1) WHERE h1 IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS pages_content_hash ON pages (content_hash) WHERE content_hash IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS pages_sh0 ON pages (sh0) WHERE sh0 IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS pages_sh1 ON pages (sh1) WHERE sh1 IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS pages_sh2 ON pages (sh2) WHERE sh2 IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS pages_sh3 ON pages (sh3) WHERE sh3 IS NOT NULL`,

  // Large, rarely-read blobs for the URL detail pane, kept out of the grid's row width.
  `CREATE TABLE IF NOT EXISTS page_details (
    id INTEGER PRIMARY KEY,
    headers_json TEXT,
    hreflang_json TEXT,
    structured_json TEXT,
    social_json TEXT,
    mixed_json TEXT,
    js_json TEXT,
    extractions_json TEXT,
    text TEXT
  )`,

  // The link graph. `src`/`dst` are url ids; `dst` may not have a pages row (never crawled).
  `CREATE TABLE IF NOT EXISTS links (
    src INTEGER NOT NULL,
    dst INTEGER NOT NULL,
    type TEXT NOT NULL,
    anchor TEXT,
    alt TEXT,
    rel TEXT,
    position TEXT,
    nofollow INTEGER NOT NULL DEFAULT 0,
    internal INTEGER NOT NULL,
    js_only INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS links_src ON links (src)`,
  `CREATE INDEX IF NOT EXISTS links_dst ON links (dst, type)`,

  `CREATE TABLE IF NOT EXISTS images (
    page_id INTEGER NOT NULL,
    src_id INTEGER NOT NULL,
    src TEXT NOT NULL,
    alt TEXT,
    width TEXT,
    height TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS images_src ON images (src_id)`,
  `CREATE INDEX IF NOT EXISTS images_page ON images (page_id)`,

  `CREATE TABLE IF NOT EXISTS hreflang (
    page_id INTEGER NOT NULL,
    lang TEXT NOT NULL,
    href_id INTEGER NOT NULL,
    href TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS hreflang_page ON hreflang (page_id)`,
  `CREATE INDEX IF NOT EXISTS hreflang_href ON hreflang (href_id, page_id)`,

  `CREATE TABLE IF NOT EXISTS sitemaps (url TEXT PRIMARY KEY, status INTEGER, url_count INTEGER NOT NULL DEFAULT 0, error TEXT)`,
  `CREATE TABLE IF NOT EXISTS sitemap_urls (id INTEGER PRIMARY KEY, url TEXT NOT NULL, lastmod TEXT)`,

  // Materialised audit results. Page rules are inserted during ingest, crawl rules at analysis.
  `CREATE TABLE IF NOT EXISTS issues (
    rule_id TEXT NOT NULL,
    url_id INTEGER NOT NULL,
    PRIMARY KEY (rule_id, url_id)
  ) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS issues_url ON issues (url_id)`,

  // The previous completed crawl's audit results, copied in at analysis so this crawl can show
  // what is new and what was fixed. URL ids hash the normalised URL, so they match across crawls.
  // Which crawl it came from is in meta under 'baseline'.
  `CREATE TABLE IF NOT EXISTS issue_baseline (
    rule_id TEXT NOT NULL,
    url_id INTEGER NOT NULL,
    PRIMARY KEY (rule_id, url_id)
  ) WITHOUT ROWID`,

  `CREATE TABLE IF NOT EXISTS duplicates (
    a INTEGER NOT NULL,
    b INTEGER NOT NULL,
    kind TEXT NOT NULL,
    similarity REAL NOT NULL,
    PRIMARY KEY (kind, a, b)
  ) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS duplicates_b ON duplicates (kind, b)`,

  // Page-type signals for internal HTML pages, captured at ingest. Kept out of `pages`, which is
  // at the 100-column limit Durable Object SQLite allows. `page_type_id` is set at analysis.
  `CREATE TABLE IF NOT EXISTS page_shapes (
    id INTEGER PRIMARY KEY,
    url_pattern TEXT NOT NULL,
    tpl_simhash TEXT NOT NULL,
    page_type_id INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS page_shapes_type ON page_shapes (page_type_id)`,

  // Page types (page-types.ts), rebuilt at analysis.
  `CREATE TABLE IF NOT EXISTS page_types (
    id INTEGER PRIMARY KEY,
    label TEXT NOT NULL,
    patterns_json TEXT NOT NULL,
    sd_type TEXT,
    page_count INTEGER NOT NULL,
    sample_id INTEGER NOT NULL
  )`,
];
