-- Migrate every legacy canvas to a stable main page without changing IDs.
ALTER TABLE project_canvases ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 2;
ALTER TABLE project_canvases ADD COLUMN entry_page_id TEXT NOT NULL DEFAULT 'main';
CREATE TABLE project_pages (
  project_id TEXT NOT NULL REFERENCES project_canvases(project_id) ON DELETE CASCADE,
  id TEXT NOT NULL, name TEXT NOT NULL, position INTEGER NOT NULL,
  width INTEGER NOT NULL, height INTEGER NOT NULL, theme_json TEXT NOT NULL,
  PRIMARY KEY (project_id, id)
);
INSERT INTO project_pages (project_id,id,name,position,width,height,theme_json)
SELECT project_id,'main','首页',0,width,height,json_object(
  'mode',theme_mode,'presetId',theme_preset_id,'backgroundPattern',theme_background_pattern,
  'fontFamily',theme_font_family,'glowIntensity',theme_glow_intensity,'panelRadius',theme_panel_radius,
  'backgroundColor',background_color,'surfaceColor',theme_surface_color,'textColor',theme_text_color,
  'accentColor',theme_accent_color,'borderColor',theme_border_color)
FROM project_canvases;

CREATE TABLE canvas_nodes_m2 (
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
  page_id TEXT NOT NULL DEFAULT 'main',
  group_id TEXT,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, page_id) REFERENCES project_pages(project_id, id) ON DELETE CASCADE
);
INSERT INTO canvas_nodes_m2 (id,project_id,node_type,x,y,width,height,z_index,props_json,resource_refs_json,data_binding_refs_json,updated_at,page_id)
SELECT id,project_id,node_type,x,y,width,height,z_index,props_json,resource_refs_json,data_binding_refs_json,updated_at,'main' FROM canvas_nodes;
DROP TABLE canvas_nodes;
ALTER TABLE canvas_nodes_m2 RENAME TO canvas_nodes;
CREATE INDEX canvas_nodes_project_z_idx ON canvas_nodes(project_id,z_index,id);
CREATE INDEX canvas_nodes_page_idx ON canvas_nodes(project_id,page_id,z_index,id);
