/**
 * The page extractor. One streaming HTMLRewriter pass over a document collects everything the
 * audits need — one row of per-URL columns. The same function runs on
 * raw HTML in the fetcher and on rendered HTML from Browser Run, which is what makes the
 * raw-vs-rendered diff meaningful.
 */

import { decodeEntities, squash } from './entities';
import { contentHash, minhash, simhash } from './hash';
import { checkJsonLd } from './structured-data';
import type {
  CustomExtractor,
  ExtractedHreflang,
  ExtractedImage,
  ExtractedLink,
  LinkType,
  PageData,
  StructuredDataBlock,
} from './types';

export type ExtractOptions = {
  keepText?: boolean;
  extractors?: CustomExtractor[];
};

const KEEP_TEXT_CHARS = 4_000;
const MAX_LINKS = 5_000;
const MAX_IMAGES = 1_000;
const MAX_EXTRACTION_VALUES = 20;
/** Elements deeper than this rarely say anything about the template, only about the content. */
const TEMPLATE_MAX_DEPTH = 12;

/** Elements whose text is never visible page content. */
const SKIP_SELECTOR = 'script, style, noscript, template, svg, title, textarea, select';
const REGION_SELECTOR = 'nav, header, footer, aside';

type OpenText = { parts: string[]; done: (text: string) => void };

