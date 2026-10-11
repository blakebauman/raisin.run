import { data } from 'react-router';
import { requireCrawl } from '~/lib/crawl-access.server';
import { engine } from '~/lib/env.server';
import { getPlan, getUsage, recordAiCall } from '~/lib/plans.server';
import type { Route } from './+types/crawl-suggest';

/** AI alt text or title/description suggestions, metered against the plan's monthly AI calls. */
export async function action({ request, params }: Route.ActionArgs) {
  const { m, crawl } = await requireCrawl(request, params.crawlId);
  const [plan, used] = await Promise.all([getPlan(m.orgId), getUsage(m.orgId)]);
  if (!plan.ai)
    return data(
      { error: `AI suggestions are not included in the ${plan.name} plan.` },
      { status: 403 },
    );
  if (used.aiCalls >= plan.monthlyAiCalls)
    return data({ error: "This month's AI allowance is used up." }, { status: 429 });

  const form = await request.formData();
  const kind = form.get('kind') === 'alt' ? 'alt' : 'meta';
  const urlId = Number(form.get('urlId'));
  const imageUrl = form.get('imageUrl') ? String(form.get('imageUrl')) : undefined;
  try {
    const out = await engine().suggest(m.orgId, crawl.id, urlId, kind, imageUrl);
    await recordAiCall(m.orgId);
    return data({ kind, imageUrl: imageUrl ?? null, text: out.text });
  } catch (e) {
    return data({ error: e instanceof Error ? e.message : 'Suggestion failed' }, { status: 502 });
  }
}
