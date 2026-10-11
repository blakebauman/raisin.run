import { type IssueSummary, TABS_BY_ID } from '@raisin/core';
import { cn } from '@raisin/ui/lib/utils';
import { Link, useSearchParams } from 'react-router';
import { DateTime, SEVERITY_LABEL, type Severity, SeverityDot } from './common';

const ORDER: Severity[] = ['issue', 'warning', 'opportunity'];
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

/**
 * `default` is open on wide screens and hidden on narrow ones; `open` and `closed` are the
 * viewer's explicit choice. Below `lg` an open panel overlays the grid instead of squeezing it.
 */
export type PanelState = 'default' | 'open' | 'closed';

/** Every audit with a non-zero count, grouped by severity, highest priority first. */
export function IssuesPanel({
  id,
  summary,
  state = 'default',
}: {
  id?: string;
  summary: IssueSummary;
  state?: PanelState;
}) {
  const [params] = useSearchParams();
  const active = params.get('filter');
  return (
    <aside
      id={id}
      aria-label="Audit results"
      className={cn(
        'w-80 shrink-0 flex-col border-l bg-card max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 max-lg:shadow-lg',
        state === 'open' ? 'flex' : state === 'closed' ? 'hidden' : 'hidden lg:flex',
      )}
    >
      <div className="grid grid-cols-3 gap-2 border-b px-3 py-3">
        {ORDER.map((s) => (
          <div key={s} className="min-w-0">
            <p
              className="flex items-center gap-1.5 truncate text-xs text-muted-foreground"
              title={SEVERITY_LABEL[s]}
            >
              <SeverityDot severity={s} />
              {SEVERITY_LABEL[s]}
            </p>
            <p className="tabular mt-0.5 text-lg font-semibold">
              {summary.totals[s].toLocaleString()}
            </p>
          </div>
        ))}
      </div>
      {summary.baseline && (
        <p className="border-b px-4 py-2 text-xs text-muted-foreground">
          Compared with the crawl of <DateTime value={summary.baseline.createdAt} />. +n is newly
          flagged.
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto py-2">
        {ORDER.map((severity) => {
          const rules = summary.rules
            .filter((r) => r.severity === severity && r.count > 0)
            .sort(
              (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.count - a.count,
            );
          if (!rules.length) return null;
          return (
            <section key={severity} className="mb-2" aria-labelledby={`issues-${severity}`}>
              <h2
                id={`issues-${severity}`}
                className="px-4 py-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase"
              >
                {SEVERITY_LABEL[severity]}
              </h2>
              <ul>
                {rules.map((r) => {
                  const urls = `${r.count.toLocaleString()} URL${r.count === 1 ? '' : 's'}`;
                  return (
                    <li key={r.id}>
                      <Link
                        to={`?tab=${r.tab}&filter=${r.id}`}
                        aria-current={active === r.id ? 'true' : undefined}
                        className={cn(
                          'flex items-baseline gap-2 px-4 py-1.5 text-sm hover:bg-row-hover',
                          active === r.id && 'bg-accent text-accent-foreground hover:bg-accent',
                        )}
                      >
                        <SeverityDot severity={r.severity} className="translate-y-[-1px]" />
                        <span className="min-w-0 flex-1 leading-snug">
                          <span className="text-muted-foreground">
                            {TABS_BY_ID.get(r.tab as never)?.label}:{' '}
                          </span>
                          {r.label}
                          {r.priority === 'high' && (
                            <span className="ml-1.5 text-xs font-medium whitespace-nowrap text-issue">
                              High priority
                            </span>
                          )}
                        </span>
                        {summary.baseline && r.new > 0 && (
                          <span
                            className="tabular text-xs font-medium"
                            title={`${r.new.toLocaleString()} newly flagged since the previous crawl`}
                          >
                            +{r.new.toLocaleString()}
                            <span className="sr-only"> new,</span>
                          </span>
                        )}
                        <span className="tabular text-right text-muted-foreground" title={urls}>
                          <span aria-hidden>{r.count.toLocaleString()}</span>
                          <span className="sr-only">{urls}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {summary.totals.issue + summary.totals.warning + summary.totals.opportunity === 0 && (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            Issues appear here as pages are crawled.
          </p>
        )}
      </div>
    </aside>
  );
}
