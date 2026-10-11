import { Button } from '@raisin/ui/button';
import { Input } from '@raisin/ui/input';
import { NativeSelect, NativeSelectOption } from '@raisin/ui/native-select';
import { Form, Link, useNavigation } from 'react-router';
import { MAX_TYPE_NAME, withoutPatternCount } from '~/lib/page-type-edits';
import { EmptyState, type Severity, SeverityDot } from './common';

type Issue = { id: string; label: string; tab: string; severity: Severity; n: number };

export type PageTypeView = {
  id: number;
  label: string;
  /** Labelled by a name someone gave it, not by grouping. */
  named: boolean;
  patterns: string[];
  pageCount: number;
  indexableCount: number;
  sample: { id: number; url: string };
  /** Issues on this type's pages, minus the site-wide ones. */
  issues: Issue[];
};

/** Why a correction to one type wasn't saved. */
export type PageTypeEditError = { typeId: number; message: string };

const SHOWN_PATTERNS = 3;
const SHOWN_ISSUES = 3;

/** The crawl's inventory grouped by template: one row per page type. */
export function PageTypes({
  types,
  sitewide,
  analysed,
  editable,
  editError,
}: {
  types: PageTypeView[];
  sitewide: Issue[];
  analysed: boolean;
  /** Corrections need a finished crawl: grouping runs again when one is saved. */
  editable: boolean;
  editError: PageTypeEditError | null;
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
                {editable && (
                  <EditType
                    type={t}
                    others={types.filter((o) => o.id !== t.id)}
                    error={editError?.typeId === t.id ? editError.message : null}
                  />
                )}
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

/**
 * Rename, merge, split or reset one type. Each change is saved as names for the type's URL
 * patterns, so it also applies to the project's later crawls.
 */
function EditType({
  type,
  others,
  error,
}: {
  type: PageTypeView;
  others: PageTypeView[];
  error: string | null;
}) {
  const navigation = useNavigation();
  const busy = navigation.state === 'submitting';
  const name = type.named ? type.label : withoutPatternCount(type.label);
  const id = (part: string) => `type-${type.id}-${part}`;
  const errorId = id('error');
  return (
    <details open={error !== null} className="group mt-1 text-xs">
      <summary className="w-fit cursor-pointer list-none text-muted-foreground hover:text-foreground group-open:text-foreground">
        {type.named ? 'Edit · named by you' : 'Edit'}
      </summary>
      <div className="mt-2 max-w-sm space-y-3 rounded-md border bg-card p-3">
        <Form method="post" className="flex items-end gap-2">
          <input type="hidden" name="typeId" value={type.id} />
          <div className="min-w-0 flex-1">
            <label htmlFor={id('name')} className="mb-1 block text-muted-foreground">
              Name
            </label>
            <Input
              id={id('name')}
              name="name"
              defaultValue={name}
              maxLength={MAX_TYPE_NAME}
              required
              className="h-8 text-sm"
              aria-invalid={error !== null || undefined}
              aria-describedby={error ? errorId : undefined}
            />
          </div>
          <Button type="submit" name="intent" value="type-rename" size="sm" disabled={busy}>
            Rename
          </Button>
        </Form>
        {others.length > 0 && (
          <Form method="post" className="flex items-end gap-2">
            <input type="hidden" name="typeId" value={type.id} />
            <div className="min-w-0 flex-1">
              <label htmlFor={id('into')} className="mb-1 block text-muted-foreground">
                Merge into
              </label>
              <NativeSelect
                id={id('into')}
                name="into"
                size="sm"
                className="w-full max-w-60 text-sm"
              >
                {others.map((o) => (
                  <NativeSelectOption key={o.id} value={o.id}>
                    {o.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <Button
              type="submit"
              name="intent"
              value="type-merge"
              variant="outline"
              size="sm"
              disabled={busy}
            >
              Merge
            </Button>
          </Form>
        )}
        {type.patterns.length > 1 && (
          <div>
            <p className="mb-1 text-muted-foreground">Split a pattern into its own type</p>
            <ul className="space-y-1">
              {type.patterns.map((p) => (
                <li key={p}>
                  <Form method="post" className="flex items-center gap-2">
                    <input type="hidden" name="typeId" value={type.id} />
                    <input type="hidden" name="pattern" value={p} />
                    <span className="min-w-0 flex-1 truncate font-mono" title={p}>
                      {p}
                    </span>
                    <Button
                      type="submit"
                      name="intent"
                      value="type-split"
                      variant="ghost"
                      size="xs"
                      disabled={busy}
                    >
                      Split out
                    </Button>
                  </Form>
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <p id={errorId} role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between gap-3 border-t pt-2 text-muted-foreground">
          <span>Also applies to this project’s next crawls.</span>
          {type.named && (
            <Form method="post">
              <input type="hidden" name="typeId" value={type.id} />
              <Button
                type="submit"
                name="intent"
                value="type-reset"
                variant="link"
                size="xs"
                className="h-auto px-0"
                disabled={busy}
              >
                Group automatically
              </Button>
            </Form>
          )}
        </div>
      </div>
    </details>
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
