-- Raisin control plane. Mirrors packages/db/src/schema.ts column for column.
-- Timestamps are Unix epoch milliseconds.

-- Better Auth core + organization plugin -------------------------------------

CREATE TABLE user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE session (
  id TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  ip_address TEXT,
  user_agent TEXT,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  active_organization_id TEXT
);
CREATE INDEX session_user_idx ON session (user_id);

CREATE TABLE account (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at INTEGER,
  refresh_token_expires_at INTEGER,
  scope TEXT,
  password TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX account_user_idx ON account (user_id);

CREATE TABLE verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX verification_identifier_idx ON verification (identifier);

CREATE TABLE organization (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  logo TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  metadata TEXT
);

CREATE TABLE member (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX member_org_idx ON member (organization_id);
CREATE INDEX member_user_idx ON member (user_id);

CREATE TABLE invitation (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  inviter_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX invitation_org_idx ON invitation (organization_id);
CREATE INDEX invitation_email_idx ON invitation (email);

-- Raisin -----------------------------------------------------------------------

CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  max_urls_per_crawl INTEGER NOT NULL,
  max_urls_per_second INTEGER NOT NULL,
  max_projects INTEGER NOT NULL,
  max_concurrent_crawls INTEGER NOT NULL,
  monthly_urls INTEGER NOT NULL,
  monthly_rendered_pages INTEGER NOT NULL,
  monthly_ai_calls INTEGER NOT NULL,
  rendering INTEGER NOT NULL,
  ai INTEGER NOT NULL,
  schedules INTEGER NOT NULL,
  api INTEGER NOT NULL,
  retention_days INTEGER NOT NULL
);

INSERT INTO plans VALUES
  ('free',   'Free',    500,    2,   1,  1,     5000,      0,      0, 0, 0, 0, 0,  7),
  ('pro',    'Pro',     100000, 10,  10, 2,   500000,  25000,   5000, 1, 1, 1, 0, 90),
  ('agency', 'Agency',  400000, 25, 100, 5,  4000000, 200000,  50000, 1, 1, 1, 1, 365);

CREATE TABLE org_plans (
  organization_id TEXT PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  billing_customer_id TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  start_url TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  verification_token TEXT NOT NULL,
  verified_at INTEGER,
  verified_method TEXT,
  created_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX projects_org_idx ON projects (organization_id);

CREATE TABLE crawls (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  start_url TEXT NOT NULL,
  config_json TEXT NOT NULL,
  do_name TEXT NOT NULL,
  trigger TEXT NOT NULL DEFAULT 'manual',
  urls_discovered INTEGER NOT NULL DEFAULT 0,
  urls_crawled INTEGER NOT NULL DEFAULT 0,
  rendered_pages INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT,
  export_key TEXT,
  error TEXT,
  created_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  started_at INTEGER,
  finished_at INTEGER
);
CREATE INDEX crawls_org_idx ON crawls (organization_id, created_at);
CREATE INDEX crawls_project_idx ON crawls (project_id, created_at);
CREATE INDEX crawls_status_idx ON crawls (status);

CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL,
  hour_utc INTEGER NOT NULL DEFAULT 3,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at INTEGER NOT NULL,
  last_run_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE UNIQUE INDEX schedules_project_idx ON schedules (project_id);
CREATE INDEX schedules_due_idx ON schedules (enabled, next_run_at);

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  created_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX api_keys_org_idx ON api_keys (organization_id);

CREATE TABLE usage (
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  crawled_urls INTEGER NOT NULL DEFAULT 0,
  rendered_pages INTEGER NOT NULL DEFAULT 0,
  ai_calls INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, period)
);
