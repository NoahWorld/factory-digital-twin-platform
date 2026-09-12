import { AppError, type AppEnv, type DatabaseResult } from "./auth";
import { listComponentBindings, validateComponentReferences } from "./component-data-bindings";
import { DEFAULT_WIDTH, DEFAULT_HEIGHT, DEFAULT_THEME, parseCanvasDocument, validateCanvasTheme, validateNode, type CanvasDocument, type CanvasPatch, type CanvasNode, type CanvasTheme, type Model3DProps, type CanvasThemeMode, type CanvasThemePresetId, type CanvasBackgroundPattern, type CanvasFontFamily, type CanvasNodeType } from "../../../shared/canvas-schema";
export * from "../../../shared/canvas-schema";

type CanvasRow = {
  project_id: string;
  width: number;
  height: number;
  background_color: string;
  theme_mode: CanvasThemeMode;
  theme_preset_id: CanvasThemePresetId;
  theme_background_pattern: CanvasBackgroundPattern;
  theme_font_family: CanvasFontFamily;
  theme_glow_intensity: number;
  theme_panel_radius: number;
  theme_surface_color: string;
  theme_text_color: string;
  theme_accent_color: string;
  theme_border_color: string;
  revision: number;
  updated_at: string;
};

type CanvasNodeRow = {
  id: string;
  node_type: CanvasNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  z_index: number;
  props_json: string;
  resource_refs_json: string;
  data_binding_refs_json: string;
};

const presentStoredTheme = (row: CanvasRow): CanvasTheme => {
  try {
    return validateCanvasTheme({
      mode: row.theme_mode,
      presetId: row.theme_preset_id,
      backgroundPattern: row.theme_background_pattern,
      fontFamily: row.theme_font_family,
      glowIntensity: row.theme_glow_intensity,
      panelRadius: row.theme_panel_radius,
      backgroundColor: row.background_color,
      surfaceColor: row.theme_surface_color,
      textColor: row.theme_text_color,
      accentColor: row.theme_accent_color,
      borderColor: row.theme_border_color,
    });
  } catch (error) {
    if (error instanceof AppError && error.status === 400) {
      throw new AppError(
        500,
        "invalid_canvas_storage",
        `Stored canvas ${row.project_id} has an invalid theme: ${error.message}`,
      );
    }
    throw error;
  }
};

const parseStoredArray = (json: string, label: string): unknown[] => {
  try {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value)) throw new Error("not an array");
    return value;
  } catch (error) {
    throw new AppError(500, "invalid_canvas_storage", `${label} contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const presentStoredNode = (row: CanvasNodeRow): CanvasNode => {
  let props: unknown;
  try {
    props = JSON.parse(row.props_json);
  } catch (error) {
    throw new AppError(500, "invalid_canvas_storage", `Node ${row.id} has invalid props JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return validateNode({
      id: row.id, type: row.node_type, x: row.x, y: row.y, width: row.width, height: row.height,
      zIndex: row.z_index, props, resourceRefs: parseStoredArray(row.resource_refs_json, `Node ${row.id} resource refs`),
      dataBindingRefs: parseStoredArray(row.data_binding_refs_json, `Node ${row.id} data binding refs`),
    });
  } catch (error) {
    if (error instanceof AppError && error.status === 400) {
      throw new AppError(500, "invalid_canvas_storage", `Stored node ${row.id} violates the canvas schema: ${error.message}`);
    }
    throw error;
  }
};

export const getCanvas = async (env: AppEnv, projectId: string): Promise<CanvasDocument> => {
  const canvas = await env.DB.prepare(
    `SELECT project_id, width, height, background_color, theme_mode, theme_preset_id,
       theme_background_pattern, theme_font_family, theme_glow_intensity, theme_panel_radius,
       theme_surface_color, theme_text_color, theme_accent_color, theme_border_color, revision, updated_at
     FROM project_canvases WHERE project_id = ?`,
  ).bind(projectId).first<CanvasRow>();
  if (!canvas) {
    return parseCanvasDocument({ schemaVersion: 1, projectId, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, theme: { ...DEFAULT_THEME }, revision: 0, updatedAt: null, nodes: [], dataBindings: [] });
  }
  const rows = await env.DB.prepare(
    `SELECT id, node_type, x, y, width, height, z_index, props_json, resource_refs_json, data_binding_refs_json
     FROM canvas_nodes WHERE project_id = ? ORDER BY z_index ASC, id ASC`,
  ).bind(projectId).all<CanvasNodeRow>();
  const document = {
    schemaVersion: 1, projectId: canvas.project_id, width: canvas.width, height: canvas.height,
    theme: presentStoredTheme(canvas),
    revision: canvas.revision, updatedAt: canvas.updated_at,
    nodes: rows.results.map(presentStoredNode),
    dataBindings: await listComponentBindings(env, projectId),
  };
  try { return parseCanvasDocument(document); }
  catch (error) { throw new AppError(500, "invalid_canvas_storage", `Stored canvas is invalid: ${error instanceof Error ? error.message : String(error)}`); }
};

