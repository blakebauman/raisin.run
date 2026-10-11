/**
 * The crawl configuration form's wire format: what the form posts and how it maps onto
 * `ConfigOverrides`. Shared by the form component (defaults) and the action (parsing).
 */

import type { CrawlConfig, CustomExtractor } from '@raisin/core';
import { DEFAULT_USER_AGENT } from '@raisin/core';
import type { ConfigOverrides } from './crawls.server';

export const USER_AGENTS = {
  raisin: { label: 'RaisinBot', value: DEFAULT_USER_AGENT },
  googlebotSmartphone: {
    label: 'Googlebot (smartphone)',
    value:
      'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  },
  googlebotDesktop: {
    label: 'Googlebot (desktop)',
    value: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  },
  chrome: {
    label: 'Chrome (desktop)',
    value:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  },
} as const;

export const TOGGLES: { key: keyof CrawlConfig; label: string; hint?: string }[] = [
  {
    key: 'respectRobots',
    label: 'Respect robots.txt',
    hint: 'Turning this off requires a verified domain.',
  },
  {
    key: 'respectNofollow',
    label: 'Respect nofollow',
    hint: 'Do not follow links marked rel="nofollow".',
  },
  { key: 'respectCanonical', label: 'Crawl canonicals' },
  { key: 'crawlSitemaps', label: 'Crawl URLs in XML sitemaps' },
  { key: 'followHreflang', label: 'Crawl hreflang URLs' },
  { key: 'followPagination', label: 'Crawl rel="next"/"prev"' },
  { key: 'crawlSubdomains', label: 'Crawl all subdomains' },
  { key: 'checkExternalLinks', label: 'Check external links' },
  { key: 'crawlImages', label: 'Check images' },
  { key: 'crawlCss', label: 'Check CSS files' },
  { key: 'crawlJs', label: 'Check JavaScript files' },
  {
    key: 'storeHtml',
    label: 'Store HTML',
    hint: 'Keep raw (and rendered) HTML for the source viewer.',
  },
];

const lines = (value: FormDataEntryValue | null) =>
  String(value ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

export function parseConfigForm(form: FormData) {
  const num = (name: string, fallback: number) => {
    const n = Number(form.get(name));
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const uaKey = String(form.get('userAgentPreset') ?? 'raisin');
  const userAgent =
    uaKey === 'custom'
      ? String(form.get('userAgent') ?? '').trim() || DEFAULT_USER_AGENT
      : (USER_AGENTS[uaKey as keyof typeof USER_AGENTS]?.value ?? DEFAULT_USER_AGENT);

  const toggles = Object.fromEntries(TOGGLES.map((t) => [t.key, form.get(t.key) === 'on']));
  const headers: Record<string, string> = {};
  for (const line of lines(form.get('customHeaders')).slice(0, 20)) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  const extractors: CustomExtractor[] = [];
  for (const line of lines(form.get('extractors')).slice(0, 10)) {
    const [name, kind, selector, attribute] = line.split('|').map((p) => p.trim());
    if (name && selector && (kind === 'css' || kind === 'regex')) {
      extractors.push({ name, kind, selector, ...(attribute ? { attribute } : {}) });
    }
  }
  const validRegex = (p: string) => {
    try {
      new RegExp(p);
      return true;
    } catch {
      return false;
    }
  };

  return {
    maxUrls: Math.floor(num('maxUrls', 500)),
    maxDepth: Math.floor(num('maxDepth', 20)),
    maxUrlsPerSecond: num('maxUrlsPerSecond', 2),
    userAgent,
    customHeaders: headers,
    ...toggles,
    include: lines(form.get('include')).filter(validRegex),
    exclude: lines(form.get('exclude')).filter(validRegex),
    extractors,
    render: {
      enabled: form.get('renderEnabled') === 'on',
      waitUntil:
        (['load', 'domcontentloaded', 'networkidle0', 'networkidle2'] as const).find(
          (w) => w === form.get('waitUntil'),
        ) ?? 'networkidle0',
      screenshots: form.get('screenshots') === 'on',
    },
    ai: { nearDuplicates: form.get('aiSimilarity') === 'on' },
  };
}

export function presetFor(userAgent: string): string {
  const hit = Object.entries(USER_AGENTS).find(([, v]) => v.value === userAgent);
  return hit ? hit[0] : 'custom';
}

const BOOLEAN_KEYS = [
  'respectRobots',
  'respectNofollow',
  'respectCanonical',
  'crawlSubdomains',
  'checkExternalLinks',
  'crawlImages',
  'crawlCss',
  'crawlJs',
  'crawlSitemaps',
  'followHreflang',
  'followPagination',
  'storeHtml',
] as const;
const WAIT_UNTIL = ['load', 'domcontentloaded', 'networkidle0', 'networkidle2'] as const;

/**
 * Keep only the keys a user may set, with the right types. Config reaches us from the REST API as
 * arbitrary JSON, so anything else (requestTimeoutMs, maxInFlight, NaN numbers, bad regexes) is
 * dropped here rather than trusted downstream.
 */
export function sanitizeOverrides(raw: unknown): ConfigOverrides {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: ConfigOverrides = {};
  const num = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
  const strings = (v: unknown, max: number) =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string' && x.length <= 500).slice(0, max)
      : undefined;
  const validRegex = (p: string) => {
    try {
      new RegExp(p);
      return true;
    } catch {
      return false;
    }
  };

  if (num(r.maxUrls)) out.maxUrls = Math.floor(num(r.maxUrls)!);
  if (typeof r.maxDepth === 'number' && Number.isFinite(r.maxDepth) && r.maxDepth >= 0) {
    out.maxDepth = Math.floor(r.maxDepth);
  }
  if (num(r.maxUrlsPerSecond)) out.maxUrlsPerSecond = num(r.maxUrlsPerSecond);
  if (typeof r.userAgent === 'string' && r.userAgent.trim() && r.userAgent.length <= 500) {
    out.userAgent = r.userAgent.trim();
  }
  for (const key of BOOLEAN_KEYS) if (typeof r[key] === 'boolean') out[key] = r[key] as boolean;
  const include = strings(r.include, 20)?.filter(validRegex);
  if (include) out.include = include;
  const exclude = strings(r.exclude, 20)?.filter(validRegex);
  if (exclude) out.exclude = exclude;

  if (r.customHeaders && typeof r.customHeaders === 'object' && !Array.isArray(r.customHeaders)) {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.customHeaders as Record<string, unknown>).slice(0, 20)) {
      if (/^[a-z0-9-]{1,64}$/i.test(k) && typeof v === 'string' && v.length <= 2000)
        headers[k.toLowerCase()] = v;
    }
    out.customHeaders = headers;
  }
  if (Array.isArray(r.extractors)) {
    out.extractors = r.extractors
      .filter(
        (e): e is { name: string; kind: 'css' | 'regex'; selector: string; attribute?: unknown } =>
          !!e &&
          typeof e === 'object' &&
          typeof (e as { name?: unknown }).name === 'string' &&
          typeof (e as { selector?: unknown }).selector === 'string' &&
          ((e as { kind?: unknown }).kind === 'css' || (e as { kind?: unknown }).kind === 'regex'),
      )
      .filter((e) => e.kind === 'css' || validRegex(e.selector))
      .slice(0, 10)
      .map((e) => ({
        name: e.name.slice(0, 64),
        kind: e.kind,
        selector: e.selector.slice(0, 500),
        ...(typeof e.attribute === 'string' && e.attribute
          ? { attribute: e.attribute.slice(0, 64) }
          : {}),
      }));
  }
  if (r.render && typeof r.render === 'object') {
    const v = r.render as Record<string, unknown>;
    out.render = {
      ...(typeof v.enabled === 'boolean' ? { enabled: v.enabled } : {}),
      ...(typeof v.screenshots === 'boolean' ? { screenshots: v.screenshots } : {}),
      ...(WAIT_UNTIL.includes(v.waitUntil as never)
        ? { waitUntil: v.waitUntil as (typeof WAIT_UNTIL)[number] }
        : {}),
      ...(num(v.timeoutMs) ? { timeoutMs: num(v.timeoutMs) } : {}),
    };
  }
  if (
    r.ai &&
    typeof r.ai === 'object' &&
    typeof (r.ai as { nearDuplicates?: unknown }).nearDuplicates === 'boolean'
  ) {
    out.ai = { nearDuplicates: (r.ai as { nearDuplicates: boolean }).nearDuplicates };
  }
  return out;
}
