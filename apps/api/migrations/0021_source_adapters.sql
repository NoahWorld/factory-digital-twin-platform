-- Rebuild the source and sole referencing table without changing existing data or revisions.

DROP TRIGGER data_sources_runtime_revision_insert;

DROP TRIGGER data_sources_runtime_revision_update;

DROP TRIGGER data_sources_runtime_revision_delete;

DROP TRIGGER asset_data_bindings_runtime_revision_insert;

DROP TRIGGER asset_data_bindings_runtime_revision_update;

DROP TRIGGER asset_data_bindings_runtime_revision_delete;

CREATE TABLE migration_0021_bindings AS SELECT id, asset_id, data_source_id, metric_key, source_path, value_type, unit, stale_after_seconds, created_at, updated_at, transform_json FROM asset_data_bindings;

CREATE TABLE data_sources_new (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  source_type TEXT NOT NULL CHECK (source_type IN ('rest_polling', 'websocket', 'mqtt', 'sqlite_query')),
  name TEXT NOT NULL,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);



INSERT INTO data_sources_new (id, project_id, source_type, name, config_json, created_at, updated_at) SELECT id, project_id, source_type, name, config_json, created_at, updated_at FROM data_sources;

DROP TABLE asset_data_bindings;

DROP TABLE data_sources;

ALTER TABLE data_sources_new RENAME TO data_sources;

CREATE TABLE asset_data_bindings (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  data_source_id TEXT NOT NULL REFERENCES data_sources(id),
  metric_key TEXT NOT NULL,
  source_path TEXT NOT NULL,
  value_type TEXT NOT NULL,
  unit TEXT,
  stale_after_seconds INTEGER NOT NULL CHECK (stale_after_seconds > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  transform_json TEXT CHECK (transform_json IS NULL OR json_valid(transform_json)),
  UNIQUE (asset_id, metric_key)
);



INSERT INTO asset_data_bindings (id, asset_id, data_source_id, metric_key, source_path, value_type, unit, stale_after_seconds, created_at, updated_at, transform_json) SELECT id, asset_id, data_source_id, metric_key, source_path, value_type, unit, stale_after_seconds, created_at, updated_at, transform_json FROM migration_0021_bindings;

DROP TABLE migration_0021_bindings;

CREATE INDEX data_sources_project_id_idx ON data_sources(project_id);

CREATE INDEX asset_data_bindings_source_id_idx ON asset_data_bindings(data_source_id);

CREATE TRIGGER data_sources_runtime_revision_insert AFTER INSERT ON data_sources
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id=NEW.project_id; END;

CREATE TRIGGER data_sources_runtime_revision_update AFTER UPDATE ON data_sources
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id IN (OLD.project_id,NEW.project_id); END;

CREATE TRIGGER data_sources_runtime_revision_delete AFTER DELETE ON data_sources
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id=OLD.project_id; END;

CREATE TRIGGER asset_data_bindings_runtime_revision_insert AFTER INSERT ON asset_data_bindings
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id IN (SELECT project_id FROM assets WHERE id IN (NEW.asset_id)); END;

CREATE TRIGGER asset_data_bindings_runtime_revision_update AFTER UPDATE ON asset_data_bindings
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id IN (SELECT project_id FROM assets WHERE id IN (OLD.asset_id,NEW.asset_id)); END;

CREATE TRIGGER asset_data_bindings_runtime_revision_delete AFTER DELETE ON asset_data_bindings
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id IN (SELECT project_id FROM assets WHERE id IN (OLD.asset_id)); END;
