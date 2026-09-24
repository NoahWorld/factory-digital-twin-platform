-- Procedural fluid configuration shares the scene revision and atomic scene patch.
ALTER TABLE standalone_3d_scenes ADD COLUMN fluids_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(fluids_json) AND json_type(fluids_json) = 'array');
