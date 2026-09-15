CREATE TABLE design_strategies (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  source_brief_revision INTEGER NOT NULL CHECK (source_brief_revision > 0),
  strategy TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
