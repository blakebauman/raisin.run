import { createRequestHandler } from 'react-router';
import { handleApi } from '../app/lib/api.server';
import { getAuth } from '../app/lib/auth.server';
import { handleStripeWebhook } from '../app/lib/billing.server';
import { getCrawl } from '../app/lib/crawls.server';
import { engine } from '../app/lib/env.server';
import { failDeadCrawls, purgeExpiredCrawls } from '../app/lib/maintenance.server';
import { runDueSchedules } from '../app/lib/schedules.server';
import { requireMember } from '../app/lib/session.server';

const requestHandler = createRequestHandler(
  () => import('virtual:react-router/server-build'),
  import.meta.env.MODE,
);

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ ok: true, service: 'raisin-web' });
    if (url.pathname.startsWith('/api/auth/')) return getAuth().handler(request);
    if (url.pathname.startsWith('/api/v1/')) return handleApi(request);
    if (url.pathname === '/api/stripe/webhook' && request.method === 'POST') {
      return handleStripeWebhook(request);
    }

    const live = url.pathname.match(/^\/app\/crawls\/([\w-]+)\/live$/);
    if (live && request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      return liveProgress(request, live[1]!);
    }
    return requestHandler(request);
  },

  async scheduled(_controller, _env, ctx) {
    ctx.waitUntil(
      Promise.allSettled([runDueSchedules(), failDeadCrawls(), purgeExpiredCrawls()]).then(
        (results) =>
          console.log(
            'cron',
            JSON.stringify(
              results.map((r) => (r.status === 'fulfilled' ? r.value : String(r.reason))),
            ),
          ),
      ),
    );
  },
} satisfies ExportedHandler<Env>;

/** Authorize, then hand the browser's WebSocket upgrade to the crawl's Durable Object. */
async function liveProgress(request: Request, crawlId: string): Promise<Response> {
  let orgId: string;
  try {
    orgId = (await requireMember(request)).orgId;
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }
  const crawl = await getCrawl(orgId, crawlId);
  if (!crawl) return new Response('Not found', { status: 404 });
  return engine().fetch(new Request(`https://engine/ws/${orgId}/${crawlId}`, request));
}