export async function extractPage(
  html: string,
  pageUrl: string,
  opts: ExtractOptions = {},
): Promise<PageData> {
  const isHttps = pageUrl.startsWith('https:');
  const data: PageData = {
    titles: [],
    metaDescriptions: [],
    metaKeywords: null,
    metaRobots: [],
    metaRefresh: null,
    canonicals: [],
    h1: [],
    h2: [],
    headingOrder: [],
    lang: null,
    viewport: null,
    charset: null,
    hreflang: [],
    links: [],
    images: [],
    structuredData: [],
    openGraph: {},
    twitter: {},
    relNext: null,
    relPrev: null,
    amphtml: null,
    baseHref: null,
    wordCount: 0,
    textBytes: 0,
    text: null,
    contentHash: '',
    simhash: '',
    templateSignature: null,
    insecureForms: 0,
    mixedContent: [],
    extractions: {},
  };

  let skipDepth = 0;
  let svgDepth = 0;
  const regions: string[] = [];
  const bodyText: string[] = [];
  let currentAnchor: ExtractedLink | null = null;
  const jsonLd: string[] = [];
  const microdataTypes = new Set<string>();
  const rdfaTypes = new Set<string>();

  let anchorParts: string[] | null = null;

  // Template fingerprint: one `parent>child` feature per distinct element shape, ignoring text.
  // A Set, so a listing with 10 cards and one with 50 hash the same.
  const shape: string[] = [];
  const templateFeatures = new Set<string>();

  // lol-html keeps only one end-tag handler per element, so several handlers on the same
  // element (say `title` is both skipped text and captured) would overwrite each other. A single
  // `*` handler, registered first, owns `onEndTag` and runs every callback queued for the element.
  type Open = { closable: boolean; ends: (() => void)[] };
  let current: Open = { closable: false, ends: [] };
  const onEnd = (_el: Element, fn: () => void): boolean => {
    if (!current.closable) return false;
    current.ends.push(fn);
    return true;
  };

  const position = () => regions[regions.length - 1] ?? 'content';
  const attr = (el: Element, name: string) => {
    const v = el.getAttribute(name);
    return v === null ? null : decodeEntities(v).trim();
  };
  const pushLink = (href: string | null, type: LinkType, extra: Partial<ExtractedLink> = {}) => {
    if (!href || data.links.length >= MAX_LINKS) return null;
    const link: ExtractedLink = {
      href,
      type,
      anchor: '',
      rel: '',
      alt: '',
      position: position(),
      ...extra,
    };
    data.links.push(link);
    return link;
  };
  const noteMixed = (src: string | null) => {
    if (isHttps && src?.startsWith('http://')) data.mixedContent.push(src);
  };

  /** Collect an element's descendant text, then hand it to `done` at its end tag. */
  const captureText = (el: Element, done: (text: string) => void, stack: OpenText[]) => {
    const entry: OpenText = { parts: [], done };
    stack.push(entry);
    const closed = onEnd(el, () => {
      stack.splice(stack.indexOf(entry), 1);
      entry.done(squash(decodeEntities(entry.parts.join(''))));
    });
    if (!closed) stack.pop();
  };
  const titleStack: OpenText[] = [];
  const headingStack: OpenText[] = [];
  const jsonLdStack: OpenText[] = [];
  const extractorStacks = new Map<string, OpenText[]>();

  let rewriter = new HTMLRewriter()
    .on('*', {
      element(el) {
        const open: Open = { closable: true, ends: [] };
        try {
          el.onEndTag(() => {
            for (let i = open.ends.length - 1; i >= 0; i--) open.ends[i]!();
          });
        } catch {
          // Void and self-closing elements have no end tag.
          open.closable = false;
        }
        current = open;
        if (svgDepth === 0 && shape.length < TEMPLATE_MAX_DEPTH) {
          const token = elementToken(el);
          templateFeatures.add(`${shape[shape.length - 1] ?? ''}>${token}`);
          if (open.closable) {
            shape.push(token);
            open.ends.push(() => shape.pop());
          }
        }
      },
    })
    .on('html', {
      element(el) {
        data.lang = attr(el, 'lang');
      },
    })
    .on('base[href]', {
      element(el) {
        data.baseHref ??= attr(el, 'href');
      },
    })
    .on(SKIP_SELECTOR, {
      element(el) {
        const svg = el.tagName === 'svg';
        const closed = onEnd(el, () => {
          skipDepth--;
          if (svg) svgDepth--;
        });
        if (!closed) return;
        skipDepth++;
        if (svg) svgDepth++;
      },
    })
    .on(REGION_SELECTOR, {
      element(el) {
        if (onEnd(el, () => regions.pop())) regions.push(el.tagName);
      },
    })
    .on('title', {
      element(el) {
        if (svgDepth > 0) return;
        captureText(el, (t) => data.titles.push(t), titleStack);
      },
      text(chunk) {
        titleStack[titleStack.length - 1]?.parts.push(chunk.text);
      },
    })
    .on('meta', {
      element(el) {
        const name = (attr(el, 'name') ?? attr(el, 'property') ?? '').toLowerCase();
        const content = attr(el, 'content') ?? '';
        const httpEquiv = (attr(el, 'http-equiv') ?? '').toLowerCase();
        const charset = attr(el, 'charset');
        if (charset) data.charset = charset.toLowerCase();
        if (httpEquiv === 'refresh') data.metaRefresh = content;
        if (httpEquiv === 'content-type' && !data.charset) {
          data.charset = content.match(/charset=([^;]+)/i)?.[1]?.toLowerCase() ?? null;
        }
        if (!name) return;
        if (name === 'description') data.metaDescriptions.push(squash(content));
        else if (name === 'keywords') data.metaKeywords = squash(content);
        else if (name === 'robots' || name === 'googlebot')
          data.metaRobots.push(content.toLowerCase());
        else if (name === 'viewport') data.viewport = content;
        else if (name.startsWith('og:')) data.openGraph[name] ??= content;
        else if (name.startsWith('twitter:')) data.twitter[name] ??= content;
      },
    })
    .on('link[href]', {
      element(el) {
        const rel = (attr(el, 'rel') ?? '').toLowerCase().split(/\s+/);
        const href = attr(el, 'href');
        if (!href) return;
        if (rel.includes('canonical')) {
          data.canonicals.push(href);
          pushLink(href, 'canonical', { position: 'head', rel: 'canonical' });
        }
        if (rel.includes('alternate') && el.hasAttribute('hreflang')) {
          const lang = (attr(el, 'hreflang') ?? '').toLowerCase();
          data.hreflang.push({ lang, href } satisfies ExtractedHreflang);
          pushLink(href, 'hreflang', { position: 'head', rel: `alternate ${lang}` });
        }
        if (rel.includes('next')) {
          data.relNext ??= href;
          pushLink(href, 'next', { position: 'head', rel: 'next' });
        }
        if (rel.includes('prev') || rel.includes('previous')) {
          data.relPrev ??= href;
          pushLink(href, 'prev', { position: 'head', rel: 'prev' });
        }
        if (rel.includes('amphtml')) {
          data.amphtml ??= href;
          pushLink(href, 'amphtml', { position: 'head', rel: 'amphtml' });
        }
        if (rel.includes('stylesheet')) {
          noteMixed(href);
          pushLink(href, 'css', { position: 'head', rel: 'stylesheet' });
        }
      },
    })
    .on('a[href], area[href]', {
      element(el) {
        const link = pushLink(attr(el, 'href'), 'a', {
          rel: (attr(el, 'rel') ?? '').toLowerCase(),
        });
        if (!link || el.tagName === 'area') {
          if (link) link.anchor = attr(el, 'alt') ?? '';
          return;
        }
        const title = attr(el, 'title');
        currentAnchor = link;
        const parts: string[] = [];
        anchorParts = parts;
        onEnd(el, () => {
          link.anchor = squash(decodeEntities(parts.join(''))) || title || '';
          if (currentAnchor === link) currentAnchor = null;
          if (anchorParts === parts) anchorParts = null;
        });
      },
      text(chunk) {
        anchorParts?.push(chunk.text);
      },
    })
    .on('img', {
      element(el) {
        const src =
          attr(el, 'src') ??
          attr(el, 'data-src') ??
          attr(el, 'data-lazy-src') ??
          firstSrcset(attr(el, 'srcset') ?? attr(el, 'data-srcset'));
        if (!src || src.startsWith('data:')) return;
        noteMixed(src);
        const alt = el.hasAttribute('alt') ? attr(el, 'alt') : null;
        if (data.images.length < MAX_IMAGES) {
          data.images.push({
            src,
            alt,
            width: attr(el, 'width'),
            height: attr(el, 'height'),
          } satisfies ExtractedImage);
        }
        pushLink(src, 'img', { alt: alt ?? '' });
        if (currentAnchor && !currentAnchor.alt) currentAnchor.alt = alt ?? '';
      },
    })
    .on('script', {
      element(el) {
        const src = attr(el, 'src');
        if (src) {
          noteMixed(src);
          pushLink(src, 'js');
        }
      },
    })
    .on('script[type*="ld+json"]', {
      element(el) {
        captureText(el, (t) => jsonLd.push(t), jsonLdStack);
      },
      text(chunk) {
        jsonLdStack[jsonLdStack.length - 1]?.parts.push(chunk.text);
      },
    })
    .on('iframe[src]', {
      element(el) {
        const src = attr(el, 'src');
        noteMixed(src);
        pushLink(src, 'iframe');
      },
    })
    .on('form[action]', {
      element(el) {
        if (isHttps && (attr(el, 'action') ?? '').startsWith('http://')) data.insecureForms++;
      },
    })
    .on('h1, h2, h3, h4, h5, h6', {
      element(el) {
        const level = Number(el.tagName.slice(1));
        data.headingOrder.push(level);
        if (level === 1) captureText(el, (t) => data.h1.push(t), headingStack);
        else if (level === 2) captureText(el, (t) => data.h2.push(t), headingStack);
      },
      text(chunk) {
        headingStack[headingStack.length - 1]?.parts.push(chunk.text);
      },
    })
    .on('[itemscope]', {
      element(el) {
        const type = attr(el, 'itemtype');
        if (type)
          for (const t of type.split(/\s+/))
            microdataTypes.add(t.replace(/^https?:\/\/schema\.org\//, ''));
      },
    })
    .on('[typeof]', {
      element(el) {
        const type = attr(el, 'typeof');
        if (type)
          for (const t of type.split(/\s+/))
            rdfaTypes.add(t.replace(/^(?:schema:|https?:\/\/schema\.org\/)/, ''));
      },
    })
    .onDocument({
      text(chunk) {
        if (skipDepth > 0) return;
        bodyText.push(chunk.text);
        if (chunk.lastInTextNode) bodyText.push(' ');
      },
    });

  for (const ex of opts.extractors ?? []) {
    if (ex.kind !== 'css') continue;
    const values: string[] = [];
    data.extractions[ex.name] = values;
    const stack: OpenText[] = [];
    extractorStacks.set(ex.name, stack);
    try {
      rewriter = rewriter.on(ex.selector, {
        element(el) {
          if (values.length >= MAX_EXTRACTION_VALUES) return;
          if (ex.attribute) {
            const v = attr(el, ex.attribute);
            if (v !== null) values.push(v);
          } else {
            captureText(el, (t) => values.push(t), stack);
          }
        },
        text(chunk) {
          stack[stack.length - 1]?.parts.push(chunk.text);
        },
      });
    } catch {
      // HTMLRewriter rejects selectors it does not support; the extractor just yields nothing.
    }
  }

  await rewriter
    .transform(new Response(html, { headers: { 'content-type': 'text/html' } }))
    .arrayBuffer();

  for (const raw of jsonLd) data.structuredData.push(checkJsonLd(raw));
  if (microdataTypes.size) data.structuredData.push(typesBlock('microdata', microdataTypes));
  if (rdfaTypes.size) data.structuredData.push(typesBlock('rdfa', rdfaTypes));

  for (const ex of opts.extractors ?? []) {
    if (ex.kind !== 'regex') continue;
    data.extractions[ex.name] = runRegex(ex.selector, html);
  }

  const text = squash(decodeEntities(bodyText.join('')));
  data.wordCount = text ? (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length : 0;
  data.textBytes = new TextEncoder().encode(text).length;
  data.text = opts.keepText ? text.slice(0, KEEP_TEXT_CHARS) : null;
  data.contentHash = await contentHash(text);
  data.simhash = simhash(text);
  data.templateSignature = minhash(templateFeatures);
  data.mixedContent = [...new Set(data.mixedContent)].slice(0, 50);
  return data;
}

/**
 * `div.card`: the tag and its first class. The first class usually names the component; later
 * ones are often modifiers that carry data (`star-rating Three`, `card--sale`), which would make
 * pages of one template look different.
 */
function elementToken(el: Element): string {
  const first = (el.getAttribute('class') ?? '').trim().toLowerCase().split(/\s+/)[0];
  return first ? `${el.tagName}.${first}` : el.tagName;
}

function typesBlock(format: 'microdata' | 'rdfa', types: Set<string>): StructuredDataBlock {
  return { format, types: [...types], valid: true, errors: [] };
}

function firstSrcset(srcset: string | null): string | null {
  if (!srcset) return null;
  return srcset.split(',')[0]?.trim().split(/\s+/)[0] ?? null;
}

function runRegex(source: string, html: string): string[] {
  let re: RegExp;
  try {
    re = new RegExp(source, 'gi');
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const m of html.matchAll(re)) {
    out.push(squash(decodeEntities(m[1] ?? m[0])));
    if (out.length >= MAX_EXTRACTION_VALUES) break;
  }
  return out;
}

/** Parsed `meta robots` + `X-Robots-Tag` directives for the indexability decision. */
export function robotsDirectives(metaRobots: string[], xRobotsTag: string | null): Set<string> {
  const out = new Set<string>();
  const add = (value: string) => {
    for (const part of value.toLowerCase().split(',')) {
      // `X-Robots-Tag: googlebot: noindex` scopes a directive to one agent; treat it as global.
      const directive = part.includes(':') ? part.split(':').pop()! : part;
      const d = directive.trim();
      if (d) out.add(d);
    }
  };
  for (const m of metaRobots) add(m);
  if (xRobotsTag) add(xRobotsTag);
  if (out.has('none')) {
    out.add('noindex');
    out.add('nofollow');
  }
  return out;
}
