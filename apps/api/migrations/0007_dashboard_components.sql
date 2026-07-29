-- Add reusable dashboard presentation components to the explicit canvas whitelist.
-- Their configuration remains in props_json and is validated by the API before storage.

CREATE TABLE canvas_nodes_next (
  id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES project_canvases(project_id) ON DELETE CASCADE,
  node_type TEXT NOT NULL CHECK (
    node_type IN (
      'line-chart',
      'bar-chart',
      'rectangle',
      'circle',
      'screen-title',
      'background-decoration',
      'datetime',
      'section-title',
      'card-background',
      'icon-background',
      'model-3d',
      'metric-card',
      'radial-gauge',
      'progress-list',
      'status-grid'
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
