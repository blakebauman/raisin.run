import { requireCrawl } from '~/lib/crawl-access.server';
import { engine } from '~/lib/env.server';
import type { Route } from './+types/crawl-url';

/** URL detail for the bottom pane, fetched client-side when a row is selected. */
export async function loader({ request, params }: Route.LoaderArgs) {
  const { m, crawl } = await requireCrawl(request, params.crawlId);
  const detail = await engine().urlDetail(m.orgId, crawl.id, Number(params.urlId));
  if (!detail) throw new Response('Not found', { status: 404 });
  return detail;
}
