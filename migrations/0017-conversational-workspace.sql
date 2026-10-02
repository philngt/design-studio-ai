ALTER TABLE agent_sessions ADD COLUMN purpose TEXT NOT NULL DEFAULT 'design' CHECK(purpose IN ('interview','design'));

CREATE TABLE brief_history (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  brief TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id, revision)
);
INSERT INTO brief_history(project_id,user_id,revision,brief,created_at)
  SELECT project_id,user_id,revision,brief,updated_at FROM design_briefs;

-- Capture only committed brief revisions, in the same transaction as the write.
CREATE TRIGGER brief_history_insert AFTER INSERT ON design_briefs BEGIN
  INSERT INTO brief_history(project_id,user_id,revision,brief,created_at)
    VALUES(NEW.project_id,NEW.user_id,NEW.revision,NEW.brief,NEW.updated_at);
END;
CREATE TRIGGER brief_history_update AFTER UPDATE OF revision ON design_briefs BEGIN
  INSERT INTO brief_history(project_id,user_id,revision,brief,created_at)
    VALUES(NEW.project_id,NEW.user_id,NEW.revision,NEW.brief,NEW.updated_at);
END;
