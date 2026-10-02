CREATE TABLE agent_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  native_handle TEXT,
  draft_document TEXT NOT NULL,
  draft_version INTEGER NOT NULL DEFAULT 0,
  has_proposal INTEGER NOT NULL DEFAULT 0,
  base_revision INTEGER NOT NULL,
  base_brief_revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX agent_sessions_project ON agent_sessions(project_id, user_id, created_at);
CREATE UNIQUE INDEX agent_project_running ON agent_sessions(project_id) WHERE status IN ('running','waiting_permission','stopping','applying');
CREATE TABLE agent_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(session_id, request_id)
);
CREATE TABLE agent_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX agent_events_session ON agent_events(session_id, seq);
