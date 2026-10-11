/**
 * Indexability, decided in a fixed order: the first reason that applies wins, so a
 * noindexed page that also 404s reports "Client Error", not "noindex".
 */

export type IndexabilityInput = {
  url: string;
  status: number;
  error: string | null;
  blockedByRobots: boolean;
  isHtml: boolean;
  directives: Set<string>;
  /** Resolved, normalised canonical URL (HTML link element, else the HTTP Link header). */
  canonical: string | null;
};

export type Indexability = { indexable: boolean; reason: string | null };

export function indexability(i: IndexabilityInput): Indexability {
  if (i.blockedByRobots) return { indexable: false, reason: 'Blocked by robots.txt' };
  if (i.error || i.status === 0) return { indexable: false, reason: 'No Response' };
  if (i.status >= 300 && i.status < 400) return { indexable: false, reason: 'Redirected' };
  if (i.status >= 400 && i.status < 500) return { indexable: false, reason: 'Client Error' };
  if (i.status >= 500) return { indexable: false, reason: 'Server Error' };
  if (i.status !== 200) return { indexable: false, reason: `Status ${i.status}` };
  if (i.directives.has('noindex')) return { indexable: false, reason: 'noindex' };
  if (i.isHtml && i.canonical && i.canonical !== i.url)
    return { indexable: false, reason: 'Canonicalised' };
  return { indexable: true, reason: null };
}

/** `Link: <https://example.com/a>; rel="canonical"` → the URL, if present. */
export function canonicalFromLinkHeader(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(/,(?=\s*<)/)) {
    const m = part.match(/<([^>]+)>\s*;(.*)$/);
    if (m?.[1] && /rel\s*=\s*"?canonical"?/i.test(m[2] ?? '')) return m[1].trim();
  }
  return null;
}

const HREFLANG_RE = /^(?:x-default|[a-z]{2,3}(?:-[a-z]{4})?(?:-(?:[a-z]{2}|\d{3}))?)$/i;

export function isValidHreflang(code: string): boolean {
  return HREFLANG_RE.test(code.trim());
}
