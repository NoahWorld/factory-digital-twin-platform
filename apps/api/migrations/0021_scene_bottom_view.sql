-- Existing and new scenes default to upper-hemisphere orbit navigation.
ALTER TABLE standalone_3d_scenes ADD COLUMN prevent_bottom_view INTEGER NOT NULL DEFAULT 1
  CHECK (prevent_bottom_view IN (0, 1));
