/**
 * The contract between the web app and the engine's `EngineApi` RPC entrypoint. The web app
 * types its service binding with `EngineRpc` rather than importing engine source, so the two
 * Workers build independently and this file is the only thing they share about each other.
 */

import type { PageTypeNames } from './page-types';
import type { Column, GridQuery } from './tabs';
import type { CrawlConfig, CrawlProgress, CrawlStatus } from './types';

export type Cell = string | number | null;
export type Row = Record<string, Cell>;

export type GridResult = { columns: Column[]; rows: Row[]; total: number };

export type ProgressResult = CrawlProgress & {
  crawlId: string | null;
  config: CrawlConfig | null;
  rendered: number;
};

/** The crawl this one is compared with: the project's previous completed crawl. */
export type IssueBaseline = { crawlId: string; createdAt: number };

export type IssueSummary = {
  totals: Record<'issue' | 'warning' | 'opportunity', number>;
  rules: {
    id: string;
    tab: string;
    label: string;
    severity: 'issue' | 'warning' | 'opportunity';
    priority: 'high' | 'medium' | 'low';
    count: number;
    /** URLs flagged now but not in the baseline. Zero when there is no baseline. */
    new: number;
    /** URLs flagged in the baseline, crawled again, and no longer flagged. */
    fixed: number;
  }[];
  baseline: IssueBaseline | null;
};

/** One page of `(rule_id, url_id)` audit results, in key order, for copying into a baseline. */
export type IssueKey = { rule_id: string; url_id: number };

export type Overview = {
  contentTypes: { kind: string; n: number }[];
  indexability: { reason: string; n: number }[];
  depth: { depth: number; n: number }[];
  responseTimes: { bucket: string; n: number }[];
  directories: { dir: string; n: number }[];
  sitemaps: { url: string; status: number; url_count: number; error: string | null }[];
};

/** One page type (page-types.ts) with the audit results its pages share. */
export type PageTypeSummary = {
  id: number;
  label: string;
  patterns: string[];
  sdType: string | null;
  pageCount: number;
  indexableCount: number;
  sample: { id: number; url: string };
  /** Audit rules hit by this type's pages, most widespread first. */
  issues: { ruleId: string; n: number }[];
};

export type UrlIssue = {
  id: string;
  label: string;
  tab: string;
  severity: 'issue' | 'warning' | 'opportunity';
  priority: 'high' | 'medium' | 'low';
  description: string;
  fix: string;
};

export type UrlDetail = {
  page: Row | null;
  frontier: Row | undefined;
  details: Row | null;
  inlinks: Row[];
  outlinks: Row[];
  images: Row[];
  hreflang: Row[];
  issues: UrlIssue[];
  duplicates: Row[];
  redirectChain: { url: string; status: number }[];
};

export type StartCrawlInput = { crawlId: string; orgId: string; config: CrawlConfig; ai: boolean };

export type SuggestionKind = 'alt' | 'meta';

/**
 * RPC methods. Live progress is not here: the web app opens it with a plain `fetch` to
 * `/ws/{orgId}/{crawlId}` on the same binding, because WebSocket upgrades travel over fetch.
 */
export interface EngineRpc {
  startCrawl(input: StartCrawlInput): Promise<{ doName: string }>;
  control(
    orgId: string,
    crawlId: string,
    action: 'pause' | 'resume' | 'stop',
  ): Promise<CrawlStatus>;
  progress(orgId: string, crawlId: string): Promise<ProgressResult>;
  grid(orgId: string, crawlId: string, q: GridQuery): Promise<GridResult>;
  issues(orgId: string, crawlId: string): Promise<IssueSummary>;
  overview(orgId: string, crawlId: string): Promise<Overview>;
  pageTypes(orgId: string, crawlId: string): Promise<PageTypeSummary[]>;
  /** Group a finished crawl's pages again with the project's current page-type names. */
  regroupPageTypes(orgId: string, crawlId: string, names: PageTypeNames): Promise<number>;
  urlDetail(orgId: string, crawlId: string, urlId: number): Promise<UrlDetail | null>;
  suggest(
    orgId: string,
    crawlId: string,
    urlId: number,
    kind: SuggestionKind,
    imageUrl?: string,
  ): Promise<{ text: string; model: string }>;
  object(orgId: string, crawlId: string, key: string): Promise<Response>;
  purge(orgId: string, crawlId: string): Promise<void>;
  /** The crawl's Workflow instance status, for the watchdog. `unknown` if it doesn't exist. */
  lifecycle(crawlId: string): Promise<{ status: string; error: string | null }>;
}
