/**
 * Fetch one URL and turn it into a FetchResult: robots check, per-host pacing, a manual-redirect
 * request (each hop is its own URL, so chains and loops show up in the data), header capture,
 * and HTML extraction. This function never throws — every failure becomes a result row, so no
 * URL silently disappears from a crawl.
 */

import {
  checkTarget,
  extractPage,
  type FetchResult,
  type FetchTask,
  isAllowed,
  isHtmlContentType,
} from '@raisin/core';
import { getRobots } from './robots-cache';

const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_RESOURCE_BYTES = 20 * 1024 * 1024;
const MAX_HEADER_VALUE = 2_000;
/** Longer than this and the message goes back on the queue instead of sleeping. */
const MAX_INLINE_WAIT_MS = 20_000;

export class RetryLater extends Error {
  constructor(readonly delaySeconds: number) {
    super(`retry in ${delaySeconds}s`);
  }
}

export async function fetchTask(task: FetchTask, env: Env): Promise<FetchResult> {
  const base: FetchResult = {
    urlId: task.urlId,
    url: task.url,
    mode: task.mode,
    depth: task.depth,
    status: 0,
    statusText: '',
    error: null,
    blockedByRobots: false,
    contentType: null,
    size: 0,
    responseMs: 0,
    headers: {},
    redirectTarget: null,
    page: null,
    render: null,
    htmlKey: null,
    fetchedAt: Date.now(),
  };

  const target = checkTarget(task.url);
  if (!target.ok) return { ...base, error: target.reason };

  const url = new URL(task.url);
  let crawlDelay: number | null = null;
  if (task.opts.respectRobots && task.mode !== 'external') {
    const { robots } = await getRobots(env, url.origin, task.opts.userAgent);
    const verdict = isAllowed(robots, task.url, task.opts.userAgent);
    if (!verdict.allowed) {
      return {
        ...base,
        blockedByRobots: true,
        statusText: verdict.rule ?? 'Blocked by robots.txt',
      };
    }
    crawlDelay = verdict.crawlDelay;
  }

  const limiter = env.HOST_LIMITER.getByName(url.hostname);
  const minInterval = Math.max(Number(env.HOST_MIN_INTERVAL_MS) || 0, (crawlDelay ?? 0) * 1000);
  const wait = await limiter.acquire(minInterval);
  if (wait > MAX_INLINE_WAIT_MS) throw new RetryLater(Math.ceil(wait / 1000));
  if (wait > 0) await sleep(wait);

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(task.url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(task.opts.timeoutMs),
      headers: {
        'user-agent': task.opts.userAgent,
        accept:
          task.mode === 'page'
            ? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            : '*/*',
        'accept-language': 'en;q=0.9,*;q=0.5',
        ...task.opts.headers,
      },
      cache: 'no-store',
    });
  } catch (e) {
    return {
      ...base,
      error: describeError(e),
      responseMs: Date.now() - started,
      fetchedAt: Date.now(),
    };
  }

  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key] = value.slice(0, MAX_HEADER_VALUE);
  });
  const contentType = res.headers.get('content-type');
  const result: FetchResult = {
    ...base,
    status: res.status,
    statusText: res.statusText,
    contentType,
    headers,
    redirectTarget: res.status >= 300 && res.status < 400 ? res.headers.get('location') : null,
    fetchedAt: Date.now(),
  };

  if (res.status === 429 || res.status === 503) {
    const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
    await limiter.penalize((retryAfter ?? 30) * 1000);
  }

  try {
    if (task.mode === 'page' && res.status === 200 && isHtmlContentType(contentType)) {
      const bytes = await readCapped(res, MAX_HTML_BYTES);
      result.size = bytes.byteLength;
      result.responseMs = Date.now() - started;
      const html = decode(bytes, contentType);
      result.page = await extractPage(html, task.url, {
        keepText: task.opts.keepText,
        extractors: task.opts.extractors,
      });
      if (task.opts.storeHtml) {
        result.htmlKey = htmlKey(task);
        await env.BUCKET.put(result.htmlKey, html, {
          httpMetadata: { contentType: 'text/html; charset=utf-8' },
        });
      }
    } else if (task.mode === 'external' || res.status >= 300) {
      // Status is all an external check or a redirect needs. Use Content-Length when given.
      result.size = Number(res.headers.get('content-length')) || 0;
      result.responseMs = Date.now() - started;
      await res.body?.cancel();
    } else {
      const declared = Number(res.headers.get('content-length'));
      if (declared > 0) {
        result.size = declared;
        await res.body?.cancel();
      } else {
        result.size = (await readCapped(res, MAX_RESOURCE_BYTES)).byteLength;
      }
      result.responseMs = Date.now() - started;
    }
  } catch (e) {
    result.error = `Body read failed: ${describeError(e)}`;
    result.responseMs = Date.now() - started;
  }
  return result;
}

export function htmlKey(
  task: Pick<FetchTask, 'crawlId' | 'urlId'>,
  kind: 'raw' | 'rendered' = 'raw',
): string {
  return `crawls/${task.crawlId}/${kind}/${task.urlId}.html`;
}

async function readCapped(res: Response, cap: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      chunks.push(value.subarray(0, value.byteLength - (total - cap)));
      total = cap;
      break;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function decode(bytes: Uint8Array, contentType: string | null): string {
  const declared = contentType?.match(/charset=["']?([\w-]+)/i)?.[1];
  const sniffed = declared ?? sniffCharset(bytes);
  try {
    return new TextDecoder(sniffed ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** `<meta charset>` in the first 1 KB, which is where the HTML spec says to look. */
function sniffCharset(bytes: Uint8Array): string | null {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ?? null;
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, Math.round((at - Date.now()) / 1000));
}

function describeError(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') return 'Timeout';
    return e.message.slice(0, 300) || e.name;
  }
  return String(e).slice(0, 300);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