const changes = (result: DatabaseResult | undefined): number => {
  const count = result?.meta?.changes;
  if (typeof count !== "number") {
    throw new AppError(500, "missing_database_result", "D1 did not report the canvas revision update result.");
  }
  return count;
};

export const applyCanvasPatch = async (
  env: AppEnv,
  projectId: string,
  userId: string,
  patch: CanvasPatch,
): Promise<CanvasDocument> => {
  const current = await getCanvas(env, projectId);
  if (current.revision !== patch.expectedRevision) {
    throw new AppError(409, "canvas_revision_conflict", "The canvas changed since it was loaded. Reload it before saving again.");
  }
  const finalNodes = new Map(current.nodes.map((node) => [node.id, node]));
  patch.deleteNodeIds.forEach((id) => finalNodes.delete(id));
  patch.upsertNodes.forEach((node) => finalNodes.set(node.id, node));
  const dataBindings = await validateComponentReferences(
    env, projectId, [...finalNodes.values()], patch.dataBindings ?? current.dataBindings ?? [],
  );
  const modelNodes = patch.upsertNodes.filter((node) => node.type === "model-3d");
  const modelAssetRefs = [...new Set(modelNodes.flatMap((node) => node.resourceRefs))];
  const duplicateNamesByAssetId = new Map<string, Set<string>>();
  for (const assetId of modelAssetRefs) {
    const row = await env.DB.prepare(
      "SELECT id, inspection_json FROM model_assets WHERE id = ? AND project_id = ?",
    ).bind(assetId, projectId).first<{ id: string; inspection_json: string }>();
    if (!row) {
      throw new AppError(
        400,
        "invalid_model_asset_reference",
        `Model asset ${assetId} does not belong to project ${projectId}.`,
      );
    }
    let inspection: unknown;
    try {
      inspection = JSON.parse(row.inspection_json);
    } catch (error) {
      throw new AppError(
        500,
        "invalid_model_asset_storage",
        `Model asset ${assetId} has invalid inspection JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!inspection || typeof inspection !== "object" || Array.isArray(inspection)) {
      throw new AppError(
        500,
        "invalid_model_asset_storage",
        `Model asset ${assetId} inspection is not a JSON object.`,
      );
    }
    const inspectionObject = inspection as Record<string, unknown>;
    if (
      !Array.isArray(inspectionObject.duplicateNodeNames)
      || inspectionObject.duplicateNodeNames.some((name) => typeof name !== "string")
    ) {
      throw new AppError(
        500,
        "invalid_model_asset_storage",
        `Model asset ${assetId} inspection does not contain a valid duplicateNodeNames list.`,
      );
    }
    duplicateNamesByAssetId.set(
      assetId,
      new Set(inspectionObject.duplicateNodeNames as string[]),
    );
  }

  for (const node of modelNodes) {
    const transformOverrides = (node.props as Model3DProps).transformOverrides;
    const appearanceOverrides = (node.props as Model3DProps).appearanceOverrides;
    const transformedNodeNames = Object.keys(transformOverrides);
    const appearanceNodeNames = Object.keys(appearanceOverrides);
    if (transformedNodeNames.length === 0 && appearanceNodeNames.length === 0) continue;

    const assetId = node.resourceRefs[0];
    if (!assetId) {
      const hasAppearanceOverride = appearanceNodeNames.length > 0;
      throw new AppError(
        400,
        hasAppearanceOverride
          ? "model_appearance_without_asset"
          : "model_transform_without_asset",
        `Canvas node ${node.id} cannot store model node ${
          hasAppearanceOverride ? "appearances" : "transforms"
        } without a model asset.`,
      );
    }
    const duplicateNames = duplicateNamesByAssetId.get(assetId);
    const duplicateTransformName = transformedNodeNames.find((name) => duplicateNames?.has(name));
    if (duplicateTransformName) {
      throw new AppError(
        400,
        "ambiguous_model_node_transform",
        `Canvas node ${node.id} cannot transform duplicate model node name ${JSON.stringify(duplicateTransformName)}. Rename the model nodes and upload the model again.`,
      );
    }
    const duplicateAppearanceName = appearanceNodeNames.find((name) => duplicateNames?.has(name));
    if (duplicateAppearanceName) {
      throw new AppError(
        400,
        "ambiguous_model_node_appearance",
        `Canvas node ${node.id} cannot configure the appearance of duplicate model node name ${JSON.stringify(duplicateAppearanceName)}. Rename the model nodes and upload the model again.`,
      );
    }
  }

  const imageAssetRefs = [...new Set(
    patch.upsertNodes
      .filter((node) => node.type === "image" || node.type === "carousel")
      .flatMap((node) => node.resourceRefs),
  )];
  for (const assetId of imageAssetRefs) {
    const imageAsset = await env.DB.prepare(
      "SELECT id FROM image_assets WHERE id = ? AND project_id = ?",
    ).bind(assetId, projectId).first<{ id: string }>();
    if (!imageAsset) {
      throw new AppError(
        400,
        "invalid_image_asset_reference",
        `Image asset ${assetId} does not belong to project ${projectId}.`,
      );
    }
  }

  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare(
      `INSERT OR IGNORE INTO project_canvases
       (project_id, width, height, background_color, theme_mode, theme_preset_id,
        theme_background_pattern, theme_font_family, theme_glow_intensity, theme_panel_radius,
        theme_surface_color, theme_text_color, theme_accent_color, theme_border_color,
        revision, updated_by_user_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).bind(
      projectId,
      DEFAULT_WIDTH,
      DEFAULT_HEIGHT,
      DEFAULT_THEME.backgroundColor,
      DEFAULT_THEME.mode,
      DEFAULT_THEME.presetId,
      DEFAULT_THEME.backgroundPattern,
      DEFAULT_THEME.fontFamily,
      DEFAULT_THEME.glowIntensity,
      DEFAULT_THEME.panelRadius,
      DEFAULT_THEME.surfaceColor,
      DEFAULT_THEME.textColor,
      DEFAULT_THEME.accentColor,
      DEFAULT_THEME.borderColor,
      userId,
      now,
    ),
  ];

  // Definitions and their references share the existing canvas compare-and-swap.
  statements.push(env.DB.prepare(`DELETE FROM component_data_bindings WHERE project_id = ?
    AND EXISTS (SELECT 1 FROM project_canvases WHERE project_id = ? AND revision = ?)`)
    .bind(projectId, projectId, patch.expectedRevision));
  for (const binding of dataBindings) {
    statements.push(env.DB.prepare(`INSERT INTO component_data_bindings (project_id, id, config_json)
      SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM project_canvases WHERE project_id = ? AND revision = ?)`)
      .bind(projectId, binding.id, JSON.stringify(binding), projectId, patch.expectedRevision));
  }

  for (const node of patch.upsertNodes) {
    statements.push(env.DB.prepare(
      `INSERT INTO canvas_nodes
       (id, project_id, node_type, x, y, width, height, z_index, props_json, resource_refs_json, data_binding_refs_json, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM project_canvases WHERE project_id = ? AND revision = ?)
       ON CONFLICT(project_id, id) DO UPDATE SET
         node_type = excluded.node_type, x = excluded.x, y = excluded.y,
         width = excluded.width, height = excluded.height, z_index = excluded.z_index,
         props_json = excluded.props_json, resource_refs_json = excluded.resource_refs_json,
         data_binding_refs_json = excluded.data_binding_refs_json, updated_at = excluded.updated_at`,
    ).bind(
      node.id, projectId, node.type, node.x, node.y, node.width, node.height, node.zIndex,
      JSON.stringify(node.props), JSON.stringify(node.resourceRefs), JSON.stringify(node.dataBindingRefs), now,
      projectId, patch.expectedRevision,
    ));
  }

  for (const nodeId of patch.deleteNodeIds) {
    statements.push(env.DB.prepare(
      `DELETE FROM canvas_nodes WHERE id = ? AND project_id = ?
       AND EXISTS (SELECT 1 FROM project_canvases WHERE project_id = ? AND revision = ?)`,
    ).bind(nodeId, projectId, projectId, patch.expectedRevision));
  }

  statements.push(env.DB.prepare(
    `UPDATE projects SET updated_at = ?
     WHERE id = ?
     AND EXISTS (
       SELECT 1 FROM project_canvases
       WHERE project_id = ? AND revision = ?
     )`,
  ).bind(now, projectId, projectId, patch.expectedRevision));

  statements.push(patch.theme
    ? env.DB.prepare(
      `UPDATE project_canvases SET
         background_color = ?, theme_mode = ?, theme_preset_id = ?,
         theme_background_pattern = ?, theme_font_family = ?, theme_glow_intensity = ?,
         theme_panel_radius = ?, theme_surface_color = ?, theme_text_color = ?,
         theme_accent_color = ?, theme_border_color = ?,
         revision = revision + 1, updated_by_user_id = ?, updated_at = ?
       WHERE project_id = ? AND revision = ?`,
    ).bind(
      patch.theme.backgroundColor,
      patch.theme.mode,
      patch.theme.presetId,
      patch.theme.backgroundPattern,
      patch.theme.fontFamily,
      patch.theme.glowIntensity,
      patch.theme.panelRadius,
      patch.theme.surfaceColor,
      patch.theme.textColor,
      patch.theme.accentColor,
      patch.theme.borderColor,
      userId,
      now,
      projectId,
      patch.expectedRevision,
    )
    : env.DB.prepare(
      `UPDATE project_canvases SET revision = revision + 1, updated_by_user_id = ?, updated_at = ?
       WHERE project_id = ? AND revision = ?`,
    ).bind(userId, now, projectId, patch.expectedRevision));

  const results = await env.DB.batch(statements);
  if (changes(results.at(-1)) !== 1) {
    throw new AppError(409, "canvas_revision_conflict", "The canvas changed since it was loaded. Reload it before saving again.");
  }
  return getCanvas(env, projectId);
};
