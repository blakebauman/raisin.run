import {
  type GridResult,
  type IssueChange,
  type Overview,
  type PageTypeSummary,
  parseIssueChange,
  RULES,
  RULES_BY_ID,
  TABS,
  TABS_BY_ID,
} from '@raisin/core';
import { crawls } from '@raisin/db';
import { Button } from '@raisin/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@raisin/ui/dropdown-menu';
import { Input } from '@raisin/ui/input';
import { cn } from '@raisin/ui/lib/utils';
import { NativeSelect, NativeSelectOption } from '@raisin/ui/native-select';
import { Progress } from '@raisin/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@raisin/ui/tooltip';
import { eq } from 'drizzle-orm';
import {
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Search,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  data,
  Form,
  Link,
  redirect,
  useNavigate,
  useNavigation,
  useSearchParams,
  useSubmit,
} from 'react-router';
import { DateTime, type Severity, SeverityDot, StatusPill } from '~/components/common';
import { ConfirmDelete } from '~/components/confirm-delete';
import { CrawlOverview } from '~/components/crawl-overview';
import { DataGrid, PAGE_SIZE } from '~/components/data-grid';
import { IssuesPanel, type PanelState } from '~/components/issues-panel';
import { PageTypes, type PageTypeView } from '~/components/page-types';
import { UrlDetailPane } from '~/components/url-detail';
import { useLiveProgress } from '~/components/use-live-progress';
import { requireCrawl } from '~/lib/crawl-access.server';
import { getProject } from '~/lib/crawls.server';
import { db, engine } from '~/lib/env.server';
import { getPlan, UNVERIFIED_LIMITS } from '~/lib/plans.server';
import { canManage } from '~/lib/session.server';
import { PREFS, parseHiddenColumns, readPref, writePref } from '~/lib/ui-prefs';
import type { Route } from './+types/crawl';

