CREATE TABLE project_alarm_rules (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  config_json TEXT NOT NULL CHECK(json_valid(config_json)),
  updated_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id,id)
);
CREATE TABLE project_alarm_rule_changes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  base_revision INTEGER NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TRIGGER alarm_rules_runtime_insert AFTER INSERT ON project_alarm_rules BEGIN
  UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id=NEW.project_id;
END;
CREATE TRIGGER alarm_rules_runtime_update AFTER UPDATE ON project_alarm_rules BEGIN
  UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id=NEW.project_id;
END;
CREATE TRIGGER alarm_rules_runtime_delete AFTER DELETE ON project_alarm_rules BEGIN
  UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id=OLD.project_id;
END;
