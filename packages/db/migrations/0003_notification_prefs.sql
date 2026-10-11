-- Per-user email preferences. A missing row means the defaults (all on).
CREATE TABLE notification_prefs (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  crawl_finished INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
