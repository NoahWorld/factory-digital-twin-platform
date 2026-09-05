-- Store the complete visual theme with the canvas revision so previews and covers are reproducible.
ALTER TABLE project_canvases ADD COLUMN theme_preset_id TEXT NOT NULL DEFAULT 'custom'
  CHECK (theme_preset_id IN ('deep-blue', 'steel-orange', 'energy-green', 'command-gold', 'light-industrial', 'custom'));
ALTER TABLE project_canvases ADD COLUMN theme_background_pattern TEXT NOT NULL DEFAULT 'grid'
  CHECK (theme_background_pattern IN ('none', 'grid', 'dots', 'circuit'));
ALTER TABLE project_canvases ADD COLUMN theme_font_family TEXT NOT NULL DEFAULT 'system'
  CHECK (theme_font_family IN ('system', 'industrial', 'data'));
ALTER TABLE project_canvases ADD COLUMN theme_glow_intensity REAL NOT NULL DEFAULT 0
  CHECK (theme_glow_intensity BETWEEN 0 AND 1);
ALTER TABLE project_canvases ADD COLUMN theme_panel_radius REAL NOT NULL DEFAULT 10
  CHECK (theme_panel_radius BETWEEN 0 AND 24);

-- Existing canvases predate named presets. Preserve their previous rendering
-- instead of falsely labelling them as the new deep-blue preset or silently
-- adding new glow/pattern/font choices during an upgrade. New canvases are
-- inserted with the current default theme by the API after this migration.
UPDATE project_canvases
SET theme_preset_id = 'custom',
    theme_background_pattern = 'grid',
    theme_font_family = 'system',
    theme_glow_intensity = 0,
    theme_panel_radius = 10;

-- D1/SQLite CHECK constraints require rebuilding the whitelist table for a new node type.
CREATE TABLE canvas_nodes_next (
  id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES project_canvases(project_id) ON DELETE CASCADE,
  node_type TEXT NOT NULL CHECK (
    node_type IN (
      'line-chart',
      'bar-chart',
      'area-chart',
      'pie-chart',
      'donut-chart',
      'radar-chart',
      'rectangle',
      'circle',
      'screen-title',
      'background-decoration',
      'datetime',
      'section-title',
      'card-background',
      'icon-background',
      'panel-frame',
      'model-3d',
      'metric-card',
      'radial-gauge',
      'progress-list',
      'status-grid',
      'ranking-list',
      'alarm-list',
      'data-table',
      'event-timeline',
      'plain-text',
      'text-link',
      'image',
      'carousel',
      'button',
      'switch',
      'checkbox-group',
      'radio-group',
      'select'
    )
  ),
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL NOT NULL CHECK (width >= 64),
  height REAL NOT NULL CHECK (height >= 48),
  z_index INTEGER NOT NULL CHECK (z_index BETWEEN 0 AND 100000),
  props_json TEXT NOT NULL,
  resource_refs_json TEXT NOT NULL DEFAULT '[]',
  data_binding_refs_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, id)
);

INSERT INTO canvas_nodes_next (
  id,
  project_id,
  node_type,
  x,
  y,
  width,
  height,
  z_index,
  props_json,
  resource_refs_json,
  data_binding_refs_json,
  updated_at
)
SELECT
  id,
  project_id,
  node_type,
  x,
  y,
  width,
  height,
  z_index,
  props_json,
  resource_refs_json,
  data_binding_refs_json,
  updated_at
FROM canvas_nodes;

DROP TABLE canvas_nodes;
ALTER TABLE canvas_nodes_next RENAME TO canvas_nodes;

CREATE INDEX canvas_nodes_project_z_idx ON canvas_nodes(project_id, z_index, id);
