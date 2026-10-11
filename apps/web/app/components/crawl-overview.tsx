import type { Overview, ProgressResult } from '@raisin/core';
import { Card, CardContent, CardHeader, CardTitle } from '@raisin/ui/card';
import { BarList, HttpStatus } from './common';

export function CrawlOverview({
  overview,
  progress,
}: {
  overview: Overview;
  progress: ProgressResult;
}) {
  const buckets = Object.entries(progress.statusBuckets).sort();
  return (
    <div className="grid min-h-0 flex-1 auto-rows-min items-start gap-4 overflow-auto p-6 lg:grid-cols-2 xl:grid-cols-3">
      <Section title="Response codes">
        <BarList
          items={buckets.map(([k, v]) => ({
            label: k === 'error' ? 'No response' : k === 'blocked' ? 'Blocked by robots.txt' : k,
            value: v,
          }))}
        />
      </Section>
      <Section title="Indexability (internal HTML)">
        <BarList items={overview.indexability.map((r) => ({ label: r.reason, value: r.n }))} />
      </Section>
      <Section title="Content types (internal)">
        <BarList items={overview.contentTypes.map((r) => ({ label: r.kind, value: r.n }))} />
      </Section>
      <Section title="Crawl depth">
        <BarList
          items={overview.depth.map((r) => ({
            label: r.depth >= 10 ? '10+' : `Depth ${r.depth}`,
            value: r.n,
          }))}
        />
      </Section>
      <Section title="Response time (HTML)">
        <BarList
          items={['<200ms', '200–500ms', '0.5–1s', '1–2s', '>2s']
            .map((b) => ({
              label: b,
              value: overview.responseTimes.find((r) => r.bucket === b)?.n ?? 0,
            }))
            .filter((r) => r.value > 0)}
        />
      </Section>
      <Section title="Top directories">
        <BarList
          items={overview.directories.map((r) => ({
            label: r.dir === '/' ? '/ (root)' : r.dir,
            value: r.n,
          }))}
        />
      </Section>
      <Section title="Sitemaps" className="lg:col-span-2 xl:col-span-3">
        {overview.sitemaps.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No XML sitemaps found in robots.txt or at /sitemap.xml.
          </p>
        ) : (
          <ul className="divide-y text-sm">
            {overview.sitemaps.map((s) => (
              <li key={s.url} className="flex items-center gap-3 py-1.5">
                <HttpStatus status={s.status} />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{s.url}</span>
                <span className="tabular text-muted-foreground">
                  {s.url_count.toLocaleString()} URLs
                </span>
                {s.error && <span className="text-xs text-destructive">{s.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={`gap-3 py-4 ${className ?? ''}`}>
      <CardHeader className="px-4">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-4">{children}</CardContent>
    </Card>
  );
}
