-- Canvas themes are metadata. Component-specific color properties remain on
-- individual nodes so one theme change can be persisted as an explicit,
-- revision-checked node patch. 3D node settings are intentionally independent.

ALTER TABLE project_canvases
ADD COLUMN theme_mode TEXT NOT NULL DEFAULT 'dark'
CHECK (theme_mode IN ('dark', 'light', 'custom'));

ALTER TABLE project_canvases
ADD COLUMN theme_surface_color TEXT NOT NULL DEFAULT '#0b2638';

ALTER TABLE project_canvases
ADD COLUMN theme_text_color TEXT NOT NULL DEFAULT '#eafaff';

ALTER TABLE project_canvases
ADD COLUMN theme_accent_color TEXT NOT NULL DEFAULT '#55d8ff';

ALTER TABLE project_canvases
ADD COLUMN theme_border_color TEXT NOT NULL DEFAULT '#286783';

-- A previously customized background cannot be represented honestly as the
-- built-in dark preset, so retain it as a custom theme after migration.
UPDATE project_canvases
SET theme_mode = 'custom'
WHERE lower(background_color) <> '#071525';
