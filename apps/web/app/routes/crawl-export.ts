import { csvRow, parseIssueChange, TABS_BY_ID } from '@raisin/core';
import { requireCrawl } from '~/lib/crawl-access.server';
import { engine } from '~/lib/env.server';
import type { Route } from './+types/crawl-export';

const PAGE = 1000;

/** Stream any tab/filter/search view as CSV, paging rows out of the crawl's Durable Object. */
export async function loader({ request, params }: Route.LoaderArgs) {
  const { m, crawl } = await requireCrawl(request, params.crawlId);
  const url = new URL(request.url);
  const tab = url.searchParams.get('tab') ?? 'internal';
  if (!TABS_BY_ID.has(tab as never)) throw new Response('Unknown tab', { status: 400 });
  const query = {
    tab,
    filter: url.searchParams.get('filter') || null,
    change: parseIssueChange(url.searchParams.get('change')),
    search: url.searchParams.get('q') || null,
    pageType: Number.isSafeInteger(Number(url.searchParams.get('type')))
      ? Number(url.searchParams.get('type')) || null
      : null,
    sort: url.searchParams.get('sort') || null,
    dir: url.searchParams.get('dir') === 'desc' ? ('desc' as const) : ('asc' as const),
  };
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (let offset = 0; ; offset += PAGE) {
          const page = await engine().grid(m.orgId, crawl.id, { ...query, offset, limit: PAGE });
          if (offset === 0)
            controller.enqueue(encoder.encode(csvRow(page.columns.map((c) => c.label))));
          for (const row of page.rows)
            controller.enqueue(encoder.encode(csvRow(page.columns.map((c) => row[c.key]))));
          if (page.rows.length < PAGE) break;
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });
  const view = [query.filter ?? tab, query.change, query.pageType && `type-${query.pageType}`]
    .filter(Boolean)
    .join('-');
  const name = `${new URL(crawl.startUrl).hostname}-${view}-${crawl.id}.csv`.replace(
    /[^\w.-]+/g,
    '-',
  );
  return new Response(stream, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'no-store',
    },
  });
}
