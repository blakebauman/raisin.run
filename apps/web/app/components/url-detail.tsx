import {
  DESCRIPTION_FONT_PX,
  type Row,
  SERP_LIMITS,
  TABS_BY_ID,
  TITLE_FONT_PX,
  truncateToWidth,
  type UrlDetail,
} from '@raisin/core';
import { Button } from '@raisin/ui/button';
import { cn } from '@raisin/ui/lib/utils';
import { Spinner } from '@raisin/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@raisin/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@raisin/ui/tabs';
import { ExternalLink, Sparkles, X } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useFetcher, useSearchParams } from 'react-router';
import { DateTime, EmptyState, formatBytes, HttpStatus, SeverityDot } from './common';

type Suggestion =
  | { kind: 'alt' | 'meta'; imageUrl: string | null; text: string }
  | { error: string };

export function UrlDetailPane({
  crawlId,
  urlId,
  aiEnabled,
}: {
  crawlId: string;
  urlId: number;
  aiEnabled: boolean;
}) {
  const fetcher = useFetcher<UrlDetail>();
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    fetcher.load(`/app/crawls/${crawlId}/url/${urlId}`);
  }, [crawlId, urlId]);

  const close = () => {
    const next = new URLSearchParams(params);
    next.delete('url');
    setParams(next, { preventScrollReset: true });
  };
  const detail = fetcher.data;
  const page = detail?.page ?? null;
  const url = String(page?.url ?? detail?.frontier?.url ?? '');

  return (
    <section className="flex h-[45%] min-h-64 shrink-0 flex-col border-t bg-card">
      <div className="flex items-center gap-3 border-b px-4 py-2">
        {page && <HttpStatus status={page.status} />}
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 flex-1 truncate font-mono text-xs hover:underline"
        >
          {url || 'Loading…'}
        </a>
        <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden />
        <Button variant="ghost" size="icon-sm" onClick={close} aria-label="Close URL details">
          <X />
        </Button>
      </div>
      {!detail ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <Tabs defaultValue="details" className="min-h-0 flex-1 gap-0">
          <TabsList
            variant="line"
            className="h-auto w-full shrink-0 justify-start overflow-x-auto border-b px-2.5"
          >
            <DetailTab value="details">Details</DetailTab>
            <DetailTab value="issues">Issues ({detail.issues.length})</DetailTab>
            <DetailTab value="inlinks">Inlinks ({detail.inlinks.length})</DetailTab>
            <DetailTab value="outlinks">Outlinks ({detail.outlinks.length})</DetailTab>
            <DetailTab value="images">Images ({detail.images.length})</DetailTab>
            <DetailTab value="serp">SERP</DetailTab>
            <DetailTab value="headers">Headers</DetailTab>
            <DetailTab value="structured">Structured data</DetailTab>
            {detail.hreflang.length > 0 && <DetailTab value="hreflang">Hreflang</DetailTab>}
            {detail.duplicates.length > 0 && (
              <DetailTab value="duplicates">Duplicates ({detail.duplicates.length})</DetailTab>
            )}
          </TabsList>
          <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
            <TabsContent value="details">
              <Details detail={detail} crawlId={crawlId} />
            </TabsContent>
            <TabsContent value="issues">
              {detail.issues.length === 0 ? (
                <EmptyState title="No issues on this URL" />
              ) : (
                <ul className="grid gap-3">
                  {detail.issues.map((i) => (
                    <li key={i.id} className="rounded-md border p-3">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        <SeverityDot severity={i.severity} />
                        {i.label}
                        <span className="text-xs font-normal text-muted-foreground">
                          <span className="capitalize">{i.priority}</span> priority ·{' '}
                          {TABS_BY_ID.get(i.tab as never)?.label ?? i.tab}
                        </span>
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">{i.description}</p>
                      <p className="mt-1 text-sm">
                        <span className="font-medium">Fix: </span>
                        {i.fix}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
            <TabsContent value="inlinks">
              <LinkTable rows={detail.inlinks} />
            </TabsContent>
            <TabsContent value="outlinks">
              <LinkTable rows={detail.outlinks} showStatus />
            </TabsContent>
            <TabsContent value="images">
              <Images rows={detail.images} crawlId={crawlId} urlId={urlId} aiEnabled={aiEnabled} />
            </TabsContent>
            <TabsContent value="serp">
              <Serp page={page} crawlId={crawlId} urlId={urlId} aiEnabled={aiEnabled} />
            </TabsContent>
            <TabsContent value="headers">
              <KeyValues
                entries={Object.entries(
                  parse<Record<string, string>>(detail.details?.headers_json) ?? {},
                )}
                mono
              />
            </TabsContent>
            <TabsContent value="structured">
              <Structured json={detail.details?.structured_json} />
            </TabsContent>
            <TabsContent value="hreflang">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Language</TableHead>
                    <TableHead>URL</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Return link</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.hreflang.map((h) => (
                    <TableRow key={`${h.lang}-${h.href}`}>
                      <TableCell className="font-mono text-xs">{h.lang}</TableCell>
                      <TableCell className="font-mono text-xs">{h.href}</TableCell>
                      <TableCell>
                        <HttpStatus status={h.status} />
                      </TableCell>
                      <TableCell>
                        {Number(h.returns) ? 'Yes' : <span className="text-issue">Missing</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>
            <TabsContent value="duplicates">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>URL</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead className="text-right">Similarity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.duplicates.map((d) => (
                    <TableRow key={`${d.kind}-${d.id}`}>
                      <TableCell>
                        <Link
                          to={`?${withUrl(params, Number(d.id))}`}
                          className="font-mono text-xs hover:underline"
                        >
                          {String(d.url)}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {d.kind === 'simhash' ? 'Near duplicate' : 'Semantic (AI)'}
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {d.kind === 'simhash'
                          ? `${d.similarity}%`
                          : `${Math.round(Number(d.similarity) * 100)}%`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>
          </div>
        </Tabs>
      )}
    </section>
  );
}

/** Underlined like the crawl view's tabs: muted at rest, a Raisin Skin rule when active. */
function DetailTab({ className, ...props }: React.ComponentProps<typeof TabsTrigger>) {
  return (
    <TabsTrigger
      className={cn(
        'h-auto flex-none rounded-none px-2.5 py-2 font-normal text-muted-foreground data-[state=active]:font-medium data-[state=active]:text-foreground group-data-[orientation=horizontal]/tabs:after:bottom-0 dark:text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

function withUrl(params: URLSearchParams, id: number): string {
  const next = new URLSearchParams(params);
  next.set('url', String(id));
  return next.toString();
}

function Details({ detail, crawlId }: { detail: UrlDetail; crawlId: string }) {
  const p = detail.page;
  if (!p) {
    return (
      <EmptyState title="Not crawled">
        Discovered via {String(detail.frontier?.via ?? 'a link')} but not fetched — it was outside
        the crawl limits, filters or depth.
      </EmptyState>
    );
  }
  const js = parse<{ consoleErrors: string[]; failedRequests: string[] }>(detail.details?.js_json);
  const extractions = parse<Record<string, string[]>>(detail.details?.extractions_json);
  const entries: [string, React.ReactNode][] = [
    ['Indexability', p.indexability_reason ?? 'Indexable'],
    ['Content type', p.content_type],
    ['Size', formatBytes(Number(p.size))],
    ['Response time', `${p.response_ms} ms`],
    ['Crawl depth', p.depth],
    ['Title', p.title && `${p.title} (${p.title_len} chars, ${p.title_px}px)`],
    [
      'Meta description',
      p.meta_desc && `${p.meta_desc} (${p.meta_desc_len} chars, ${p.meta_desc_px}px)`,
    ],
    ['H1', p.h1],
    ['H2', p.h2],
    ['Canonical', p.canonical ?? p.canonical_header],
    ['Meta robots', p.meta_robots],
    ['X-Robots-Tag', p.x_robots],
    ['Redirect URL', p.redirect_target],
    ['Language', p.lang],
    ['Word count', p.word_count],
    ['Text ratio', p.text_ratio !== null ? `${p.text_ratio}%` : null],
    ['Inlinks', `${p.inlinks} (${p.unique_inlinks} unique)`],
    ['Outlinks', `${p.unique_outlinks} internal, ${p.external_outlinks} external`],
    ['Link score', p.link_score],
    ['Structured data', p.structured_types],
    ['In sitemap', Number(p.in_sitemap) ? 'Yes' : 'No'],
    ['Last modified', p.last_modified],
    ['Crawled', <DateTime key="crawled" value={Number(p.crawled_at)} />],
    ['Error', p.error],
  ];
  if (Number(p.rendered)) {
    entries.push(
      ['Rendered title', p.js_title],
      ['Rendered word count', p.js_word_count],
      ['Links only in rendered HTML', p.js_links_added],
      ['LCP (lab)', p.lcp_ms !== null ? `${p.lcp_ms} ms` : null],
      ['CLS (lab)', p.cls],
      ['Console errors', js?.consoleErrors.length ? js.consoleErrors.join('\n') : null],
    );
  }
  for (const [name, values] of Object.entries(extractions ?? {}))
    entries.push([`Extraction: ${name}`, values.join(' · ')]);
  const objectUrl = (key: string) => `/app/crawls/${crawlId}/object?key=${encodeURIComponent(key)}`;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
      <div>
        {detail.redirectChain.length > 0 && (
          <div className="mb-3 rounded-md border p-3 text-sm">
            <p className="font-medium">Redirect chain</p>
            <ol className="mt-1 grid gap-0.5">
              {detail.redirectChain.map((hop, i) => (
                <li key={`${hop.url}-${i}`} className="flex gap-2 font-mono text-xs">
                  <HttpStatus status={hop.status} />
                  {hop.url}
                </li>
              ))}
            </ol>
          </div>
        )}
        <KeyValues entries={entries} />
      </div>
      <div className="flex flex-col gap-2">
        {p.screenshot_key && (
          <a href={objectUrl(String(p.screenshot_key))} target="_blank" rel="noreferrer">
            <img
              src={objectUrl(String(p.screenshot_key))}
              alt="Rendered page"
              className="w-72 rounded border"
            />
          </a>
        )}
        {p.html_key && (
          <Button asChild variant="outline" size="sm">
            <a href={objectUrl(String(p.html_key))} target="_blank" rel="noreferrer">
              View stored HTML
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}

function KeyValues({ entries, mono }: { entries: [string, React.ReactNode][]; mono?: boolean }) {
  const shown = entries.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!shown.length) return <EmptyState title="Nothing recorded" />;
  return (
    <dl className="grid grid-cols-[minmax(9rem,max-content)_1fr] gap-x-4 gap-y-1 text-sm">
      {shown.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className={`break-all whitespace-pre-wrap ${mono ? 'font-mono text-xs' : ''}`}>
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function LinkTable({ rows, showStatus }: { rows: Row[]; showStatus?: boolean }) {
  const [params] = useSearchParams();
  if (!rows.length) return <EmptyState title="No links" />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Type</TableHead>
          <TableHead>{showStatus ? 'To' : 'From'}</TableHead>
          {showStatus && <TableHead>Status</TableHead>}
          <TableHead>Anchor / alt</TableHead>
          <TableHead>Rel</TableHead>
          <TableHead>Position</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={`${r.id}-${i}`}>
            <TableCell className="text-xs">
              {String(r.type)}
              {Number(r.js_only) ? <span className="ml-1 text-warning">JS</span> : null}
            </TableCell>
            <TableCell className="max-w-md truncate">
              <Link
                to={`?${withUrl(params, Number(r.id))}`}
                className="font-mono text-xs hover:underline"
              >
                {String(r.url ?? '')}
              </Link>
            </TableCell>
            {showStatus && (
              <TableCell>
                <HttpStatus status={r.status} />
              </TableCell>
            )}
            <TableCell className="max-w-xs truncate">{String(r.anchor ?? r.alt ?? '')}</TableCell>
            <TableCell className="text-xs">
              {Number(r.nofollow) ? (
                <span className="text-warning">{String(r.rel)}</span>
              ) : (
                String(r.rel ?? '')
              )}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {String(r.position ?? '')}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Images({
  rows,
  crawlId,
  urlId,
  aiEnabled,
}: {
  rows: Row[];
  crawlId: string;
  urlId: number;
  aiEnabled: boolean;
}) {
  const fetcher = useFetcher<Suggestion>();
  if (!rows.length) return <EmptyState title="No images" />;
  const suggestion = fetcher.data;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Image</TableHead>
          <TableHead>Alt text</TableHead>
          <TableHead className="text-right">Size</TableHead>
          <TableHead>Dimensions</TableHead>
          {aiEnabled && <TableHead />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => {
          const mine = suggestion && 'text' in suggestion && suggestion.imageUrl === r.src;
          return (
            <TableRow key={`${r.id}-${i}`}>
              <TableCell className="max-w-sm truncate font-mono text-xs">{String(r.src)}</TableCell>
              <TableCell className="max-w-sm">
                {r.alt === null ? (
                  <span className="text-issue">Missing</span>
                ) : r.alt === '' ? (
                  <span className="text-warning">Empty</span>
                ) : (
                  String(r.alt)
                )}
                {mine && <p className="mt-1 text-xs text-primary">Suggested: {suggestion.text}</p>}
              </TableCell>
              <TableCell className="tabular text-right">
                {formatBytes(r.size === null ? null : Number(r.size))}
              </TableCell>
              <TableCell className="text-xs">
                {r.width && r.height ? (
                  `${r.width}×${r.height}`
                ) : (
                  <span className="text-muted-foreground">not set</span>
                )}
              </TableCell>
              {aiEnabled && (
                <TableCell>
                  {(r.alt === null || r.alt === '') && (
                    <fetcher.Form method="post" action={`/app/crawls/${crawlId}/suggest`}>
                      <input type="hidden" name="kind" value="alt" />
                      <input type="hidden" name="urlId" value={urlId} />
                      <input type="hidden" name="imageUrl" value={String(r.src)} />
                      <Button
                        type="submit"
                        size="xs"
                        variant="outline"
                        disabled={fetcher.state !== 'idle'}
                      >
                        <Sparkles />
                        Suggest alt
                      </Button>
                    </fetcher.Form>
                  )}
                </TableCell>
              )}
            </TableRow>
          );
        })}
        {suggestion && 'error' in suggestion && (
          <TableRow>
            <TableCell colSpan={5} className="text-destructive">
              {suggestion.error}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

function Serp({
  page,
  crawlId,
  urlId,
  aiEnabled,
}: {
  page: Row | null;
  crawlId: string;
  urlId: number;
  aiEnabled: boolean;
}) {
  const fetcher = useFetcher<Suggestion>();
  if (!page) return <EmptyState title="Not crawled" />;
  const title = String(page.title ?? '');
  const desc = String(page.meta_desc ?? '');
  const suggestion = fetcher.data;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="max-w-[600px] rounded-lg border bg-white p-4 font-[Arial,sans-serif] text-[#202124]">
        <p className="truncate text-sm text-[#4d5156]">{String(page.url)}</p>
        <p className="mt-1 text-[20px] leading-tight text-[#1a0dab]">
          {title ? (
            truncateToWidth(title, SERP_LIMITS.title.maxPx, TITLE_FONT_PX)
          ) : (
            <em>No title</em>
          )}
        </p>
        <p className="mt-1 text-[14px] leading-snug text-[#4d5156]">
          {desc ? (
            truncateToWidth(desc, SERP_LIMITS.description.maxPx, DESCRIPTION_FONT_PX)
          ) : (
            <em>No meta description — Google will pick text from the page.</em>
          )}
        </p>
      </div>
      <div className="text-sm">
        <p>
          Title: {String(page.title_len ?? 0)} characters, {String(page.title_px ?? 0)}px of{' '}
          {SERP_LIMITS.title.maxPx}px.
        </p>
        <p>
          Description: {String(page.meta_desc_len ?? 0)} characters,{' '}
          {String(page.meta_desc_px ?? 0)}px of {SERP_LIMITS.description.maxPx}px.
        </p>
        {aiEnabled && (
          <fetcher.Form method="post" action={`/app/crawls/${crawlId}/suggest`} className="mt-3">
            <input type="hidden" name="kind" value="meta" />
            <input type="hidden" name="urlId" value={urlId} />
            <Button type="submit" size="sm" variant="outline" disabled={fetcher.state !== 'idle'}>
              <Sparkles />
              {fetcher.state !== 'idle' ? 'Writing…' : 'Suggest title and description'}
            </Button>
          </fetcher.Form>
        )}
        {suggestion && 'text' in suggestion && (
          <pre className="mt-3 rounded-md bg-muted p-3 text-sm whitespace-pre-wrap">
            {suggestion.text}
          </pre>
        )}
        {suggestion && 'error' in suggestion && (
          <p className="mt-3 text-destructive">{suggestion.error}</p>
        )}
      </div>
    </div>
  );
}

function Structured({ json }: { json: string | number | null | undefined }) {
  const blocks =
    parse<{ format: string; types: string[]; valid: boolean; errors: string[]; raw?: string }[]>(
      json,
    );
  if (!blocks?.length) return <EmptyState title="No structured data" />;
  return (
    <div className="grid gap-3">
      {blocks.map((b, i) => (
        <div key={`${b.format}-${i}`} className="rounded-md border p-3 text-sm">
          <p className="font-medium">
            {b.format.toUpperCase()} · {b.types.join(', ') || 'no @type'}{' '}
            {b.valid ? (
              <span className="text-status-ok">valid</span>
            ) : (
              <span className="text-issue">{b.errors.length} error(s)</span>
            )}
          </p>
          {b.errors.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-issue">
              {b.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          {b.raw && (
            <pre className="mt-2 max-h-48 overflow-auto rounded bg-muted p-2 font-mono text-xs">
              {pretty(b.raw)}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

function parse<T>(value: string | number | null | undefined): T | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function pretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
