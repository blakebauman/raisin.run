/**
 * Turns one FetchResult into the rows the Crawl DO writes: the `pages` row, the detail blob,
 * and the outgoing links, images and hreflang annotations. Pure, so it is tested without a DO.
 */

import { robotsDirectives } from './extract';
import { simhashBands } from './hash';
import { canonicalFromLinkHeader, indexability, isValidHreflang } from './indexability';
import { descriptionWidth, titleWidth } from './serp';
import type { FetchResult, LinkType, PageData } from './types';
import { isInternal, resolveUrl, type Scope, urlId, urlPattern } from './url';

export type PageRow = Record<string, string | number | null>;

export type LinkRow = {
  src: number;
  dst: number;
  dstUrl: string;
  type: LinkType;
  anchor: string;
  alt: string;
  rel: string;
  position: string;
  nofollow: number;
  internal: number;
  jsOnly: number;
};

export type ImageRow = {
  pageId: number;
  srcId: number;
  src: string;
  alt: string | null;
  width: string | null;
  height: string | null;
};
export type HreflangRow = { pageId: number; lang: string; hrefId: number; href: string };

export type MappedResult = {
  page: PageRow;
  details: PageRow;
  /** The `page_shapes` row, for internal HTML pages only. */
  shape: PageRow | null;
  links: LinkRow[];
  images: ImageRow[];
  hreflang: HreflangRow[];
};

const IMAGE_TYPES = /^image\//i;
const HTML_TYPES = /^(?:text\/html|application\/xhtml\+xml)/i;

export function isHtmlContentType(ct: string | null): boolean {
  return ct !== null && HTML_TYPES.test(ct);
}

