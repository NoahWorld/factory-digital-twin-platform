ALTER TABLE model_assets ADD COLUMN family_id TEXT;
ALTER TABLE model_assets ADD COLUMN version_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE model_assets ADD COLUMN previous_version_id TEXT REFERENCES model_assets(id);
UPDATE model_assets SET family_id = id WHERE family_id IS NULL;
CREATE UNIQUE INDEX model_assets_family_version_idx ON model_assets(project_id, family_id, version_number);
CREATE TRIGGER model_assets_legacy_family AFTER INSERT ON model_assets
WHEN NEW.family_id IS NULL
BEGIN
  UPDATE model_assets SET family_id = NEW.id WHERE id = NEW.id;
END;
