/**
 * URL normalisation, identity and scope. Every URL that enters the frontier passes through
 * `normalizeUrl`, and its integer id comes from `urlId`, so the two must stay in lockstep:
 * the same page always gets the same id however a link spelled it.
 */

const SKIPPED_SCHEMES = /^(?:javascript|mailto|tel|data|sms|ftp|file|about|blob|chrome|intent):/i;

/** Resolve `href` against `base` and normalise it. Returns null for anything not crawlable. */
export function resolveUrl(href: string, base: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#') || SKIPPED_SCHEMES.test(trimmed)) return null;
  try {
    return normalizeUrl(new URL(trimmed, base).toString());
  } catch {
    return null;
  }
}

/**
 * Canonical spelling used for identity: lowercase scheme and host (WHATWG URL already does
 * both), no default port, no fragment, and an explicit `/` path. The query string is kept
 * verbatim and the path keeps its case — `/Page` and `/page` are
 * different URLs on most servers.
 */
export function normalizeUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  if (
    (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443')
  ) {
    url.port = '';
  }
  if (url.hostname.endsWith('.')) url.hostname = url.hostname.slice(0, -1);
  const out = url.toString();
  // An empty query (`/a?`) means the same resource as no query. `url.search` reads as '' for
  // both, so check the serialised form.
  return out.endsWith('?') ? out.slice(0, -1) : out;
}

/**
 * 53-bit string hash (cyrb53). It fits in a JS safe integer and a SQLite INTEGER, so the per-crawl
 * tables key on it directly. Collision odds at the 400k-URL crawl cap are about 1 in 100,000;
 * `frontier.url` is UNIQUE as well, so a collision is caught at insert time, never silently merged.
 */
export function urlId(url: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < url.length; i++) {
    const ch = url.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Registrable-ish root used for the subdomain rule: the last two labels of the host. */
export function rootDomain(hostname: string): string {
  const labels = hostname.split('.');
  return labels.length <= 2 ? hostname : labels.slice(-2).join('.');
}

export type Scope = { host: string; root: string; subdomains: boolean };

export function scopeFor(startUrl: string, subdomains: boolean): Scope {
  const host = new URL(startUrl).hostname;
  return { host, root: rootDomain(host.replace(/^www\./, '')), subdomains };
}

/**
 * Internal means "part of the site being crawled". `www.` and the bare host count as the same
 * site; other subdomains count only when the crawl opts into them.
 */
export function isInternal(url: string, scope: Scope): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  if (host === scope.host) return true;
  const bare = (h: string) => h.replace(/^www\./, '');
  if (bare(host) === bare(scope.host)) return true;
  return scope.subdomains && (host === scope.root || host.endsWith(`.${scope.root}`));
}

/** Compile include/exclude patterns once per crawl. Invalid patterns are dropped, not fatal. */
export function compileFilters(patterns: string[]): RegExp[] {
  const out: RegExp[] = [];
  for (const p of patterns) {
    try {
      out.push(new RegExp(p));
    } catch {
      // A bad pattern is rejected by the config form; ignore anything that slips through.
    }
  }
  return out;
}

export function passesFilters(url: string, include: RegExp[], exclude: RegExp[]): boolean {
  if (exclude.some((re) => re.test(url))) return false;
  return include.length === 0 || include.some((re) => re.test(url));
}

/** Path depth used by the directory tree view: `/a/b/` → 2. */
export function pathSegments(url: string): string[] {
  try {
    return new URL(url).pathname.split('/').filter(Boolean);
  } catch {
    return [];
  }
}

const TRACKING_PARAM = /^(?:utm_.+|gclid|fbclid|msclkid|mc_[ce]id|_ga|ref)$/i;

/**
 * A URL's shape for page-type grouping: variable path segments become placeholders and the
 * query keeps only its (sorted, non-tracking) keys. `/products/blue-widget-42?colour=red` →
 * `/products/{slug}?colour`. Two URLs with the same pattern are candidates for the same page type;
 * the template fingerprint decides whether they really are.
 */
export function urlPattern(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const segments = parsed.pathname.split('/');
  const last = segments.length - 1;
  const path = segments
    .map((segment, i) => (segment ? segmentPattern(decodeSegment(segment), i === last) : segment))
    .join('/');
  const keys = [...new Set(parsed.searchParams.keys())]
    .filter((k) => !TRACKING_PARAM.test(k))
    .sort();
  return keys.length ? `${path}?${keys.join('&')}` : path;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

const EXTENSION = /\.(?:html?|php|aspx?|jsp|cfm)$/i;

function segmentPattern(segment: string, isLast: boolean): string {
  const ext = segment.match(EXTENSION)?.[0] ?? '';
  const stem = ext ? segment.slice(0, -ext.length) : segment;
  return placeholder(stem, isLast) + ext;
}

function placeholder(stem: string, isLast: boolean): string {
  if (/^\d+$/.test(stem)) return '{n}';
  if (/^\d{4}-\d{2}(?:-\d{2})?$/.test(stem)) return '{date}';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stem)) return '{id}';
  if (/^[0-9a-f]{12,}$/i.test(stem) && /\d/.test(stem)) return '{id}';
  const words = stem.split(/[-_+]+/).filter(Boolean).length;
  // `/products/blue-widget` names one page; `/products/shoes` is usually a section. A multi-word
  // segment mid-path (`/my-long-category-name/`) is still a slug once it has several words.
  const mixed = stem.length >= 6 && /\d/.test(stem) && /\p{L}/u.test(stem);
  if ((isLast && words >= 2) || words >= 4 || mixed) {
    return '{slug}';
  }
  return stem.toLowerCase();
}

/** The Crawl Durable Object's name. Scoped by org so one tenant can never address another's crawl. */
export function crawlDoName(orgId: string, crawlId: string): string {
  return `org:${orgId}:crawl:${crawlId}`;
}
