CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE project_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_number INTEGER NOT NULL,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, version_number)
);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  asset_key TEXT NOT NULL,
  model_node TEXT,
  name TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, asset_key),
  UNIQUE (project_id, model_node)
);

CREATE TABLE data_sources (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  source_type TEXT NOT NULL CHECK (source_type IN ('rest_polling', 'websocket')),
  name TEXT NOT NULL,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

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
  UNIQUE (asset_id, metric_key)
);

CREATE INDEX project_versions_project_id_idx ON project_versions(project_id);
CREATE INDEX assets_project_id_idx ON assets(project_id);
CREATE INDEX data_sources_project_id_idx ON data_sources(project_id);
CREATE INDEX asset_data_bindings_source_id_idx ON asset_data_bindings(data_source_id);
