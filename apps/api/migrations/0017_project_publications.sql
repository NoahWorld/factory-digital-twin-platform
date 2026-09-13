-- Publishing freezes all runtime configuration, not only the canvas revision.
ALTER TABLE projects ADD COLUMN runtime_revision INTEGER NOT NULL DEFAULT 0 CHECK (runtime_revision >= 0);
ALTER TABLE project_versions ADD COLUMN snapshot_sha256 TEXT;
ALTER TABLE project_versions ADD COLUMN source_revision INTEGER;
ALTER TABLE project_versions ADD COLUMN created_by TEXT REFERENCES users(id);
ALTER TABLE project_versions ADD COLUMN label TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX project_versions_project_identity_idx ON project_versions(project_id,id);

CREATE TABLE project_publications (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id,version_id) REFERENCES project_versions(project_id,id) ON DELETE RESTRICT
);
CREATE TABLE project_version_model_assets (
  version_id TEXT NOT NULL REFERENCES project_versions(id) ON DELETE CASCADE,
  model_asset_id TEXT NOT NULL REFERENCES model_assets(id) ON DELETE RESTRICT,
  PRIMARY KEY (version_id,model_asset_id)
);
CREATE INDEX project_version_models_asset_idx ON project_version_model_assets(model_asset_id);
CREATE TABLE project_version_image_assets (
  version_id TEXT NOT NULL REFERENCES project_versions(id) ON DELETE CASCADE,
  image_asset_id TEXT NOT NULL REFERENCES image_assets(id) ON DELETE RESTRICT,
  PRIMARY KEY (version_id,image_asset_id)
);
CREATE INDEX project_version_images_asset_idx ON project_version_image_assets(image_asset_id);
CREATE TRIGGER project_versions_immutable BEFORE UPDATE ON project_versions
BEGIN SELECT RAISE(ABORT,'Published version records are immutable'); END;

CREATE TRIGGER project_name_runtime_revision AFTER UPDATE OF name ON projects
WHEN OLD.name IS NOT NEW.name
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id=NEW.id; END;

CREATE TRIGGER project_canvases_runtime_revision_insert AFTER INSERT ON project_canvases
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id=NEW.project_id; END;

CREATE TRIGGER project_canvases_runtime_revision_update AFTER UPDATE ON project_canvases
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id IN (OLD.project_id,NEW.project_id); END;

CREATE TRIGGER project_canvases_runtime_revision_delete AFTER DELETE ON project_canvases
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id=OLD.project_id; END;

CREATE TRIGGER project_pages_runtime_revision_insert AFTER INSERT ON project_pages
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id=NEW.project_id; END;

CREATE TRIGGER project_pages_runtime_revision_update AFTER UPDATE ON project_pages
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id IN (OLD.project_id,NEW.project_id); END;

CREATE TRIGGER project_pages_runtime_revision_delete AFTER DELETE ON project_pages
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id=OLD.project_id; END;

CREATE TRIGGER canvas_nodes_runtime_revision_insert AFTER INSERT ON canvas_nodes
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id=NEW.project_id; END;

CREATE TRIGGER canvas_nodes_runtime_revision_update AFTER UPDATE ON canvas_nodes
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id IN (OLD.project_id,NEW.project_id); END;

CREATE TRIGGER canvas_nodes_runtime_revision_delete AFTER DELETE ON canvas_nodes
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id=OLD.project_id; END;

CREATE TRIGGER component_data_bindings_runtime_revision_insert AFTER INSERT ON component_data_bindings
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id=NEW.project_id; END;

CREATE TRIGGER component_data_bindings_runtime_revision_update AFTER UPDATE ON component_data_bindings
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id IN (OLD.project_id,NEW.project_id); END;

CREATE TRIGGER component_data_bindings_runtime_revision_delete AFTER DELETE ON component_data_bindings
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id=OLD.project_id; END;

CREATE TRIGGER project_scenes_runtime_revision_insert AFTER INSERT ON project_scenes
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id=NEW.project_id; END;

CREATE TRIGGER project_scenes_runtime_revision_update AFTER UPDATE ON project_scenes
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id IN (OLD.project_id,NEW.project_id); END;

CREATE TRIGGER project_scenes_runtime_revision_delete AFTER DELETE ON project_scenes
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id=OLD.project_id; END;

CREATE TRIGGER asset_model_bindings_runtime_revision_insert AFTER INSERT ON asset_model_bindings
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id=NEW.project_id; END;

CREATE TRIGGER asset_model_bindings_runtime_revision_update AFTER UPDATE ON asset_model_bindings
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id IN (OLD.project_id,NEW.project_id); END;

CREATE TRIGGER asset_model_bindings_runtime_revision_delete AFTER DELETE ON asset_model_bindings
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id=OLD.project_id; END;

CREATE TRIGGER assets_runtime_revision_insert AFTER INSERT ON assets
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id=NEW.project_id; END;

CREATE TRIGGER assets_runtime_revision_update AFTER UPDATE ON assets
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id IN (OLD.project_id,NEW.project_id); END;

CREATE TRIGGER assets_runtime_revision_delete AFTER DELETE ON assets
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id=OLD.project_id; END;

CREATE TRIGGER data_sources_runtime_revision_insert AFTER INSERT ON data_sources
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id=NEW.project_id; END;

CREATE TRIGGER data_sources_runtime_revision_update AFTER UPDATE ON data_sources
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id IN (OLD.project_id,NEW.project_id); END;

CREATE TRIGGER data_sources_runtime_revision_delete AFTER DELETE ON data_sources
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id=OLD.project_id; END;

CREATE TRIGGER model_assets_runtime_revision_insert AFTER INSERT ON model_assets
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id=NEW.project_id; END;

CREATE TRIGGER model_assets_runtime_revision_update AFTER UPDATE ON model_assets
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id IN (OLD.project_id,NEW.project_id); END;

CREATE TRIGGER model_assets_runtime_revision_delete AFTER DELETE ON model_assets
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id=OLD.project_id; END;

CREATE TRIGGER image_assets_runtime_revision_insert AFTER INSERT ON image_assets
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id=NEW.project_id; END;

CREATE TRIGGER image_assets_runtime_revision_update AFTER UPDATE ON image_assets
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id IN (OLD.project_id,NEW.project_id); END;

CREATE TRIGGER image_assets_runtime_revision_delete AFTER DELETE ON image_assets
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id=OLD.project_id; END;

CREATE TRIGGER asset_data_bindings_runtime_revision_insert AFTER INSERT ON asset_data_bindings
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id IN (SELECT project_id FROM assets WHERE id IN (NEW.asset_id)); END;

CREATE TRIGGER asset_data_bindings_runtime_revision_update AFTER UPDATE ON asset_data_bindings
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id IN (SELECT project_id FROM assets WHERE id IN (OLD.asset_id,NEW.asset_id)); END;

CREATE TRIGGER asset_data_bindings_runtime_revision_delete AFTER DELETE ON asset_data_bindings
BEGIN UPDATE projects SET runtime_revision=runtime_revision+1 WHERE id IN (SELECT project_id FROM assets WHERE id IN (OLD.asset_id)); END;
