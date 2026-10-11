/**
 * App-level composites on top of `@raisin/ui`: form fields, status and severity markers,
 * stats, bar lists and formatters. Primitives (Button, Card, Input…) come from `@raisin/ui`.
 */

import { Checkbox } from '@raisin/ui/checkbox';
import { Label } from '@raisin/ui/label';
import { cn } from '@raisin/ui/lib/utils';
import { type ReactNode, useEffect, useState } from 'react';

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** A labelled checkbox that submits `name=on` with its form, like a native checkbox. */
export function CheckField({
  id,
  name,
  label,
  hint,
  defaultChecked,
  disabled,
}: {
  id: string;
  name: string;
  label: string;
  hint?: string;
  defaultChecked?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5 py-1">
      <Checkbox
        id={id}
        name={name}
        defaultChecked={defaultChecked}
        disabled={disabled}
        className="mt-0.5"
      />
      <div className="grid gap-0.5">
        <Label htmlFor={id} className="font-normal">
          {label}
        </Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

export type Severity = 'issue' | 'warning' | 'opportunity';

export const SEVERITY_LABEL: Record<Severity, string> = {
  issue: 'Issues',
  warning: 'Warnings',
  opportunity: 'Opportunities',
};

export function SeverityDot({ severity, className }: { severity: Severity; className?: string }) {
  const color = { issue: 'bg-issue', warning: 'bg-warning', opportunity: 'bg-opportunity' }[
    severity
  ];
  return (
    <span
      className={cn('inline-block size-2 shrink-0 rounded-full', color, className)}
      aria-hidden
    />
  );
}

const STATUS_STYLE: Record<string, string> = {
  queued: 'bg-muted text-muted-foreground',
  running: 'bg-accent text-accent-foreground',
  paused: 'bg-warning/15 text-warning',
  stopping: 'bg-warning/15 text-warning',
  analysing: 'bg-opportunity/15 text-opportunity',
  completed: 'bg-status-ok/15 text-status-ok',
  failed: 'bg-destructive/15 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium capitalize',
        STATUS_STYLE[status] ?? STATUS_STYLE.queued,
      )}
    >
      {(status === 'running' || status === 'analysing') && (
        <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />
      )}
      {status}
    </span>
  );
}

export function HttpStatus({ status }: { status: number | string | null | undefined }) {
  if (status === null || status === undefined || status === '') {
    return <span className="text-muted-foreground">—</span>;
  }
  const n = Number(status);
  const color =
    n === 0
      ? 'text-muted-foreground'
      : n < 300
        ? 'text-status-ok'
        : n < 400
          ? 'text-status-redirect'
          : n < 500
            ? 'text-status-client'
            : 'text-status-server';
  return <span className={cn('tabular font-mono', color)}>{n === 0 ? 'none' : n}</span>;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="tabular mt-0.5 text-xl font-semibold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

/** Horizontal bar list: the overview's charts. */
export function BarList({
  items,
  total,
}: {
  items: { label: string; value: number }[];
  total?: number;
}) {
  const max = total ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="relative">
          <div
            className="absolute inset-y-0 left-0 rounded bg-accent"
            style={{ width: `${Math.max(1, (item.value / max) * 100)}%` }}
          />
          <div className="relative flex justify-between gap-4 px-2 py-1 text-sm">
            <span className="truncate">{item.label}</span>
            <span className="tabular text-muted-foreground">{item.value.toLocaleString()}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}>
      <img src="/favicon.svg" alt="" className="size-6" />
      <span>raisin</span>
    </span>
  );
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const DATE_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };

/**
 * A timestamp in the viewer's time zone. The server renders it in UTC (it can't know the
 * viewer's zone) and the client swaps in local time after hydration, so the markup matches.
 */
export function DateTime({ value }: { value: Date | string | number | null | undefined }) {
  const [local, setLocal] = useState<string | null>(null);
  const date = value ? new Date(value) : null;
  const time = date?.getTime();
  useEffect(() => {
    setLocal(time === undefined ? null : new Date(time).toLocaleString(undefined, DATE_FORMAT));
  }, [time]);
  if (!date) return <span className="text-muted-foreground">—</span>;
  return (
    <time dateTime={date.toISOString()} title={date.toISOString()}>
      {local ?? `${date.toLocaleString('en-US', { ...DATE_FORMAT, timeZone: 'UTC' })} UTC`}
    </time>
  );
}
