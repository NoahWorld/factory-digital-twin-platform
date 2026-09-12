CREATE TABLE project_scenes (
  project_id TEXT NOT NULL REFERENCES project_canvases(project_id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  position INTEGER NOT NULL,
  config_json TEXT NOT NULL,
  PRIMARY KEY (project_id, id)
);
ALTER TABLE canvas_nodes ADD COLUMN scene_id TEXT;
CREATE TABLE asset_model_bindings (
  project_id TEXT NOT NULL,
  scene_id TEXT NOT NULL,
  id TEXT NOT NULL,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  instance_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  PRIMARY KEY (project_id, id),
  UNIQUE (project_id, scene_id, instance_id, object_id),
  FOREIGN KEY (project_id, scene_id) REFERENCES project_scenes(project_id, id) ON DELETE CASCADE
);
UPDATE project_canvases SET schema_version = 3;