export function mapResult(r: FetchResult, scope: Scope): MappedResult {
  const id = r.urlId;
  const internal = isInternal(r.url, scope) ? 1 : 0;
  const header = (name: string) => r.headers[name] ?? null;
  const isHtml = isHtmlContentType(r.contentType) && r.page !== null;
  const page = r.page;
  const base = page?.baseHref ? (resolveUrl(page.baseHref, r.url) ?? r.url) : r.url;
  const resolve = (href: string) => resolveUrl(href, base);

  const xRobots = header('x-robots-tag');
  const directives = robotsDirectives(page?.metaRobots ?? [], xRobots);

  const htmlCanonical = page?.canonicals[0] ? resolve(page.canonicals[0]) : null;
  const headerCanonicalRaw = canonicalFromLinkHeader(header('link'));
  const headerCanonical = headerCanonicalRaw ? resolveUrl(headerCanonicalRaw, r.url) : null;
  const canonical = htmlCanonical ?? headerCanonical;
  const distinctCanonicals = new Set((page?.canonicals ?? []).map(resolve).filter(Boolean));

  const idx = indexability({
    url: r.url,
    status: r.status,
    error: r.error,
    blockedByRobots: r.blockedByRobots,
    isHtml,
    directives,
    canonical,
  });

  const redirectTarget = r.redirectTarget ? resolveUrl(r.redirectTarget, r.url) : null;
  const title = page?.titles[0] ?? null;
  const desc = page?.metaDescriptions[0] ?? null;
  const bands = page ? simhashBands(page.simhash) : null;
  const csp = header('content-security-policy');
  const render = r.render;

  const row: PageRow = {
    id,
    url: r.url,
    internal,
    mode: r.mode,
    depth: r.depth,
    is_html: isHtml ? 1 : 0,
    is_image: r.contentType && IMAGE_TYPES.test(r.contentType) ? 1 : 0,
    status: r.status,
    status_text: r.statusText || null,
    error: r.error,
    blocked_robots: r.blockedByRobots ? 1 : 0,
    content_type: r.contentType,
    size: r.size,
    response_ms: r.responseMs,
    redirect_target: redirectTarget,
    redirect_target_id: redirectTarget ? urlId(redirectTarget) : null,
    indexable: idx.indexable ? 1 : 0,
    indexability_reason: idx.reason,
    title,
    title_len: title === null ? null : [...title].length,
    title_px: title === null ? null : titleWidth(title),
    title_count: page?.titles.length ?? 0,
    meta_desc: desc,
    meta_desc_len: desc === null ? null : [...desc].length,
    meta_desc_px: desc === null ? null : descriptionWidth(desc),
    meta_desc_count: page?.metaDescriptions.length ?? 0,
    meta_keywords: page?.metaKeywords ?? null,
    h1: page?.h1[0] ?? null,
    h1_len: page?.h1[0] ? [...page.h1[0]].length : null,
    h1_count: page?.h1.length ?? 0,
    h1_2: page?.h1[1] ?? null,
    h2: page?.h2[0] ?? null,
    h2_count: page?.h2.length ?? 0,
    h2_2: page?.h2[1] ?? null,
    headings_nonsequential: page && headingsSkip(page.headingOrder) ? 1 : 0,
    canonical: htmlCanonical,
    canonical_id: canonical ? urlId(canonical) : null,
    canonical_count: page?.canonicals.length ?? 0,
    canonical_header: headerCanonical,
    canonical_relative: page?.canonicals[0] && !/^https?:\/\//i.test(page.canonicals[0]) ? 1 : 0,
    canonical_conflict:
      (htmlCanonical && headerCanonical && htmlCanonical !== headerCanonical) ||
      distinctCanonicals.size > 1
        ? 1
        : 0,
    meta_robots: page?.metaRobots.join(', ') || null,
    x_robots: xRobots,
    noindex: directives.has('noindex') ? 1 : 0,
    nofollow: directives.has('nofollow') ? 1 : 0,
    meta_refresh: page?.metaRefresh ?? null,
    lang: page?.lang ?? null,
    viewport: page?.viewport ?? null,
    word_count: page ? page.wordCount : null,
    text_ratio: page && r.size > 0 ? Math.round((page.textBytes / r.size) * 1000) / 10 : null,
    lorem: page?.text?.toLowerCase().includes('lorem ipsum') || (page && loremIn(page)) ? 1 : 0,
    content_hash: page?.contentHash ?? null,
    simhash: page?.simhash ?? null,
    sh0: bands?.[0] ?? null,
    sh1: bands?.[1] ?? null,
    sh2: bands?.[2] ?? null,
    sh3: bands?.[3] ?? null,
    hsts: header('strict-transport-security') ? 1 : 0,
    csp: csp ? 1 : 0,
    xcto: (header('x-content-type-options') ?? '').toLowerCase().includes('nosniff') ? 1 : 0,
    x_frame: header('x-frame-options') || /frame-ancestors/i.test(csp ?? '') ? 1 : 0,
    referrer_policy: header('referrer-policy') ? 1 : 0,
    rel_next: page?.relNext ? resolve(page.relNext) : null,
    rel_prev: page?.relPrev ? resolve(page.relPrev) : null,
    amphtml: page?.amphtml ? resolve(page.amphtml) : null,
    hreflang_count: page?.hreflang.length ?? 0,
    hreflang_invalid: page?.hreflang.filter((h) => !isValidHreflang(h.lang)).length ?? 0,
    hreflang_x_default: page?.hreflang.some((h) => h.lang === 'x-default') ? 1 : 0,
    structured_types: page ? structuredTypes(page) : null,
    sd_errors: page?.structuredData.reduce((n, b) => n + b.errors.length, 0) ?? 0,
    images_count: page?.images.length ?? 0,
    images_missing_alt: page?.images.filter((i) => i.alt === null).length ?? 0,
    mixed_content: page?.mixedContent.length ?? 0,
    insecure_forms: page?.insecureForms ?? 0,
    rendered: render ? 1 : 0,
    js_word_count: render?.page.wordCount ?? null,
    js_title: render ? (render.page.titles[0] ?? null) : null,
    js_h1: render ? (render.page.h1[0] ?? null) : null,
    js_canonical: render?.page.canonicals[0] ? resolve(render.page.canonicals[0]) : null,
    js_noindex: render
      ? robotsDirectives(render.page.metaRobots, xRobots).has('noindex')
        ? 1
        : 0
      : null,
    console_errors: render?.consoleErrors.length ?? 0,
    lcp_ms: render?.lcpMs ?? null,
    cls: render?.cls ?? null,
    screenshot_key: render?.screenshotKey ?? null,
    html_key: r.htmlKey,
    last_modified: header('last-modified'),
    crawled_at: r.fetchedAt,
  };

  // The rendered DOM's template when there is one: a JavaScript app's raw HTML is only its shell.
  const pattern = isHtml && internal ? pagePattern(r.url, scope) : null;
  const template = render?.page.templateSignature ?? page?.templateSignature;
  const shape: PageRow | null =
    pattern && template ? { id, url_pattern: pattern, tpl_minhash: template } : null;

  // Links: raw-HTML links, plus any that only the rendered DOM has (flagged js_only).
  const links: LinkRow[] = [];
  const seenRaw = new Set<string>();
  const pushLinks = (data: PageData, jsOnly: boolean) => {
    for (const l of data.links) {
      const dst = resolve(l.href);
      if (!dst) continue;
      const key = `${l.type} ${dst}`;
      if (jsOnly && seenRaw.has(key)) continue;
      if (!jsOnly) seenRaw.add(key);
      const relTokens = l.rel.split(/\s+/);
      links.push({
        src: id,
        dst: urlId(dst),
        dstUrl: dst,
        type: l.type,
        anchor: l.anchor.slice(0, 500),
        alt: l.alt.slice(0, 500),
        rel: l.rel,
        position: l.position,
        nofollow:
          relTokens.includes('nofollow') ||
          relTokens.includes('ugc') ||
          relTokens.includes('sponsored')
            ? 1
            : 0,
        internal: isInternal(dst, scope) ? 1 : 0,
        jsOnly: jsOnly ? 1 : 0,
      });
    }
  };
  if (page) pushLinks(page, false);
  if (render) pushLinks(render.page, true);
  row.js_links_added = links.filter((l) => l.jsOnly && l.type === 'a').length;

  const anchors = links.filter((l) => l.type === 'a');
  row.outlinks = anchors.filter((l) => l.internal).length;
  row.unique_outlinks = new Set(anchors.filter((l) => l.internal).map((l) => l.dst)).size;
  row.external_outlinks = new Set(anchors.filter((l) => !l.internal).map((l) => l.dst)).size;
  row.nofollow_internal_outlinks = anchors.filter((l) => l.internal && l.nofollow).length;

  const effective = render?.page ?? page;
  const images: ImageRow[] = [];
  for (const img of effective?.images ?? []) {
    const src = resolve(img.src);
    if (src)
      images.push({
        pageId: id,
        srcId: urlId(src),
        src,
        alt: img.alt,
        width: img.width,
        height: img.height,
      });
  }
  const hreflang: HreflangRow[] = [];
  for (const h of page?.hreflang ?? []) {
    const href = resolve(h.href);
    if (href) hreflang.push({ pageId: id, lang: h.lang, hrefId: urlId(href), href });
  }

  const details: PageRow = {
    id,
    headers_json: JSON.stringify(r.headers),
    hreflang_json: page?.hreflang.length ? JSON.stringify(page.hreflang) : null,
    structured_json: page?.structuredData.length ? JSON.stringify(page.structuredData) : null,
    social_json:
      page && (Object.keys(page.openGraph).length || Object.keys(page.twitter).length)
        ? JSON.stringify({ og: page.openGraph, twitter: page.twitter })
        : null,
    mixed_json: page?.mixedContent.length ? JSON.stringify(page.mixedContent) : null,
    js_json: render
      ? JSON.stringify({
          consoleErrors: render.consoleErrors.slice(0, 50),
          failedRequests: render.failedRequests.slice(0, 50),
          renderedTitle: render.page.titles[0] ?? null,
          renderedWordCount: render.page.wordCount,
        })
      : null,
    extractions_json:
      effective && Object.keys(effective.extractions).length
        ? JSON.stringify(effective.extractions)
        : null,
    text: effective?.text ?? null,
  };

  return { page: row, details, shape, links, images, hreflang };
}

function headingsSkip(order: number[]): boolean {
  let prev = 0;
  for (const level of order) {
    if (prev > 0 && level > prev + 1) return true;
    prev = level;
  }
  return order.length > 0 && order[0] !== 1 && order.includes(1);
}

function loremIn(page: PageData): boolean {
  return [...page.titles, ...page.h1, ...page.h2].some((t) => /lorem ipsum/i.test(t));
}

/** The URL pattern, prefixed with the host when it's another subdomain (`www.` doesn't count). */
function pagePattern(url: string, scope: Scope): string | null {
  const pattern = urlPattern(url);
  if (pattern === null) return null;
  const bare = (h: string) => h.replace(/^www\./, '');
  const host = bare(new URL(url).hostname);
  return host === bare(scope.host) ? pattern : `${host}${pattern}`;
}

function structuredTypes(page: PageData): string | null {
  const types = new Set(page.structuredData.flatMap((b) => b.types));
  if (page.structuredData.length && types.size === 0) return 'invalid';
  return types.size ? [...types].join(', ') : null;
}
