import { Link } from 'react-router';
import { EmptyState, type Severity, SeverityDot } from './common';

type Issue = { id: string; label: string; tab: string; severity: Severity; n: number };

export type PageTypeView = {
  id: number;
  label: string;
  patterns: string[];
  pageCount: number;
  indexableCount: number;
  sample: { id: number; url: string };
  /** Issues on this type's pages, minus the site-wide ones. */
  issues: Issue[];
};

const SHOWN_PATTERNS = 3;
const SHOWN_ISSUES = 3;

/** The crawl's inventory grouped by template: one row per page type. */
export function PageTypes({
  types,
  sitewide,
  analysed,
}: {
  types: PageTypeView[];
  sitewide: Issue[];
  analysed: boolean;
}) {
  if (types.length === 0) {
    return analysed ? (
      <EmptyState title="No page types for this crawl">
        Page types group the internal HTML pages that returned 200. This crawl has none, or it ran
        before page types were added. Crawl again to group its pages.
      </EmptyState>
    ) : (
      <EmptyState title="Page types appear when the crawl finishes">
        Raisin groups pages by URL pattern and template once every page has been crawled.
      </EmptyState>
    );
  }
  const total = types.reduce((n, t) => n + t.pageCount, 0);
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <p className="border-b px-6 py-3 text-sm text-muted-foreground">
        <span className="tabular">{total.toLocaleString()}</span> pages in{' '}
        <span className="tabular">{types.length.toLocaleString()}</span>{' '}
        {types.length === 1 ? 'type' : 'types'}, grouped by URL pattern and page template. Issues
        shared by most pages of a type usually need one template fix.
      </p>
      {sitewide.length > 0 && <Sitewide issues={sitewide} />}
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="px-6 py-2 font-medium">Page type</th>
            <th className="px-3 py-2 text-right font-medium">Pages</th>
            <th className="px-3 py-2 text-right font-medium">Indexable</th>
            <th className="px-3 py-2 font-medium">Most common issues</th>
            <th className="px-6 py-2 font-medium">Example</th>
          </tr>
        </thead>
        <tbody>
          {types.map((t) => (
            <tr key={t.id} className="border-b align-top hover:bg-row-hover">
              <td className="max-w-md px-6 py-2.5">
                <Link
                  to={`?tab=internal&type=${t.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {t.label}
                </Link>
                {t.patterns.length > 1 && <PatternList patterns={t.patterns} />}
              </td>
              <td className="px-3 py-2.5 text-right tabular">{t.pageCount.toLocaleString()}</td>
              <td className="px-3 py-2.5 text-right tabular text-muted-foreground">
                {t.indexableCount.toLocaleString()}
              </td>
              <td className="px-3 py-2.5">
                <IssueList type={t} />
              </td>
              <td className="max-w-xs px-6 py-2.5">
                <Link
                  to={`?tab=internal&type=${t.id}&url=${t.sample.id}`}
                  className="block truncate font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
                  title={t.sample.url}
                >
                  {new URL(t.sample.url).pathname}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Issues on nearly every page of every type: one site-wide fix each, listed once. */
function Sitewide({ issues }: { issues: Issue[] }) {
  return (
    <section aria-labelledby="sitewide-issues" className="border-b px-6 py-3 text-sm">
      <h2 id="sitewide-issues" className="text-xs font-medium text-muted-foreground">
        On every page type
      </h2>
      <ul className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
        {issues.map((i) => (
          <li key={i.id}>
            <Link
              to={`?tab=${i.tab}&filter=${i.id}`}
              className="inline-flex items-baseline gap-1.5 hover:underline"
            >
              <SeverityDot severity={i.severity} className="translate-y-[-1px]" />
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PatternList({ patterns }: { patterns: string[] }) {
  const more = patterns.length - SHOWN_PATTERNS;
  return (
    <ul className="mt-0.5 font-mono text-xs text-muted-foreground">
      {patterns.slice(0, SHOWN_PATTERNS).map((p) => (
        <li key={p} className="truncate">
          {p}
        </li>
      ))}
      {more > 0 && (
        <li>
          and {more} more {more === 1 ? 'pattern' : 'patterns'}
        </li>
      )}
    </ul>
  );
}

function IssueList({ type }: { type: PageTypeView }) {
  if (type.issues.length === 0)
    return <span className="text-muted-foreground">None of its own</span>;
  const more = type.issues.length - SHOWN_ISSUES;
  return (
    <ul className="space-y-0.5">
      {type.issues.slice(0, SHOWN_ISSUES).map((i) => (
        <li key={i.id}>
          <Link
            to={`?tab=${i.tab}&filter=${i.id}&type=${type.id}`}
            className="flex items-baseline gap-2 hover:underline"
          >
            <SeverityDot severity={i.severity} className="translate-y-[-1px]" />
            <span className="min-w-0 flex-1">{i.label}</span>
            <span className="tabular whitespace-nowrap text-muted-foreground">
              {i.n.toLocaleString()} of {type.pageCount.toLocaleString()}
            </span>
          </Link>
        </li>
      ))}
      {more > 0 && (
        <li className="text-xs text-muted-foreground">
          and {more} more {more === 1 ? 'issue' : 'issues'}
        </li>
      )}
    </ul>
  );
}
