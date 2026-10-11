-- Names people give page types, per project and URL pattern. Grouping applies them to every
-- crawl of the project, so a correction made once carries over to the next crawl.
CREATE TABLE page_type_names (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  name TEXT NOT NULL,
  updated_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (project_id, pattern)
);
