-- Canvas metadata and nodes are stored separately so moving one component does
-- not require rewriting an entire dashboard document. Binary resources and
-- live data remain outside D1 and are referenced by stable IDs only.

CREATE TABLE project_canvases (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  width INTEGER NOT NULL DEFAULT 1920 CHECK (width BETWEEN 320 AND 7680),
  height INTEGER NOT NULL DEFAULT 1080 CHECK (height BETWEEN 240 AND 4320),
  background_color TEXT NOT NULL DEFAULT '#071525',
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_by_user_id TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL
);

CREATE TABLE canvas_nodes (
  id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES project_canvases(project_id) ON DELETE CASCADE,
  node_type TEXT NOT NULL CHECK (node_type IN ('line-chart', 'bar-chart')),
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL NOT NULL CHECK (width >= 240),
  height REAL NOT NULL CHECK (height >= 160),
  z_index INTEGER NOT NULL CHECK (z_index BETWEEN 0 AND 100000),
  props_json TEXT NOT NULL,
  resource_refs_json TEXT NOT NULL DEFAULT '[]',
  data_binding_refs_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, id)
);

CREATE INDEX canvas_nodes_project_z_idx ON canvas_nodes(project_id, z_index, id);
