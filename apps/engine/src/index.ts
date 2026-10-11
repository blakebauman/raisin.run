/**
 * raisin-engine. No public routes: the web app reaches it through a service binding, either as
 * RPC (`EngineApi`) or plain fetch for the health check.
 */

import type { FetchTask } from '@raisin/core';
import { consume } from './consumers';

export { EngineApi } from './api';
export { CrawlDO } from './crawl-do';
export { HostLimiter } from './host-limiter';
export { CrawlLifecycle } from './lifecycle';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ ok: true, service: 'raisin-engine' });
    return new Response('Not found', { status: 404 });
  },

  async queue(batch, env) {
    await consume(batch, env);
  },
} satisfies ExportedHandler<Env, FetchTask>;
