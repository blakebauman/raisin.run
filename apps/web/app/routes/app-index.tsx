import { crawls, projects } from '@raisin/db';
import { Button } from '@raisin/ui/button';
import { Card } from '@raisin/ui/card';
import { cn } from '@raisin/ui/lib/utils';
import { desc, eq } from 'drizzle-orm';
import { ArrowDown, ArrowUp, BadgeCheck, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { DateTime, EmptyState, StatusPill } from '~/components/common';
import { db } from '~/lib/env.server';
import { requireMember } from '~/lib/session.server';
import type { Route } from './+types/app-index';

export function meta(): Route.MetaDescriptors {
  return [{ title: 'Projects — Raisin' }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const m = await requireMember(request);
  const database = db();
  const [projectRows, recent] = await Promise.all([
    database
      .select()
      .from(projects)
      .where(eq(projects.organizationId, m.orgId))
      .orderBy(desc(projects.createdAt)),
    database
      .select({
        id: crawls.id,
        projectId: crawls.projectId,
        status: crawls.status,
        createdAt: crawls.createdAt,
        urlsCrawled: crawls.urlsCrawled,
        summaryJson: crawls.summaryJson,
      })
      .from(crawls)
      .where(eq(crawls.organizationId, m.orgId))
      .orderBy(desc(crawls.createdAt))
      .limit(200),
  ]);
  const latest = new Map<string, (typeof recent)[number]>();
  // The two most recent crawls with a summary, to show how the issue count moved.
  const summarised = new Map<string, { id: string; summary: Summary }[]>();
  for (const c of recent) {
    if (!latest.has(c.projectId)) latest.set(c.projectId, c);
    const summary = parseSummary(c.summaryJson);
    const list = summarised.get(c.projectId) ?? [];
    if (summary && list.length < 2) summarised.set(c.projectId, [...list, { id: c.id, summary }]);
  }
  return {
    projects: projectRows.map((p) => {
      const c = latest.get(p.id);
      const summary = parseSummary(c?.summaryJson);
      const [last, previous] = summarised.get(p.id) ?? [];
      return {
        id: p.id,
        name: p.name,
        host: p.host,
        verified: p.verifiedAt !== null,
        latest: c
          ? {
              id: c.id,
              status: c.status,
              createdAt: c.createdAt,
              urlsCrawled: c.urlsCrawled,
              issues: summary?.issue ?? null,
              warnings: summary?.warning ?? null,
              // Only compare when the latest crawl is the one that was summarised.
              issueChange:
                last?.id === c.id && previous ? last.summary.issue - previous.summary.issue : null,
            }
          : null,
      };
    }),
  };
}

type Summary = { issue: number; warning: number };

function parseSummary(json: string | null | undefined): Summary | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as Summary;
  } catch {
    return null;
  }
}

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

export default function AppIndex({ loaderData }: Route.ComponentProps) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Projects</h1>
        <Button asChild>
          <Link to="/app/projects/new">
            <Plus />
            New project
          </Link>
        </Button>
      </div>
      <Card className="mt-6 gap-0 py-0">
        {loaderData.projects.length === 0 ? (
          <EmptyState title="No projects yet">
            A project is one website. Add one to run your first crawl.
          </EmptyState>
        ) : (
          <ul className="divide-y">
            {loaderData.projects.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/app/projects/${p.id}`}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-accent/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 font-medium">
                      {p.name}
                      {p.verified && (
                        <BadgeCheck className="size-4 text-primary" aria-label="Verified" />
                      )}
                    </p>
                    <p className="truncate font-mono text-xs text-muted-foreground">{p.host}</p>
                  </div>
                  {p.latest ? (
                    <div className="flex items-center gap-4 text-sm">
                      {p.latest.issues !== null && (
                        <span className="tabular text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {plural(p.latest.issues, 'issue', 'issues')}
                          </span>
                          {p.latest.issueChange !== null && p.latest.issueChange !== 0 && (
                            <IssueChange change={p.latest.issueChange} />
                          )}
                        </span>
                      )}
                      {p.latest.warnings !== null && (
                        <span className="tabular text-muted-foreground max-lg:hidden">
                          {plural(p.latest.warnings, 'warning', 'warnings')}
                        </span>
                      )}
                      <span className="tabular text-muted-foreground max-md:hidden">
                        {plural(p.latest.urlsCrawled, 'URL', 'URLs')}
                      </span>
                      <StatusPill status={p.latest.status} />
                      <span className="w-36 text-right text-xs text-muted-foreground max-md:hidden">
                        <DateTime value={p.latest.createdAt} />
                      </span>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">Not crawled yet</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** How the issue count moved since the previous crawl. Fewer is better, so down reads as good. */
function IssueChange({ change }: { change: number }) {
  const Icon = change > 0 ? ArrowUp : ArrowDown;
  const n = Math.abs(change).toLocaleString();
  return (
    <span
      className={cn(
        'ml-1.5 inline-flex items-center gap-0.5 text-xs',
        change > 0 ? 'text-issue' : 'text-status-ok',
      )}
      title={`${n} ${change > 0 ? 'more' : 'fewer'} than the previous crawl`}
    >
      <Icon className="size-3" aria-hidden />
      {n}
      <span className="sr-only"> {change > 0 ? 'more' : 'fewer'} than the previous crawl</span>
    </span>
  );
}
