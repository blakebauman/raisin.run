/**
 * XML sitemap parsing. Workers have no DOMParser, and sitemaps are a flat, well-known shape,
 * so a tolerant regex reader is enough: it accepts namespaces, CDATA and entity-escaped `<loc>`s.
 */

export type ParsedSitemap =
  | { kind: 'index'; sitemaps: string[] }
  | { kind: 'urlset'; urls: { loc: string; lastmod: string | null }[] }
  | { kind: 'unknown' };

/** Google's per-file limit. Anything past it is ignored, as Google does. */
export const MAX_SITEMAP_URLS = 50_000;

export function parseSitemap(xml: string): ParsedSitemap {
  if (/<(?:\w+:)?sitemapindex[\s>]/i.test(xml)) {
    return {
      kind: 'index',
      sitemaps: blocks(xml, 'sitemap')
        .map((b) => tag(b, 'loc'))
        .filter(isString),
    };
  }
  if (/<(?:\w+:)?urlset[\s>]/i.test(xml)) {
    const urls: { loc: string; lastmod: string | null }[] = [];
    for (const block of blocks(xml, 'url')) {
      const loc = tag(block, 'loc');
      if (loc) urls.push({ loc, lastmod: tag(block, 'lastmod') });
      if (urls.length >= MAX_SITEMAP_URLS) break;
    }
    return { kind: 'urlset', urls };
  }
  return { kind: 'unknown' };
}

function blocks(xml: string, name: string): string[] {
  const re = new RegExp(`<(?:\\w+:)?${name}[\\s>]([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'gi');
  return [...xml.matchAll(re)].map((m) => m[1] ?? '');
}

function tag(block: string, name: string): string | null {
  const m = block.match(
    new RegExp(`<(?:\\w+:)?${name}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i'),
  );
  if (!m?.[1]) return null;
  const value = decodeXml(m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim());
  return value || null;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function isString(v: string | null): v is string {
  return v !== null;
}

/** Plain-text sitemaps: one URL per line. */
export function parseTextSitemap(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^https?:\/\//i.test(l))
    .slice(0, MAX_SITEMAP_URLS);
}

/** Read a sitemap response body, transparently gunzipping `.xml.gz`. */
export async function readSitemapBody(res: Response, url: string): Promise<string> {
  const gz =
    url.endsWith('.gz') ||
    (res.headers.get('content-type') ?? '').includes('gzip') ||
    (res.headers.get('content-type') ?? '').includes('x-gzip');
  if (gz && res.body && res.headers.get('content-encoding') !== 'gzip') {
    const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }
  return res.text();
}
