-- Keep existing projects as 2D dashboards and introduce a first-class 3D scene
-- workspace. Scene instances are normalized rows so large scene edits do not
-- rewrite a canvas node JSON document.

ALTER TABLE projects
  ADD COLUMN project_type TEXT NOT NULL DEFAULT '2d'
  CHECK (project_type IN ('2d', '3d'));

CREATE TABLE standalone_3d_scenes (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  linked_2d_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  background_color TEXT NOT NULL DEFAULT '#071525',
  background_opacity REAL NOT NULL DEFAULT 1 CHECK (background_opacity BETWEEN 0 AND 1),
  environment_light_color TEXT NOT NULL DEFAULT '#daf4ff',
  environment_light_intensity REAL NOT NULL DEFAULT 2.1 CHECK (environment_light_intensity BETWEEN 0 AND 10),
  key_light_color TEXT NOT NULL DEFAULT '#ffffff',
  key_light_intensity REAL NOT NULL DEFAULT 2.4 CHECK (key_light_intensity BETWEEN 0 AND 10),
  camera_fov REAL NOT NULL DEFAULT 42 CHECK (camera_fov BETWEEN 15 AND 90),
  camera_view TEXT NOT NULL DEFAULT 'isometric'
    CHECK (camera_view IN ('isometric', 'isometric-left', 'front', 'top')),
  model_scale REAL NOT NULL DEFAULT 1 CHECK (model_scale BETWEEN 0.25 AND 4),
  auto_rotate INTEGER NOT NULL DEFAULT 0 CHECK (auto_rotate IN (0, 1)),
  rotation_speed REAL NOT NULL DEFAULT 0.35 CHECK (rotation_speed BETWEEN 0 AND 5),
  play_animations INTEGER NOT NULL DEFAULT 1 CHECK (play_animations IN (0, 1)),
  animation_speed REAL NOT NULL DEFAULT 1 CHECK (animation_speed BETWEEN 0.1 AND 3),
  show_grid INTEGER NOT NULL DEFAULT 1 CHECK (show_grid IN (0, 1)),
  updated_by_user_id TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL
);

CREATE TABLE standalone_3d_instances (
  id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES standalone_3d_scenes(project_id) ON DELETE CASCADE,
  model_asset_id TEXT NOT NULL,
  business_asset_key TEXT,
  label TEXT NOT NULL,
  render_mode TEXT NOT NULL DEFAULT 'interactive'
    CHECK (render_mode IN ('background', 'interactive')),
  visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
  position_x REAL NOT NULL DEFAULT 0,
  position_y REAL NOT NULL DEFAULT 0,
  position_z REAL NOT NULL DEFAULT 0,
  rotation_x REAL NOT NULL DEFAULT 0,
  rotation_y REAL NOT NULL DEFAULT 0,
  rotation_z REAL NOT NULL DEFAULT 0,
  scale_x REAL NOT NULL DEFAULT 1 CHECK (scale_x BETWEEN 0.001 AND 1000),
  scale_y REAL NOT NULL DEFAULT 1 CHECK (scale_y BETWEEN 0.001 AND 1000),
  scale_z REAL NOT NULL DEFAULT 1 CHECK (scale_z BETWEEN 0.001 AND 1000),
  sort_order INTEGER NOT NULL CHECK (sort_order BETWEEN 0 AND 100000),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, id)
);

CREATE INDEX standalone_3d_instances_project_order_idx
  ON standalone_3d_instances(project_id, sort_order, id);

CREATE INDEX standalone_3d_instances_model_asset_idx
  ON standalone_3d_instances(project_id, model_asset_id);

CREATE INDEX standalone_3d_instances_business_asset_idx
  ON standalone_3d_instances(project_id, business_asset_key);