export function meta({ loaderData: data }: Route.MetaArgs): Route.MetaDescriptors {
  return [
    { title: data ? `${new URL(data.crawl.startUrl).hostname} crawl — Raisin` : 'Crawl — Raisin' },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { m, crawl } = await requireCrawl(request, params.crawlId);
  const url = new URL(request.url);
  const tabId = url.searchParams.get('tab') ?? 'overview';
  const tab = TABS_BY_ID.get(tabId as never);
  const filter = tab?.filters.some((f) => f.id === url.searchParams.get('filter'))
    ? url.searchParams.get('filter')
    : null;
  const page = Math.max(0, Number(url.searchParams.get('page') ?? 0) || 0);
  const change = filter ? parseIssueChange(url.searchParams.get('change')) : null;
  const pageType = tab ? parsePageType(url.searchParams.get('type')) : null;

  const api = engine();
  const [progress, issues, plan, project] = await Promise.all([
    api.progress(m.orgId, crawl.id),
    api.issues(m.orgId, crawl.id),
    getPlan(m.orgId),
    getProject(m.orgId, crawl.projectId),
  ]);
  let grid: GridResult | null = null;
  let overview: Overview | null = null;
  let pageTypes: PageTypeView[] | null = null;
  let activeType: { id: number; label: string } | null = null;
  if (tabId === PAGE_TYPES_VIEW) {
    pageTypes = (await api.pageTypes(m.orgId, crawl.id)).map(toPageTypeView);
  } else if (tab) {
    if (pageType !== null) {
      const found = (await api.pageTypes(m.orgId, crawl.id)).find((t) => t.id === pageType);
      activeType = found ? { id: found.id, label: found.label } : null;
    }
    grid = await api.grid(m.orgId, crawl.id, {
      tab: tab.id,
      filter,
      change,
      pageType: activeType?.id ?? null,
      search: url.searchParams.get('q'),
      sort: url.searchParams.get('sort'),
      dir: url.searchParams.get('dir') === 'desc' ? 'desc' : 'asc',
      offset: page * PAGE_SIZE,
      limit: PAGE_SIZE,
    });
  } else {
    overview = await api.overview(m.orgId, crawl.id);
  }
  // The explanation travels with the filter so it can sit above the grid, without shipping the
  // whole rule catalogue (and its SQL) to the browser.
  const rule = filter ? RULES.find((r) => r.id === filter) : undefined;
  const verified = project?.verifiedAt != null;
  const panel = readPref(request, PREFS.issuesPanel);
  return {
    crawl: {
      id: crawl.id,
      projectId: crawl.projectId,
      startUrl: crawl.startUrl,
      createdAt: crawl.createdAt,
      exportKey: crawl.exportKey,
      error: crawl.error,
    },
    project: { name: project?.name ?? 'Project', host: project?.host ?? '', verified },
    limits: {
      plan: plan.name,
      planMaxUrls: plan.maxUrlsPerCrawl,
      ceiling: verified
        ? plan.maxUrlsPerCrawl
        : Math.min(plan.maxUrlsPerCrawl, UNVERIFIED_LIMITS.maxUrls),
    },
    tabId: tab ? tab.id : tabId === PAGE_TYPES_VIEW ? PAGE_TYPES_VIEW : 'overview',
    filter,
    change,
    rule: rule
      ? {
          label: rule.label,
          severity: rule.severity as Severity,
          priority: rule.priority,
          description: rule.description,
          fix: rule.fix,
        }
      : null,
    page,
    progress,
    issues,
    grid,
    overview,
    pageTypes,
    activeType,
    aiEnabled: plan.ai,
    canManage: canManage(m),
    panel: (panel === 'open' || panel === 'closed' ? panel : 'default') as PanelState,
    hiddenColumns: parseHiddenColumns(readPref(request, PREFS.columns)),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { m, crawl } = await requireCrawl(request, params.crawlId);
  const intent = String((await request.formData()).get('intent'));
  if (intent === 'pause' || intent === 'resume' || intent === 'stop') {
    const status = await engine().control(m.orgId, crawl.id, intent);
    if (status === 'paused' || status === 'running' || status === 'stopping') {
      await db().update(crawls).set({ status }).where(eq(crawls.id, crawl.id));
    }
    return data({ ok: true });
  }
  if (intent === 'delete') {
    if (!canManage(m)) return data({ ok: false }, { status: 403 });
    await engine()
      .control(m.orgId, crawl.id, 'stop')
      .catch(() => {});
    await engine().purge(m.orgId, crawl.id);
    await db().delete(crawls).where(eq(crawls.id, crawl.id));
    throw redirect(`/app/projects/${crawl.projectId}`);
  }
  return data({ ok: false }, { status: 400 });
}

const WIDE = '(min-width: 1024px)';

/** The page-types view: like the overview, a crawl view that isn't a grid tab. */
const PAGE_TYPES_VIEW = 'page-types';

function parsePageType(value: string | null): number | null {
  const n = Number(value);
  return value && Number.isSafeInteger(n) && n > 0 ? n : null;
}

const SEVERITY_RANK: Record<Severity, number> = { issue: 0, warning: 1, opportunity: 2 };

/** Attach rule labels on the server, so the rule catalogue stays out of the browser bundle. */
function toPageTypeView(t: PageTypeSummary): PageTypeView {
  const issues = t.issues.flatMap((i) => {
    const rule = RULES_BY_ID.get(i.ruleId);
    return rule
      ? [
          {
            id: rule.id,
            label: rule.label,
            tab: rule.tab,
            severity: rule.severity as Severity,
            n: i.n,
          },
        ]
      : [];
  });
  issues.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.n - a.n);
  return {
    id: t.id,
    label: t.label,
    patterns: t.patterns,
    pageCount: t.pageCount,
    indexableCount: t.indexableCount,
    sample: t.sample,
    issues,
  };
}

const IN_PROGRESS = new Set(['queued', 'running', 'paused', 'stopping', 'analysing']);

export default function CrawlPage({ loaderData }: Route.ComponentProps) {
  const {
    crawl,
    project,
    limits,
    grid,
    overview,
    pageTypes,
    activeType,
    issues,
    tabId,
    filter,
    change,
    rule,
    page,
  } = loaderData;
  const progress = useLiveProgress(crawl.id, loaderData.progress);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const selected = params.get('url') ? Number(params.get('url')) : null;
  const tab = TABS_BY_ID.get(tabId as never);
  const exportQuery = new URLSearchParams({ tab: tab ? tabId : 'internal' });
  for (const k of ['filter', 'change', 'type', 'q', 'sort', 'dir'])
    if (params.get(k)) exportQuery.set(k, params.get(k)!);

  const [panel, setPanel] = useState<PanelState>(loaderData.panel);
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia(WIDE);
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  const panelOpen = panel === 'open' || (panel === 'default' && wide);
  const togglePanel = () => {
    const next = panelOpen ? 'closed' : 'open';
    writePref(PREFS.issuesPanel, next);
    setPanel(next);
  };

  const [hidden, setHidden] = useState(loaderData.hiddenColumns);
  const hiddenHere = new Set(hidden[tabId] ?? []);
  const toggleColumn = (key: string) => {
    const set = new Set(hiddenHere);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    const next = { ...hidden, [tabId]: [...set] };
    writePref(PREFS.columns, JSON.stringify(next));
    setHidden(next);
  };

  const searchRef = useRef<HTMLInputElement>(null);
  useGridKeys({
    rowIds: grid ? grid.rows.map((r) => Number(r.id)) : [],
    selected,
    searchRef,
    go: (next) => navigate(`?${next}`, { replace: true, preventScrollReset: true }),
    params,
  });

  const total = progress.crawled + progress.pending + progress.inFlight;
  const running = progress.status === 'running';
  const paused = progress.status === 'paused';
  const maxUrls = progress.config?.maxUrls ?? null;
  const notCrawled = Math.max(0, progress.discovered - progress.crawled);
  const capped =
    progress.status === 'completed' &&
    maxUrls !== null &&
    progress.crawled >= maxUrls &&
    notCrawled > 0;
  const pct = capped
    ? Math.round((progress.crawled / progress.discovered) * 100)
    : progress.status === 'completed'
      ? 100
      : total
        ? Math.round((progress.crawled / total) * 100)
        : 0;
  const pages = grid ? Math.ceil(grid.total / PAGE_SIZE) : 0;
  const narrowed = Boolean(filter || params.get('q') || activeType);

  const pageLink = (p: number) => {
    const next = new URLSearchParams(params);
    next.set('page', String(p));
    return `?${next}`;
  };
  const clearLink = () => {
    const next = new URLSearchParams({ tab: tabId });
    for (const k of ['sort', 'dir']) if (params.get(k)) next.set(k, params.get(k)!);
    return `?${next}`;
  };

  return (
    <div className="flex h-full flex-col">
      <header className="border-b bg-card px-6 pt-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <nav aria-label="Breadcrumb" className="min-w-0">
            <ol className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <li>
                <Link to="/app" className="hover:text-foreground hover:underline">
                  Projects
                </Link>
              </li>
              <li aria-hidden>/</li>
              <li className="min-w-0">
                <Link
                  to={`/app/projects/${crawl.projectId}`}
                  className="block truncate hover:text-foreground hover:underline"
                >
                  {project.name}
                </Link>
              </li>
            </ol>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Form method="post" className="flex gap-2">
              {running && (
                <Button type="submit" name="intent" value="pause" variant="outline" size="sm">
                  <Pause />
                  Pause
                </Button>
              )}
              {paused && (
                <Button type="submit" name="intent" value="resume" variant="outline" size="sm">
                  <Play />
                  Resume
                </Button>
              )}
              {(running || paused || progress.status === 'queued') && (
                <Button type="submit" name="intent" value="stop" variant="outline" size="sm">
                  <Square />
                  Stop
                </Button>
              )}
            </Form>
            <Button asChild variant="outline" size="sm">
              <a href={`/app/crawls/${crawl.id}/export?${exportQuery}`}>
                <Download />
                Export CSV
              </a>
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={togglePanel}
                  aria-expanded={panelOpen}
                  aria-controls="issues-panel"
                  aria-label={panelOpen ? 'Hide issues panel' : 'Show issues panel'}
                >
                  {panelOpen ? <PanelRightClose /> : <PanelRightOpen />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{panelOpen ? 'Hide issues' : 'Show issues'}</TooltipContent>
            </Tooltip>
            {loaderData.canManage && (
              <>
                <span className="mx-1 h-5 w-px bg-border" aria-hidden />
                <ConfirmDelete
                  title="Delete this crawl?"
                  description={
                    <>
                      This deletes the crawl's results, stored pages and exports. {project.name} and
                      its other crawls are kept. This can't be undone.
                    </>
                  }
                  action="Delete crawl"
                  trigger={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Delete crawl"
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 />
                    </Button>
                  }
                />
              </>
            )}
          </div>
        </div>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="min-w-0 truncate font-mono text-base font-semibold" title={crawl.startUrl}>
            {crawl.startUrl}
          </h1>
          <StatusPill status={progress.status} />
          <span className="text-xs text-muted-foreground">
            <DateTime value={crawl.createdAt} />
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <Progress
            value={pct}
            className="h-1.5 w-48"
            aria-label={capped ? 'Share of discovered URLs crawled' : 'Crawl progress'}
          />
          <Metric label="Crawled" value={progress.crawled} />
          <Metric label="Discovered" value={progress.discovered} />
          {(running || paused) && <Metric label="Queued" value={progress.pending} />}
          {running && <Metric label="In flight" value={progress.inFlight} />}
          {running && <Metric label="URLs/s" value={progress.urlsPerSecond} />}
          {progress.failed > 0 && <Metric label="No response" value={progress.failed} />}
          {progress.status === 'analysing' && (
            <span className="text-muted-foreground">Analysing links, duplicates and audits…</span>
          )}
          {crawl.error && <span className="text-destructive">{crawl.error}</span>}
        </div>
        {capped && maxUrls !== null && (
          <LimitNotice
            maxUrls={maxUrls}
            notCrawled={notCrawled}
            projectId={crawl.projectId}
            host={project.host}
            verified={project.verified}
            limits={limits}
          />
        )}
        <p role="status" className="sr-only">
          {statusAnnouncement(progress.status, progress.crawled, capped ? maxUrls : null)}
        </p>
        <nav
          aria-label="Crawl views"
          className="-mb-px mt-3 flex gap-1 overflow-x-auto [scrollbar-width:thin]"
        >
          {[
            { id: 'overview', label: 'Overview' },
            { id: PAGE_TYPES_VIEW, label: 'Page types' },
            ...TABS,
          ].map((t) => (
            <Link
              key={t.id}
              to={`?tab=${t.id}`}
              aria-current={t.id === tabId ? 'page' : undefined}
              className={cn(
                'shrink-0 border-b-2 px-2.5 py-2 text-sm whitespace-nowrap',
                t.id === tabId
                  ? 'border-primary font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {overview && <CrawlOverview overview={overview} progress={progress} />}
          {pageTypes && (
            <PageTypes types={pageTypes} analysed={!IN_PROGRESS.has(progress.status)} />
          )}
          {grid && tab && (
            <>
              <GridToolbar
                tabId={tabId}
                filters={tab.filters}
                filter={filter}
                activeType={activeType}
                total={grid.total}
                updating={navigation.state === 'loading'}
                narrowed={narrowed}
                clearHref={clearLink()}
                searchRef={searchRef}
                columns={grid.columns.filter((c) => c.key !== 'url')}
                hidden={hiddenHere}
                onToggleColumn={toggleColumn}
              />
              {rule && (
                <RuleStrip
                  rule={rule}
                  baseline={issues.baseline}
                  counts={issues.rules.find((r) => r.id === filter)}
                  change={change}
                />
              )}
              {grid.rows.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
                  {progress.status === 'running' || progress.status === 'queued' ? (
                    <p>Waiting for crawl results…</p>
                  ) : change ? (
                    <p>
                      {change === 'new'
                        ? 'No URLs are newly flagged by this audit since the previous crawl.'
                        : 'No URLs flagged by this audit in the previous crawl have been fixed.'}
                    </p>
                  ) : narrowed ? (
                    <>
                      <p>No URLs match this filter or search.</p>
                      <Link to={clearLink()} className="text-primary hover:underline">
                        Clear filter and search
                      </Link>
                    </>
                  ) : (
                    <p>This crawl has no URLs in this view.</p>
                  )}
                </div>
              ) : (
                <DataGrid grid={grid} selectedId={selected} hidden={hiddenHere} />
              )}
              <div className="flex items-center gap-3 border-t px-4 py-1.5 text-xs text-muted-foreground">
                <p className="max-lg:hidden">
                  <Kbd>j</Kbd> <Kbd>k</Kbd> move · <Kbd>/</Kbd> search · <Kbd>Esc</Kbd> close
                </p>
                {pages > 1 && (
                  <div className="ml-auto flex items-center gap-2 text-sm">
                    <span className="tabular">
                      Page {page + 1} of {pages}
                    </span>
                    <Button asChild variant="ghost" size="icon-sm" disabled={page === 0}>
                      <Link
                        to={pageLink(Math.max(0, page - 1))}
                        aria-label="Previous page"
                        preventScrollReset
                      >
                        <ChevronLeft />
                      </Link>
                    </Button>
                    <Button asChild variant="ghost" size="icon-sm" disabled={page + 1 >= pages}>
                      <Link
                        to={pageLink(Math.min(pages - 1, page + 1))}
                        aria-label="Next page"
                        preventScrollReset
                      >
                        <ChevronRight />
                      </Link>
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
          {selected !== null && (
            <UrlDetailPane crawlId={crawl.id} urlId={selected} aiEnabled={loaderData.aiEnabled} />
          )}
        </div>
        <IssuesPanel id="issues-panel" summary={issues} state={panel} />
      </div>
    </div>
  );
}

function statusAnnouncement(status: string, crawled: number, cappedAt: number | null): string {
  if (status === 'completed' && cappedAt !== null)
    return `Crawl stopped at its ${cappedAt.toLocaleString()} URL limit.`;
  if (status === 'completed') return `Crawl completed: ${crawled.toLocaleString()} URLs crawled.`;
  return `Crawl ${status}.`;
}

/** Shown when a crawl ended because it reached its URL limit, with the way to crawl more. */
function LimitNotice({
  maxUrls,
  notCrawled,
  projectId,
  host,
  verified,
  limits,
}: {
  maxUrls: number;
  notCrawled: number;
  projectId: string;
  host: string;
  verified: boolean;
  limits: { plan: string; planMaxUrls: number; ceiling: number };
}) {
  const next =
    maxUrls < limits.ceiling ? (
      <Link
        to={`/app/projects/${projectId}?settings=open`}
        className="text-primary hover:underline"
      >
        Raise the URL limit in crawl settings
      </Link>
    ) : !verified && limits.planMaxUrls > limits.ceiling ? (
      <Link to={`/app/projects/${projectId}?verify=open`} className="text-primary hover:underline">
        Verify {host} to crawl up to {limits.planMaxUrls.toLocaleString()} URLs
      </Link>
    ) : (
      <span className="text-muted-foreground">
        The {limits.plan} plan allows {limits.ceiling.toLocaleString()} URLs per crawl.
      </span>
    );
  return (
    <p className="mt-2 text-sm">
      Stopped at the {maxUrls.toLocaleString()}-URL limit.{' '}
      <span className="tabular">{notCrawled.toLocaleString()}</span> discovered{' '}
      {notCrawled === 1 ? 'URL was' : 'URLs were'} not crawled. {next}
    </p>
  );
}

function GridToolbar({
  tabId,
  filters,
  filter,
  activeType,
  total,
  updating,
  narrowed,
  clearHref,
  searchRef,
  columns,
  hidden,
  onToggleColumn,
}: {
  tabId: string;
  filters: { id: string; label: string }[];
  filter: string | null;
  activeType: { id: number; label: string } | null;
  total: number;
  updating: boolean;
  narrowed: boolean;
  clearHref: string;
  searchRef: React.RefObject<HTMLInputElement | null>;
  columns: { key: string; label: string }[];
  hidden: Set<string>;
  onToggleColumn: (key: string) => void;
}) {
  const [params] = useSearchParams();
  const submit = useSubmit();
  const shown = columns.filter((c) => !hidden.has(c.key)).length;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onChange = (e: React.FormEvent<HTMLFormElement>) => {
    const form = e.currentTarget;
    clearTimeout(timer.current);
    // Typing waits for a pause; picking a filter applies at once.
    const delay = (e.target as HTMLElement).tagName === 'INPUT' ? 300 : 0;
    timer.current = setTimeout(() => submit(form, { preventScrollReset: true }), delay);
  };
  return (
    <Form
      method="get"
      role="search"
      className="flex flex-wrap items-center gap-2 border-b px-4 py-2"
      onChange={onChange}
    >
      <input type="hidden" name="tab" value={tabId} />
      {params.get('sort') && <input type="hidden" name="sort" value={params.get('sort')!} />}
      {params.get('dir') && <input type="hidden" name="dir" value={params.get('dir')!} />}
      {activeType && <input type="hidden" name="type" value={activeType.id} />}
      {activeType && <PageTypeChip type={activeType} />}
      <label htmlFor="grid-filter" className="sr-only">
        Filter
      </label>
      <NativeSelect
        id="grid-filter"
        name="filter"
        defaultValue={filter ?? ''}
        size="sm"
        key={`${tabId}-${filter}`}
      >
        <NativeSelectOption value="">All URLs</NativeSelectOption>
        {filters.map((f) => (
          <NativeSelectOption key={f.id} value={f.id}>
            {f.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          ref={searchRef}
          name="q"
          type="search"
          key={`${tabId}-q`}
          defaultValue={params.get('q') ?? ''}
          placeholder="Search URL or title"
          aria-label="Search URL or title"
          className="h-8 w-64 pl-8"
        />
      </div>
      {narrowed && (
        <Button asChild variant="ghost" size="sm">
          <Link to={clearHref} preventScrollReset>
            <X />
            Clear
          </Link>
        </Button>
      )}
      <span className="ml-auto text-sm text-muted-foreground tabular" aria-live="polite">
        {total.toLocaleString()} URL{total === 1 ? '' : 's'}
        {updating && ' · updating…'}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="sm">
            <Columns3 />
            Columns
            {shown < columns.length && (
              <span className="tabular text-muted-foreground">
                {shown}/{columns.length}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-auto">
          <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
            Show columns
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {columns.map((c) => (
            <DropdownMenuCheckboxItem
              key={c.key}
              checked={!hidden.has(c.key)}
              onCheckedChange={() => onToggleColumn(c.key)}
              onSelect={(e) => e.preventDefault()}
            >
              {c.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </Form>
  );
}

/** The page type the grid is narrowed to, with a link that removes just that. */
function PageTypeChip({ type }: { type: { id: number; label: string } }) {
  const [params] = useSearchParams();
  const without = new URLSearchParams(params);
  for (const k of ['type', 'page', 'url']) without.delete(k);
  return (
    <span className="inline-flex h-8 max-w-72 items-center gap-1 rounded-md border bg-accent pr-1 pl-2.5 text-sm text-accent-foreground">
      <span className="truncate">
        <span className="text-muted-foreground">Type: </span>
        {type.label}
      </span>
      <Link
        to={`?${without}`}
        preventScrollReset
        aria-label={`Show all page types, not only ${type.label}`}
        className="rounded p-1 hover:bg-background/60"
      >
        <X className="size-3.5" />
      </Link>
    </span>
  );
}

/** Why the active audit matters and how to fix it, above the URLs it flagged. */
function RuleStrip({
  rule,
  baseline,
  counts,
  change,
}: {
  rule: { label: string; severity: Severity; priority: string; description: string; fix: string };
  baseline: { crawlId: string; createdAt: number } | null;
  counts: { count: number; new: number; fixed: number } | undefined;
  change: IssueChange | null;
}) {
  const [params] = useSearchParams();
  const views: { id: IssueChange | null; label: string; n: number }[] = counts
    ? [
        { id: null, label: 'All', n: counts.count },
        { id: 'new', label: 'New', n: counts.new },
        { id: 'fixed', label: 'Fixed', n: counts.fixed },
      ]
    : [];
  const viewLink = (id: IssueChange | null) => {
    const next = new URLSearchParams(params);
    next.delete('page');
    next.delete('url');
    if (id) next.set('change', id);
    else next.delete('change');
    return `?${next}`;
  };
  return (
    <section
      aria-label={`About ${rule.label}`}
      className="flex flex-wrap items-start gap-x-6 gap-y-2 border-b bg-card px-4 py-2.5 text-sm"
    >
      <div className="grid min-w-0 flex-1 basis-96 gap-0.5">
        <p className="flex items-center gap-2 font-medium">
          <SeverityDot severity={rule.severity} />
          {rule.label}
          <span className="text-xs font-normal text-muted-foreground">
            {rule.priority.charAt(0).toUpperCase() + rule.priority.slice(1)} priority
          </span>
        </p>
        <p className="max-w-[75ch] text-muted-foreground">{rule.description}</p>
        <p className="max-w-[75ch]">
          <span className="font-medium">Fix: </span>
          {rule.fix}
        </p>
      </div>
      {baseline && views.length > 0 && (
        <nav aria-label="Compare with the previous crawl" className="grid justify-items-end gap-1">
          <div className="flex rounded-md border p-0.5">
            {views.map((v) => (
              <Link
                key={v.label}
                to={viewLink(v.id)}
                preventScrollReset
                aria-current={change === v.id ? 'page' : undefined}
                className={cn(
                  'rounded-sm px-2.5 py-1 text-xs whitespace-nowrap text-muted-foreground hover:text-foreground',
                  change === v.id && 'bg-accent font-medium text-accent-foreground',
                )}
              >
                {v.label} <span className="tabular">{v.n.toLocaleString()}</span>
              </Link>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Since the crawl of <DateTime value={baseline.createdAt} />
          </p>
        </nav>
      )}
    </section>
  );
}

/**
 * Grid keyboard: j/k (or arrows) move the selected row, which opens its detail; `/` focuses
 * search; Esc closes the detail pane or leaves the search field. Ignored while typing elsewhere
 * or with modifier keys, so browser and OS shortcuts still work.
 */
function useGridKeys({
  rowIds,
  selected,
  searchRef,
  go,
  params,
}: {
  rowIds: number[];
  selected: number | null;
  searchRef: React.RefObject<HTMLInputElement | null>;
  go: (next: URLSearchParams) => void;
  params: URLSearchParams;
}) {
  const latest = useRef({ rowIds, selected, go, params });
  latest.current = { rowIds, selected, go, params };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const { rowIds, selected, go, params } = latest.current;
      const target = e.target as HTMLElement;
      const typing =
        target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (e.key === 'Escape') {
        if (target === searchRef.current) {
          searchRef.current?.blur();
          return;
        }
        // An open dialog or menu handles its own Escape.
        if (document.querySelector('[role="dialog"], [role="menu"]')) return;
        if (selected !== null) {
          const next = new URLSearchParams(params);
          next.delete('url');
          go(next);
        }
        return;
      }
      if (typing) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      const step =
        e.key === 'j' || e.key === 'ArrowDown' ? 1 : e.key === 'k' || e.key === 'ArrowUp' ? -1 : 0;
      if (!step || rowIds.length === 0) return;
      // Arrow keys keep scrolling the page unless a row is already selected.
      if (e.key.startsWith('Arrow') && selected === null) return;
      e.preventDefault();
      const at = selected === null ? -1 : rowIds.indexOf(selected);
      const index =
        at === -1
          ? step > 0
            ? 0
            : rowIds.length - 1
          : Math.min(rowIds.length - 1, Math.max(0, at + step));
      const next = new URLSearchParams(params);
      next.set('url', String(rowIds[index]));
      go(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchRef]);
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border bg-muted px-1 font-mono text-xs leading-4 text-foreground">
      {children}
    </kbd>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <span className="text-muted-foreground">
      {label} <span className="tabular font-medium text-foreground">{value.toLocaleString()}</span>
    </span>
  );
}
