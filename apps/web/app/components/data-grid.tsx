import type { Column, GridResult, Row } from '@raisin/core';
import { cn } from '@raisin/ui/lib/utils';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router';
import { formatBytes, HttpStatus } from './common';

export const PAGE_SIZE = 100;

/** Text the crawler recorded verbatim, set in mono like URLs and status codes. */
const VERBATIM = new Set(['content_type', 'status_text']);

// The row number and Address stay pinned while the other columns scroll sideways. Pinned cells
// need an opaque background, so hover and selection paint every cell rather than the row.
const PIN_NUMBER = 'sticky left-0 w-12 min-w-12';
const PIN_URL = 'sticky left-12 border-r';
const CELL_BG =
  'bg-background group-hover:bg-row-hover group-data-[selected=true]:bg-accent group-data-[selected=true]:text-accent-foreground';

export function DataGrid({
  grid,
  selectedId,
  hidden,
}: {
  grid: GridResult;
  selectedId: number | null;
  hidden?: Set<string>;
}) {
  const [params] = useSearchParams();
  const sort = params.get('sort');
  const dir = params.get('dir') === 'desc' ? 'desc' : 'asc';
  const columns = grid.columns.filter((c) => c.key === 'url' || !hidden?.has(c.key));
  const body = useRef<HTMLTableSectionElement>(null);
  const withParams = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    return `?${next.toString()}`;
  };

  // Keyboard selection can move past the visible rows; keep the selected row in view.
  useEffect(() => {
    if (selectedId === null) return;
    body.current
      ?.querySelector(`[data-row-id="${selectedId}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-20 bg-card">
          <tr>
            <th
              scope="col"
              className={cn(
                PIN_NUMBER,
                'z-10 border-b bg-card px-3 py-2 text-right text-xs font-medium text-muted-foreground',
              )}
            >
              <span className="sr-only">Row</span>
              <span aria-hidden>#</span>
            </th>
            {columns.map((c) => {
              const active = sort === c.key;
              const nextDir = active && dir === 'asc' ? 'desc' : 'asc';
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={cn(
                    'border-b bg-card px-3 py-2 text-left text-xs font-medium whitespace-nowrap text-muted-foreground',
                    c.key === 'url' && cn(PIN_URL, 'z-10'),
                  )}
                  style={{ minWidth: c.width }}
                >
                  <Link
                    to={withParams({ sort: c.key, dir: nextDir, page: null })}
                    preventScrollReset
                    className={cn(
                      'inline-flex items-center gap-1 rounded-sm hover:text-foreground',
                      active && 'text-foreground',
                    )}
                  >
                    {c.label}
                    {active &&
                      (dir === 'asc' ? (
                        <ArrowUp className="size-3" aria-hidden />
                      ) : (
                        <ArrowDown className="size-3" aria-hidden />
                      ))}
                  </Link>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody ref={body}>
          {grid.rows.map((row, i) => {
            const id = Number(row.id);
            const selected = id === selectedId;
            return (
              <tr key={id} data-row-id={id} data-selected={selected} className="group">
                <td
                  className={cn(
                    PIN_NUMBER,
                    CELL_BG,
                    'z-[1] border-b px-3 py-1.5 text-right text-xs text-muted-foreground tabular',
                  )}
                >
                  {(Number(params.get('page') ?? 0) * PAGE_SIZE + i + 1).toLocaleString()}
                </td>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      'max-w-[32rem] truncate border-b px-3 py-1.5',
                      CELL_BG,
                      c.key === 'url' && cn(PIN_URL, 'z-[1]'),
                    )}
                    title={titleFor(row, c)}
                  >
                    {c.type === 'url' && c.key === 'url' ? (
                      <Link
                        to={withParams({ url: String(id) })}
                        preventScrollReset
                        aria-current={selected ? 'true' : undefined}
                        className="rounded-sm font-mono text-xs hover:underline"
                      >
                        {String(row[c.key])}
                      </Link>
                    ) : (
                      <Cell value={row[c.key] ?? null} column={c} />
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function titleFor(row: Row, c: Column): string | undefined {
  const v = row[c.key];
  return v === null || v === undefined ? undefined : String(v);
}

export function Cell({ value, column }: { value: string | number | null; column: Column }) {
  // A null indexability reason means nothing stopped the page from being indexed. It's the
  // common case, so it stays quiet and the reasons that do block indexing stand out.
  if (column.key === 'indexability_reason' && value === null)
    return <span className="text-muted-foreground">Indexable</span>;
  if (value === null || value === '') return <span className="text-muted-foreground/60">—</span>;
  switch (column.type) {
    case 'status':
      return <HttpStatus status={value} />;
    case 'bytes':
      return <span className="tabular">{formatBytes(Number(value))}</span>;
    case 'ms':
      return <span className="tabular">{Number(value).toLocaleString()} ms</span>;
    case 'px':
      return <span className="tabular">{Number(value).toLocaleString()} px</span>;
    case 'int':
      return <span className="tabular">{Number(value).toLocaleString()}</span>;
    case 'float':
      return (
        <span className="tabular">
          {Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 })}
        </span>
      );
    case 'bool':
      return <span>{Number(value) ? 'Yes' : 'No'}</span>;
    case 'url':
      return <span className="font-mono text-xs">{String(value)}</span>;
    default:
      return VERBATIM.has(column.key) ? (
        <span className="font-mono text-xs">{String(value)}</span>
      ) : (
        <span>{String(value)}</span>
      );
  }
}
