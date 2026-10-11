/**
 * JavaScript rendering with Browser Run. A page is fetched raw first (status, headers, raw HTML
 * — what a non-rendering crawler sees), then loaded in Chrome, and the rendered DOM goes through
 * the same extractor. The pages row records both, so the audits can diff them.
 *
 * Browsers are shared: each render connects to a running session if one has room and opens an
 * isolated browser context, launching a new browser only when none can take another context.
 * Contexts don't count against Browser Run's concurrent-browser limit; browsers do.
 */

import puppeteer, { type Browser } from '@cloudflare/puppeteer';
import { extractPage, type FetchResult, type FetchTask, type RenderData } from '@raisin/core';
import { fetchTask, htmlKey } from './fetcher';

const MAX_CONTEXTS_PER_BROWSER = 4;

const VITALS_SCRIPT = `
  window.__raisin = { lcp: null, cls: 0 };
  try {
    new PerformanceObserver((list) => {
      const last = list.getEntries().at(-1);
      if (last) window.__raisin.lcp = last.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__raisin.cls += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {}
`;
const KEEP_ALIVE_MS = 120_000;

export async function renderTask(task: FetchTask, env: Env): Promise<FetchResult> {
  const raw = await fetchTask(task, env);
  const render = task.opts.render;
  if (!render || !raw.page || raw.status !== 200) return raw;

  try {
    raw.render = await renderPage(task, env, render);
  } catch (e) {
    // A render failure keeps the raw result; the JavaScript tab shows it as "not rendered".
    raw.headers['x-raisin-render-error'] = e instanceof Error ? e.message.slice(0, 300) : String(e);
  }
  return raw;
}

async function renderPage(
  task: FetchTask,
  env: Env,
  render: NonNullable<FetchTask['opts']['render']>,
): Promise<RenderData> {
  const browser = await acquireBrowser(env);
  const context = await browser.createBrowserContext();
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  try {
    const page = await context.newPage();
    await page.setUserAgent(task.opts.userAgent);
    // setExtraHTTPHeaders would send the crawl's custom headers (often credentials) to every
    // third-party script and CDN the page loads. Add them only to requests for the page's own host.
    const custom = task.opts.headers;
    if (Object.keys(custom).length) {
      const ownHost = bareHost(new URL(task.url).hostname);
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (req.isInterceptResolutionHandled()) return;
        let sameSite = false;
        try {
          sameSite = bareHost(new URL(req.url()).hostname) === ownHost;
        } catch {
          // data:, blob: and other non-URL requests get no custom headers.
        }
        void req.continue(sameSite ? { headers: { ...req.headers(), ...custom } } : undefined);
      });
    }
    await page.setViewport({ width: 1366, height: 900 });
    page.on('console', (msg) => {
      if (msg.type() === 'error' && consoleErrors.length < 50)
        consoleErrors.push(msg.text().slice(0, 500));
    });
    page.on('pageerror', (err) => {
      if (consoleErrors.length < 50) consoleErrors.push(String(err).slice(0, 500));
    });
    page.on('requestfailed', (req) => {
      if (failedRequests.length < 50) failedRequests.push(req.url().slice(0, 500));
    });
    // Record LCP and CLS from the first paint on. Runs in the page, so it is plain JS source.
    await page.evaluateOnNewDocument(VITALS_SCRIPT);

    await page.goto(task.url, { waitUntil: render.waitUntil, timeout: render.timeoutMs });
    const html = await page.content();
    const vitals = (await page.evaluate('window.__raisin ?? null')) as {
      lcp: number | null;
      cls: number;
    } | null;

    let screenshotKey: string | null = null;
    if (render.screenshots) {
      const shot = await page.screenshot({ type: 'webp', quality: 70, fullPage: false });
      screenshotKey = `crawls/${task.crawlId}/screenshots/${task.urlId}.webp`;
      await env.BUCKET.put(screenshotKey, shot, { httpMetadata: { contentType: 'image/webp' } });
    }
    if (task.opts.storeHtml) {
      await env.BUCKET.put(htmlKey(task, 'rendered'), html, {
        httpMetadata: { contentType: 'text/html; charset=utf-8' },
      });
    }

    return {
      page: await extractPage(html, task.url, {
        keepText: task.opts.keepText,
        extractors: task.opts.extractors,
      }),
      consoleErrors,
      failedRequests,
      lcpMs: vitals?.lcp != null ? Math.round(vitals.lcp) : null,
      cls: vitals ? Math.round(vitals.cls * 1000) / 1000 : null,
      screenshotKey,
    };
  } finally {
    await context.close().catch(() => {});
    // Never close a shared browser: other renders may be using it.
    await browser.disconnect().catch(() => {});
  }
}

async function acquireBrowser(env: Env): Promise<Browser> {
  const sessions = await puppeteer.sessions(env.BROWSER).catch(() => []);
  // Start at a random session so concurrent consumers spread across browsers.
  const start = Math.floor(Math.random() * Math.max(sessions.length, 1));
  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[(start + i) % sessions.length]!;
    try {
      const browser = await puppeteer.connect(env.BROWSER, session.sessionId);
      if (await hasCapacity(browser)) return browser;
      await browser.disconnect();
    } catch {
      // The session closed or is full; try the next one.
    }
  }
  return puppeteer.launch(env.BROWSER, { keep_alive: KEEP_ALIVE_MS });
}

async function hasCapacity(browser: Browser): Promise<boolean> {
  const client = await browser.target().createCDPSession();
  try {
    const { browserContextIds } = await client.send('Target.getBrowserContexts');
    return browserContextIds.length < MAX_CONTEXTS_PER_BROWSER;
  } finally {
    await client.detach();
  }
}

function bareHost(host: string): string {
  return host.replace(/^www\./, '');
}
