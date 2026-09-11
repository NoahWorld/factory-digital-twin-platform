-- Add the fullscreen toggle control to the persisted canvas node whitelist.
-- Runtime behavior stays in the web renderer; persisted nodes contain only
-- labels, appearance values, and the disabled state.

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
      'radar-sweep',
      'data-stream',
      'circuit-pulse',
      'energy-core',
      'industrial-flow',
      'scan-grid',
      'datetime',
      'section-title',
      'card-background',
      'icon-background',
      'panel-frame',
      'card-title',
      'vector-icon',
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
      'fullscreen-toggle',
      'switch',
      'checkbox-group',
      'radio-group',
      'select'
    )
  ),
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL NOT NULL CHECK (width >= 24),
  height REAL NOT NULL CHECK (height >= 24),
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
