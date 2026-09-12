-- Component bindings belong to the same canvas revision, separate from node props
-- and asset_data_bindings (which own upstream field mappings).
CREATE TABLE component_data_bindings (
  project_id TEXT NOT NULL REFERENCES project_canvases(project_id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  config_json TEXT NOT NULL,
  PRIMARY KEY (project_id, id)
);
