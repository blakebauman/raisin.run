/**
 * D1 control plane. Holds tenants and crawl metadata only — never per-URL data, which lives in
 * each crawl's Durable Object. Must match migrations/0001_init.sql column for column.
 *
 * The first block mirrors Better Auth's core and organization-plugin models; property names are
 * the field names Better Auth expects, columns are snake_case.
 */

import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const ts = (name: string) => integer(name, { mode: 'timestamp_ms' });
const now = sql`(unixepoch() * 1000)`;

// ── Better Auth ──────────────────────────────────────────────────────────────

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: ts('created_at').notNull().default(now),
  updatedAt: ts('updated_at').notNull().default(now),
});

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: ts('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: ts('created_at').notNull().default(now),
    updatedAt: ts('updated_at').notNull().default(now),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    activeOrganizationId: text('active_organization_id'),
  },
  (t) => [index('session_user_idx').on(t.userId)],
);

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: ts('access_token_expires_at'),
    refreshTokenExpiresAt: ts('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: ts('created_at').notNull().default(now),
    updatedAt: ts('updated_at').notNull().default(now),
  },
  (t) => [index('account_user_idx').on(t.userId)],
);

export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull().default(now),
    updatedAt: ts('updated_at').notNull().default(now),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

export const organization = sqliteTable('organization', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  createdAt: ts('created_at').notNull().default(now),
  metadata: text('metadata'),
});

export const member = sqliteTable(
  'member',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    createdAt: ts('created_at').notNull().default(now),
  },
  (t) => [index('member_org_idx').on(t.organizationId), index('member_user_idx').on(t.userId)],
);

export const invitation = sqliteTable(
  'invitation',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role'),
    status: text('status').notNull().default('pending'),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull().default(now),
    inviterId: text('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [
    index('invitation_org_idx').on(t.organizationId),
    index('invitation_email_idx').on(t.email),
  ],
);

// ── Raisin ───────────────────────────────────────────────────────────────────

export type PlanId = 'free' | 'pro' | 'agency';

export const plans = sqliteTable('plans', {
  id: text('id').$type<PlanId>().primaryKey(),
  name: text('name').notNull(),
  maxUrlsPerCrawl: integer('max_urls_per_crawl').notNull(),
  maxUrlsPerSecond: integer('max_urls_per_second').notNull(),
  maxProjects: integer('max_projects').notNull(),
  maxConcurrentCrawls: integer('max_concurrent_crawls').notNull(),
  monthlyUrls: integer('monthly_urls').notNull(),
  monthlyRenderedPages: integer('monthly_rendered_pages').notNull(),
  monthlyAiCalls: integer('monthly_ai_calls').notNull(),
  rendering: integer('rendering', { mode: 'boolean' }).notNull(),
  ai: integer('ai', { mode: 'boolean' }).notNull(),
  schedules: integer('schedules', { mode: 'boolean' }).notNull(),
  api: integer('api', { mode: 'boolean' }).notNull(),
  retentionDays: integer('retention_days').notNull(),
});

export const orgPlans = sqliteTable('org_plans', {
  organizationId: text('organization_id')
    .primaryKey()
    .references(() => organization.id, { onDelete: 'cascade' }),
  planId: text('plan_id')
    .$type<PlanId>()
    .notNull()
    .references(() => plans.id),
  billingCustomerId: text('billing_customer_id'),
  billingSubscriptionId: text('billing_subscription_id'),
  /** Stripe subscription status, e.g. active, trialing, past_due, canceled. */
  billingStatus: text('billing_status'),
  billingPeriodEnd: ts('billing_period_end'),
  billingCancelAtPeriodEnd: integer('billing_cancel_at_period_end', { mode: 'boolean' })
    .notNull()
    .default(false),
  updatedAt: ts('updated_at').notNull().default(now),
});

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    host: text('host').notNull(),
    startUrl: text('start_url').notNull(),
    /** Saved CrawlConfig overrides, JSON. */
    configJson: text('config_json').notNull().default('{}'),
    verificationToken: text('verification_token').notNull(),
    verifiedAt: ts('verified_at'),
    verifiedMethod: text('verified_method'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().default(now),
  },
  (t) => [index('projects_org_idx').on(t.organizationId)],
);

export type CrawlRowStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'stopping'
  | 'analysing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export const crawls = sqliteTable(
  'crawls',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    status: text('status').$type<CrawlRowStatus>().notNull().default('queued'),
    startUrl: text('start_url').notNull(),
    configJson: text('config_json').notNull(),
    doName: text('do_name').notNull(),
    trigger: text('trigger').$type<'manual' | 'schedule' | 'api'>().notNull().default('manual'),
    urlsDiscovered: integer('urls_discovered').notNull().default(0),
    urlsCrawled: integer('urls_crawled').notNull().default(0),
    renderedPages: integer('rendered_pages').notNull().default(0),
    /** `{ issue, warning, opportunity, byRule: { [ruleId]: count } }`, written at completion. */
    summaryJson: text('summary_json'),
    exportKey: text('export_key'),
    error: text('error'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().default(now),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
  },
  (t) => [
    index('crawls_org_idx').on(t.organizationId, t.createdAt),
    index('crawls_project_idx').on(t.projectId, t.createdAt),
    index('crawls_status_idx').on(t.status),
  ],
);

export const schedules = sqliteTable(
  'schedules',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    frequency: text('frequency').$type<'daily' | 'weekly' | 'monthly'>().notNull(),
    hourUtc: integer('hour_utc').notNull().default(3),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    nextRunAt: ts('next_run_at').notNull(),
    lastRunAt: ts('last_run_at'),
    createdAt: ts('created_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('schedules_project_idx').on(t.projectId),
    index('schedules_due_idx').on(t.enabled, t.nextRunAt),
  ],
);

export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** First characters of the key, shown in the UI so people can tell keys apart. */
    prefix: text('prefix').notNull(),
    /** SHA-256 of the full key, hex. The key itself is shown once and never stored. */
    hash: text('hash').notNull().unique(),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().default(now),
    lastUsedAt: ts('last_used_at'),
    revokedAt: ts('revoked_at'),
  },
  (t) => [index('api_keys_org_idx').on(t.organizationId)],
);

export const usage = sqliteTable(
  'usage',
  {
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** `YYYY-MM`, UTC. */
    period: text('period').notNull(),
    crawledUrls: integer('crawled_urls').notNull().default(0),
    renderedPages: integer('rendered_pages').notNull().default(0),
    aiCalls: integer('ai_calls').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.period] })],
);

/** Per-user email preferences. A missing row means the defaults (all on). */
export const notificationPrefs = sqliteTable('notification_prefs', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  crawlFinished: integer('crawl_finished', { mode: 'boolean' }).notNull().default(true),
  updatedAt: ts('updated_at').notNull().default(now),
});

/**
 * Names people give page types, per project and URL pattern. Grouping applies them to every crawl
 * of the project (see `groupPageTypes` in @raisin/core).
 */
export const pageTypeNames = sqliteTable(
  'page_type_names',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    pattern: text('pattern').notNull(),
    name: text('name').notNull(),
    updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
    updatedAt: ts('updated_at').notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.pattern] })],
);

export const authSchema = {
  user,
  session,
  account,
  verification,
  organization,
  member,
  invitation,
};
