ALTER TABLE project_canvases ADD COLUMN interactions_json TEXT NOT NULL DEFAULT '{"states":[],"rules":[]}';
-- Existing schema versions migrate through the shared parser on read.
-- New writes persist schema v4 and the interaction definition in the root CAS.
