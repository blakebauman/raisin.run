import { getCrawl } from './crawls.server';
import { requireMember } from './session.server';

/** The member and crawl for a crawl-scoped request; 404s if the crawl isn't in their org. */
export async function requireCrawl(request: Request, crawlId: string) {
  const m = await requireMember(request);
  const crawl = await getCrawl(m.orgId, crawlId);
  if (!crawl) throw new Response('Not found', { status: 404 });
  return { m, crawl };
}
