/**
 * Shared contracts between the web app, the engine's queue consumers and the Crawl Durable
 * Object. Everything here crosses an RPC or queue boundary, so it must stay structured-clone
 * safe: plain objects, arrays, strings, numbers, booleans and null.
 */

export type CrawlStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'stopping'
  | 'analysing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type CustomExtractor = {
  name: string;
  /** CSS selector (HTMLRewriter subset) or a JavaScript regular expression source. */
  kind: 'css' | 'regex';
  selector: string;
  /** For `css`: the attribute to read, or omit for the element's text. */
  attribute?: string;
};

export type CrawlConfig = {
  startUrl: string;
  maxUrls: number;
  maxDepth: number;
  /** Dispatch rate from the Crawl DO, in URLs per second. */
  maxUrlsPerSecond: number;
  /** Cap on URLs leased to consumers and not yet ingested. */
  maxInFlight: number;
  userAgent: string;
  customHeaders: Record<string, string>;
  respectRobots: boolean;
  respectNofollow: boolean;
  respectCanonical: boolean;
  crawlSubdomains: boolean;
  checkExternalLinks: boolean;
  crawlImages: boolean;
  crawlCss: boolean;
  crawlJs: boolean;
  crawlSitemaps: boolean;
  followHreflang: boolean;
  followPagination: boolean;
  include: string[];
  exclude: string[];
  render: {
    enabled: boolean;
    waitUntil: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
    timeoutMs: number;
    screenshots: boolean;
  };
  storeHtml: boolean;
  ai: {
    nearDuplicates: boolean;
  };
  extractors: CustomExtractor[];
  requestTimeoutMs: number;
};

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (compatible; RaisinBot/1.0; +https://raisin.run/bot)';

export function defaultCrawlConfig(startUrl: string): CrawlConfig {
  return {
    startUrl,
    maxUrls: 500,
    maxDepth: 20,
    maxUrlsPerSecond: 5,
    maxInFlight: 50,
    userAgent: DEFAULT_USER_AGENT,
    customHeaders: {},
    respectRobots: true,
    respectNofollow: true,
    respectCanonical: true,
    crawlSubdomains: false,
    checkExternalLinks: true,
    crawlImages: true,
    crawlCss: false,
    crawlJs: false,
    crawlSitemaps: true,
    followHreflang: true,
    followPagination: true,
    include: [],
    exclude: [],
    render: { enabled: false, waitUntil: 'networkidle0', timeoutMs: 15_000, screenshots: false },
    storeHtml: false,
    ai: { nearDuplicates: false },
    extractors: [],
    requestTimeoutMs: 20_000,
  };
}

/** How a URL entered the frontier. */
export type DiscoveryVia =
  | 'seed'
  | 'link'
  | 'sitemap'
  | 'redirect'
  | 'canonical'
  | 'hreflang'
  | 'pagination'
  | 'image'
  | 'css'
  | 'js'
  | 'iframe';

/** What the consumer should do with a URL. */
export type FetchMode = 'page' | 'resource' | 'external';

/** One queue message = one URL to fetch. Kept small; the full config stays in the DO. */
export type FetchTask = {
  crawlId: string;
  /** Durable Object name — `org:{orgId}:crawl:{crawlId}`. */
  doName: string;
  urlId: number;
  url: string;
  depth: number;
  mode: FetchMode;
  attempt: number;
  opts: FetchOptions;
};

export type FetchOptions = {
  userAgent: string;
  headers: Record<string, string>;
  respectRobots: boolean;
  timeoutMs: number;
  storeHtml: boolean;
  render: CrawlConfig['render'] | null;
  extractors: CustomExtractor[];
  keepText: boolean;
};

export type LinkType =
  | 'a'
  | 'img'
  | 'css'
  | 'js'
  | 'iframe'
  | 'canonical'
  | 'hreflang'
  | 'next'
  | 'prev'
  | 'amphtml'
  | 'meta-refresh';

export type ExtractedLink = {
  href: string;
  type: LinkType;
  anchor: string;
  rel: string;
  alt: string;
  /** Rough page region: head, nav, header, footer, aside, or content. */
  position: string;
};

export type ExtractedImage = {
  src: string;
  alt: string | null;
  width: string | null;
  height: string | null;
};

export type ExtractedHreflang = { lang: string; href: string };

export type StructuredDataBlock = {
  format: 'json-ld' | 'microdata' | 'rdfa';
  types: string[];
  valid: boolean;
  errors: string[];
  /** Raw JSON-LD for the detail pane, truncated. */
  raw?: string;
};

/** Everything the extractor pulls out of an HTML document. */
export type PageData = {
  titles: string[];
  metaDescriptions: string[];
  metaKeywords: string | null;
  metaRobots: string[];
  metaRefresh: string | null;
  canonicals: string[];
  h1: string[];
  h2: string[];
  headingOrder: number[];
  lang: string | null;
  viewport: string | null;
  charset: string | null;
  hreflang: ExtractedHreflang[];
  links: ExtractedLink[];
  images: ExtractedImage[];
  structuredData: StructuredDataBlock[];
  openGraph: Record<string, string>;
  twitter: Record<string, string>;
  relNext: string | null;
  relPrev: string | null;
  amphtml: string | null;
  baseHref: string | null;
  wordCount: number;
  textBytes: number;
  /** First ~4 KB of visible text, only when the crawl needs it (AI, near-duplicates). */
  text: string | null;
  contentHash: string;
  simhash: string;
  /** Simhash of the page's element structure (tags and classes, no text); see extract.ts. */
  templateHash: string;
  insecureForms: number;
  mixedContent: string[];
  extractions: Record<string, string[]>;
};

/** Result of rendering a page in Browser Run, diffed against the raw HTML. */
export type RenderData = {
  page: PageData;
  consoleErrors: string[];
  failedRequests: string[];
  lcpMs: number | null;
  cls: number | null;
  screenshotKey: string | null;
};

export type RedirectHop = { url: string; status: number };

export type FetchResult = {
  urlId: number;
  url: string;
  mode: FetchMode;
  depth: number;
  status: number;
  statusText: string;
  /** Set when the request never produced an HTTP response. */
  error: string | null;
  blockedByRobots: boolean;
  contentType: string | null;
  size: number;
  responseMs: number;
  headers: Record<string, string>;
  redirectTarget: string | null;
  page: PageData | null;
  render: RenderData | null;
  htmlKey: string | null;
  fetchedAt: number;
};

/** Live counters the Crawl DO broadcasts over WebSocket. */
export type CrawlProgress = {
  status: CrawlStatus;
  discovered: number;
  crawled: number;
  inFlight: number;
  pending: number;
  failed: number;
  urlsPerSecond: number;
  statusBuckets: Record<string, number>;
  startedAt: number | null;
  finishedAt: number | null;
};
