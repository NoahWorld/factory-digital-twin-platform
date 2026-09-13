CREATE TABLE metric_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  config_revision INTEGER NOT NULL CHECK(config_revision >= 0),
  sample_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  asset_record_id TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  source_id TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  value_json TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK(value_type IN ('number','string','boolean','timestamp')),
  unit TEXT,
  source_timestamp TEXT,
  collected_at TEXT NOT NULL,
  quality TEXT NOT NULL CHECK(quality IN ('good','missing','stale','error')),
  error_code TEXT,
  UNIQUE(project_id,scope_id,sample_id,binding_id)
);
CREATE INDEX metric_history_scope_time ON metric_history(project_id,scope_id,collected_at,id);
CREATE INDEX metric_history_scope_id ON metric_history(project_id,scope_id,id);
CREATE INDEX metric_history_retention ON metric_history(collected_at);
CREATE TABLE telemetry_health (
  project_id TEXT PRIMARY KEY,
  dropped INTEGER NOT NULL DEFAULT 0,
  last_persisted_at TEXT,
  error_code TEXT
);
