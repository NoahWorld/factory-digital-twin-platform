-- Record generated background models as first-class model resources while keeping
-- their source image and deterministic generator configuration traceable.
ALTER TABLE model_assets ADD COLUMN source TEXT NOT NULL DEFAULT 'upload'
  CHECK (source IN ('upload', 'scene-background'));
ALTER TABLE model_assets ADD COLUMN source_image_asset_id TEXT;
ALTER TABLE model_assets ADD COLUMN generation_json TEXT;

CREATE INDEX model_assets_source_image_idx
  ON model_assets(project_id, source_image_asset_id);
