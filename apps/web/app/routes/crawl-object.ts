import { requireCrawl } from '~/lib/crawl-access.server';
import { engine } from '~/lib/env.server';
import type { Route } from './+types/crawl-object';

/** Stored HTML, screenshots and the finished export, proxied from R2 after an access check. */
export async function loader({ request, params }: Route.LoaderArgs) {
  const { m, crawl } = await requireCrawl(request, params.crawlId);
  const key = new URL(request.url).searchParams.get('key') ?? '';
  const res = await engine().object(m.orgId, crawl.id, key);
  const headers = new Headers(res.headers);
  // Stored pages are third-party HTML: never let them run in our origin.
  headers.set(
    'content-security-policy',
    "sandbox; default-src 'none'; img-src * data:; style-src * 'unsafe-inline'",
  );
  headers.set('x-content-type-options', 'nosniff');
  if (key.endsWith('.html')) headers.set('content-type', 'text/plain; charset=utf-8');
  return new Response(res.body, { status: res.status, headers });
}
