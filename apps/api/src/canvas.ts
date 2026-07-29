import { AppError, type AppEnv, type DatabaseResult } from "./auth";

export type ChartNodeType = "line-chart" | "bar-chart";
export type ShapeNodeType = "rectangle" | "circle";
export type DecorationNodeType =
  | "screen-title"
  | "background-decoration"
  | "datetime"
  | "section-title"
  | "card-background"
  | "icon-background";
export type Model3DNodeType = "model-3d";
export type CanvasNodeType = ChartNodeType | ShapeNodeType | DecorationNodeType | Model3DNodeType;

export type ChartProps = {
  title: string;
  categories: string[];
  values: number[];
  unit: string;
  color: string;
};

export type ShapeProps = {
  fillColor: string;
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
  opacity: number;
};

export type DecorationProps = {
  text: string;
  subtitle: string;
  textColor: string;
  accentColor: string;
  fillColor: string;
  borderColor: string;
  opacity: number;
  align: "left" | "center" | "right";
  showDate: boolean;
  showSeconds: boolean;
};

export type Vector3Tuple = [number, number, number];

export type ModelNodeTransform = {
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  scale: Vector3Tuple;
};

export type ModelNodeAppearance = {
  color: string;
  opacity: number;
  visible: boolean;
};

export type ModelCameraView = "isometric" | "front" | "top";

export type Model3DProps = {
  backgroundColor: string;
  backgroundOpacity: number;
  environmentLightColor: string;
  environmentLightIntensity: number;
  keyLightColor: string;
  keyLightIntensity: number;
  cameraFov: number;
  cameraView: ModelCameraView;
  autoRotate: boolean;
  rotationSpeed: number;
  showGrid: boolean;
  appearanceOverrides: Record<string, ModelNodeAppearance>;
  transformOverrides: Record<string, ModelNodeTransform>;
};

export type CanvasNode = {
  id: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  props: ChartProps | ShapeProps | DecorationProps | Model3DProps;
  resourceRefs: string[];
  dataBindingRefs: string[];
};

export type CanvasDocument = {
  projectId: string;
  width: number;
  height: number;
  backgroundColor: string;
  revision: number;
  updatedAt: string | null;
  nodes: CanvasNode[];
};

export type CanvasPatch = {
  expectedRevision: number;
  upsertNodes: CanvasNode[];
  deleteNodeIds: string[];
};

type CanvasRow = {
  project_id: string;
  width: number;
  height: number;
  background_color: string;
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

const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const DEFAULT_BACKGROUND = "#071525";
const MAX_PATCH_NODES = 100;
const MAX_POINTS = 32;
const MAX_PROPS_BYTES = 16 * 1024;
const MAX_MODEL_NODE_TRANSFORMS = 100;
const MAX_MODEL_NODE_APPEARANCES = 100;
const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/;
const colorPattern = /^#[0-9a-fA-F]{6}$/;
const encoder = new TextEncoder();
const minimumNodeSizes: Record<CanvasNodeType, { width: number; height: number }> = {
  "line-chart": { width: 240, height: 160 },
  "bar-chart": { width: 240, height: 160 },
  rectangle: { width: 240, height: 160 },
  circle: { width: 240, height: 240 },
  "screen-title": { width: 360, height: 72 },
  "background-decoration": { width: 200, height: 72 },
  datetime: { width: 220, height: 72 },
  "section-title": { width: 160, height: 48 },
  "card-background": { width: 160, height: 100 },
  "icon-background": { width: 64, height: 64 },
  "model-3d": { width: 360, height: 240 },
};

const invalid = (code: string, message: string): never => {
  throw new AppError(400, code, message);
};

const requireObject = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("invalid_canvas_patch", `${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
};

const requireNumber = (value: unknown, label: string, minimum: number, maximum: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    invalid("invalid_canvas_node", `${label} must be a finite number between ${minimum} and ${maximum}.`);
  }
  return value as number;
};

const requireIdentifier = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !identifierPattern.test(value)) {
    invalid("invalid_canvas_node", `${label} must be a stable identifier of at most 120 characters.`);
  }
  return value as string;
};

const requireString = (value: unknown, label: string, maximum: number): string => {
  if (typeof value !== "string" || value.length > maximum) {
    invalid("invalid_canvas_node", `${label} must be a string of at most ${maximum} characters.`);
  }
  return value as string;
};

const requireNonEmptyString = (value: unknown, label: string, maximum: number): string => {
  const text = requireString(value, label, maximum);
  if (text.trim().length === 0) {
    invalid("invalid_canvas_node", `${label} must not be empty.`);
  }
  return text;
};

const requireBoolean = (value: unknown, label: string): boolean => {
  if (typeof value !== "boolean") {
    invalid("invalid_canvas_node", `${label} must be a boolean.`);
  }
  return value as boolean;
};

const requireColor = (value: unknown, label: string): string => {
  const color = requireString(value, label, 7);
  if (!colorPattern.test(color)) {
    invalid("invalid_canvas_node", `${label} must be a six-digit hexadecimal color.`);
  }
  return color;
};

const requireModelCameraView = (
  value: unknown,
  label: string,
): ModelCameraView => {
  if (value !== "isometric" && value !== "front" && value !== "top") {
    invalid("invalid_canvas_node", `${label} must be isometric, front, or top.`);
  }
  return value as ModelCameraView;
};

const requireVector3Tuple = (
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): Vector3Tuple => {
  if (!Array.isArray(value) || value.length !== 3) {
    invalid("invalid_canvas_node", `${label} must contain exactly three numbers.`);
  }
  const values = value as unknown[];
  return [
    requireNumber(values[0], `${label}[0]`, minimum, maximum),
    requireNumber(values[1], `${label}[1]`, minimum, maximum),
    requireNumber(values[2], `${label}[2]`, minimum, maximum),
  ];
};

const requireModelNodeTransforms = (
  value: unknown,
): Record<string, ModelNodeTransform> => {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("invalid_canvas_node", "props.transformOverrides must be a JSON object.");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_MODEL_NODE_TRANSFORMS) {
    invalid(
      "invalid_canvas_node",
      `props.transformOverrides cannot contain more than ${MAX_MODEL_NODE_TRANSFORMS} model nodes.`,
    );
  }

  const result: Record<string, ModelNodeTransform> = {};
  for (const [nodeName, rawTransform] of entries) {
    if (nodeName.length === 0 || nodeName.length > 240 || nodeName !== nodeName.trim()) {
      invalid(
        "invalid_canvas_node",
        "Model node names in props.transformOverrides must contain 1 to 240 characters without surrounding whitespace.",
      );
    }
    const transform = requireObject(
      rawTransform,
      `props.transformOverrides[${JSON.stringify(nodeName)}]`,
    );
    result[nodeName] = {
      position: requireVector3Tuple(
        transform.position,
        `props.transformOverrides[${JSON.stringify(nodeName)}].position`,
        -1_000_000,
        1_000_000,
      ),
      rotation: requireVector3Tuple(
        transform.rotation,
        `props.transformOverrides[${JSON.stringify(nodeName)}].rotation`,
        -3_600,
        3_600,
      ),
      scale: requireVector3Tuple(
        transform.scale,
        `props.transformOverrides[${JSON.stringify(nodeName)}].scale`,
        0.001,
        1_000,
      ),
    };
  }
  return result;
};

const requireModelNodeAppearances = (
  value: unknown,
): Record<string, ModelNodeAppearance> => {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("invalid_canvas_node", "props.appearanceOverrides must be a JSON object.");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_MODEL_NODE_APPEARANCES) {
    invalid(
      "invalid_canvas_node",
      `props.appearanceOverrides cannot contain more than ${MAX_MODEL_NODE_APPEARANCES} model nodes.`,
    );
  }

  const result: Record<string, ModelNodeAppearance> = {};
  for (const [nodeName, rawAppearance] of entries) {
    if (nodeName.length === 0 || nodeName.length > 240 || nodeName !== nodeName.trim()) {
      invalid(
        "invalid_canvas_node",
        "Model node names in props.appearanceOverrides must contain 1 to 240 characters without surrounding whitespace.",
      );
    }
    const appearance = requireObject(
      rawAppearance,
      `props.appearanceOverrides[${JSON.stringify(nodeName)}]`,
    );
    result[nodeName] = {
      color: requireColor(
        appearance.color,
        `props.appearanceOverrides[${JSON.stringify(nodeName)}].color`,
      ),
      opacity: requireNumber(
        appearance.opacity,
        `props.appearanceOverrides[${JSON.stringify(nodeName)}].opacity`,
        0,
        1,
      ),
      visible: requireBoolean(
        appearance.visible,
        `props.appearanceOverrides[${JSON.stringify(nodeName)}].visible`,
      ),
    };
  }
  return result;
};

const requireAlignment = (value: unknown, label: string): DecorationProps["align"] => {
  if (value !== "left" && value !== "center" && value !== "right") {
    invalid("invalid_canvas_node", `${label} must be left, center, or right.`);
  }
  return value as DecorationProps["align"];
};

const requireStringArray = (value: unknown, label: string, identifiers = false): string[] => {
  if (!Array.isArray(value) || value.length > MAX_POINTS) {
    invalid("invalid_canvas_node", `${label} must contain at most ${MAX_POINTS} strings.`);
  }
  return (value as unknown[]).map((item, index) => identifiers
    ? requireIdentifier(item, `${label}[${index}]`)
    : requireNonEmptyString(item, `${label}[${index}]`, 80));
};

const isDecorationNodeType = (value: unknown): value is DecorationNodeType =>
  value === "screen-title" ||
  value === "background-decoration" ||
  value === "datetime" ||
  value === "section-title" ||
  value === "card-background" ||
  value === "icon-background";

const isModel3DNodeType = (value: unknown): value is Model3DNodeType =>
  value === "model-3d";

const isCanvasNodeType = (value: unknown): value is CanvasNodeType =>
  value === "line-chart" ||
  value === "bar-chart" ||
  value === "rectangle" ||
  value === "circle" ||
  isDecorationNodeType(value) ||
  isModel3DNodeType(value);

const validateNode = (value: unknown): CanvasNode => {
  const node = requireObject(value, "canvas node");
  const rawType = node.type;
  if (!isCanvasNodeType(rawType)) {
    invalid("unsupported_canvas_node_type", "The requested canvas node type is not in the approved component whitelist.");
  }
  const type = rawType as CanvasNodeType;

  const props = requireObject(node.props, "canvas node props");
  let validatedProps: ChartProps | ShapeProps | DecorationProps | Model3DProps;

  if (type === "line-chart" || type === "bar-chart") {
    const categories = requireStringArray(props.categories, "props.categories");
    if (categories.length < 2 || !Array.isArray(props.values) || props.values.length !== categories.length || props.values.length > MAX_POINTS) {
      invalid("invalid_canvas_node", "props.values must contain one finite value for every category, with at least two points.");
    }
    const values = (props.values as unknown[]).map((item, index) => requireNumber(item, `props.values[${index}]`, -1_000_000_000, 1_000_000_000));
    validatedProps = {
      title: requireNonEmptyString(props.title, "props.title", 120),
      categories,
      values,
      unit: requireString(props.unit, "props.unit", 24),
      color: requireColor(props.color, "props.color"),
    };
  } else if (type === "rectangle" || type === "circle") {
    validatedProps = {
      fillColor: requireColor(props.fillColor, "props.fillColor"),
      borderColor: requireColor(props.borderColor, "props.borderColor"),
      borderWidth: requireNumber(props.borderWidth, "props.borderWidth", 0, 20),
      borderRadius: requireNumber(props.borderRadius, "props.borderRadius", 0, 200),
      opacity: requireNumber(props.opacity, "props.opacity", 0.05, 1),
    };
  } else if (isDecorationNodeType(type)) {
    const text = type === "background-decoration" || type === "card-background"
      ? requireString(props.text, "props.text", 120)
      : requireNonEmptyString(
          props.text,
          "props.text",
          type === "icon-background" ? 4 : 120,
        );
    validatedProps = {
      text,
      subtitle: requireString(props.subtitle, "props.subtitle", 160),
      textColor: requireColor(props.textColor, "props.textColor"),
      accentColor: requireColor(props.accentColor, "props.accentColor"),
      fillColor: requireColor(props.fillColor, "props.fillColor"),
      borderColor: requireColor(props.borderColor, "props.borderColor"),
      opacity: requireNumber(props.opacity, "props.opacity", 0.05, 1),
      align: requireAlignment(props.align, "props.align"),
      showDate: requireBoolean(props.showDate, "props.showDate"),
      showSeconds: requireBoolean(props.showSeconds, "props.showSeconds"),
    };
  } else {
    validatedProps = {
      backgroundColor: requireColor(props.backgroundColor, "props.backgroundColor"),
      backgroundOpacity: props.backgroundOpacity === undefined
        ? 1
        : requireNumber(props.backgroundOpacity, "props.backgroundOpacity", 0, 1),
      environmentLightColor: props.environmentLightColor === undefined
        ? "#daf4ff"
        : requireColor(props.environmentLightColor, "props.environmentLightColor"),
      environmentLightIntensity: props.environmentLightIntensity === undefined
        ? 2.1
        : requireNumber(
            props.environmentLightIntensity,
            "props.environmentLightIntensity",
            0,
            10,
          ),
      keyLightColor: props.keyLightColor === undefined
        ? "#ffffff"
        : requireColor(props.keyLightColor, "props.keyLightColor"),
      keyLightIntensity: props.keyLightIntensity === undefined
        ? 2.4
        : requireNumber(props.keyLightIntensity, "props.keyLightIntensity", 0, 10),
      cameraFov: props.cameraFov === undefined
        ? 42
        : requireNumber(props.cameraFov, "props.cameraFov", 15, 90),
      cameraView: props.cameraView === undefined
        ? "isometric"
        : requireModelCameraView(props.cameraView, "props.cameraView"),
      autoRotate: requireBoolean(props.autoRotate, "props.autoRotate"),
      rotationSpeed: requireNumber(props.rotationSpeed, "props.rotationSpeed", 0, 5),
      showGrid: requireBoolean(props.showGrid, "props.showGrid"),
      appearanceOverrides: requireModelNodeAppearances(props.appearanceOverrides),
      transformOverrides: requireModelNodeTransforms(props.transformOverrides),
    };
  }

  const minimumSize = minimumNodeSizes[type];
  const width = requireNumber(node.width, "node.width", minimumSize.width, 3840);
  const height = requireNumber(node.height, "node.height", minimumSize.height, 2160);
  if ((type === "circle" || type === "icon-background") && Math.abs(width - height) > 0.001) {
    invalid("invalid_canvas_node", "Square canvas nodes must keep a 1:1 width-to-height ratio.");
  }
  const resourceRefs = requireStringArray(node.resourceRefs, "node.resourceRefs", true);
  if (type === "model-3d" && resourceRefs.length > 1) {
    invalid("invalid_canvas_node", "A 3D model component can reference at most one model asset.");
  }

  const validated: CanvasNode = {
    id: requireIdentifier(node.id, "node.id"),
    type,
    x: requireNumber(node.x, "node.x", -7680, 7680),
    y: requireNumber(node.y, "node.y", -4320, 4320),
    width,
    height,
    zIndex: requireNumber(node.zIndex, "node.zIndex", 0, 100000),
    props: validatedProps,
    resourceRefs,
    dataBindingRefs: requireStringArray(node.dataBindingRefs, "node.dataBindingRefs", true),
  };

  if (!Number.isInteger(validated.zIndex)) {
    invalid("invalid_canvas_node", "node.zIndex must be an integer.");
  }

  if (encoder.encode(JSON.stringify(validated.props)).byteLength > MAX_PROPS_BYTES) {
    invalid("canvas_node_too_large", `A node's properties cannot exceed ${MAX_PROPS_BYTES} bytes.`);
  }
  return validated;
};

export const validateCanvasPatch = (value: Record<string, unknown>): CanvasPatch => {
  const expectedRevision = value.expectedRevision;
  if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0) {
    invalid("invalid_canvas_revision", "expectedRevision must be a non-negative integer.");
  }
  if (!Array.isArray(value.upsertNodes) || !Array.isArray(value.deleteNodeIds)) {
    invalid("invalid_canvas_patch", "upsertNodes and deleteNodeIds must be arrays.");
  }
  const upsertValues = value.upsertNodes as unknown[];
  const deleteValues = value.deleteNodeIds as unknown[];
  if (upsertValues.length + deleteValues.length === 0) {
    invalid("empty_canvas_patch", "A canvas patch must contain at least one change.");
  }
  if (upsertValues.length + deleteValues.length > MAX_PATCH_NODES) {
    invalid("canvas_patch_too_large", `A single patch cannot change more than ${MAX_PATCH_NODES} nodes.`);
  }

  const upsertNodes = upsertValues.map(validateNode);
  const deleteNodeIds = deleteValues.map((id, index) => requireIdentifier(id, `deleteNodeIds[${index}]`));
  const allIds = [...upsertNodes.map((node) => node.id), ...deleteNodeIds];
  if (new Set(allIds).size !== allIds.length) {
    invalid("duplicate_canvas_node_id", "Node IDs must not be duplicated across upserts and deletes.");
  }
  return { expectedRevision: expectedRevision as number, upsertNodes, deleteNodeIds };
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
    "SELECT project_id, width, height, background_color, revision, updated_at FROM project_canvases WHERE project_id = ?",
  ).bind(projectId).first<CanvasRow>();
  if (!canvas) {
    return { projectId, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, backgroundColor: DEFAULT_BACKGROUND, revision: 0, updatedAt: null, nodes: [] };
  }
  const rows = await env.DB.prepare(
    `SELECT id, node_type, x, y, width, height, z_index, props_json, resource_refs_json, data_binding_refs_json
     FROM canvas_nodes WHERE project_id = ? ORDER BY z_index ASC, id ASC`,
  ).bind(projectId).all<CanvasNodeRow>();
  return {
    projectId: canvas.project_id, width: canvas.width, height: canvas.height,
    backgroundColor: canvas.background_color, revision: canvas.revision, updatedAt: canvas.updated_at,
    nodes: rows.results.map(presentStoredNode),
  };
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

  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare(
      `INSERT OR IGNORE INTO project_canvases
       (project_id, width, height, background_color, revision, updated_by_user_id, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    ).bind(projectId, DEFAULT_WIDTH, DEFAULT_HEIGHT, DEFAULT_BACKGROUND, userId, now),
  ];

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
    `UPDATE project_canvases SET revision = revision + 1, updated_by_user_id = ?, updated_at = ?
     WHERE project_id = ? AND revision = ?`,
  ).bind(userId, now, projectId, patch.expectedRevision));

  const results = await env.DB.batch(statements);
  if (changes(results.at(-1)) !== 1) {
    throw new AppError(409, "canvas_revision_conflict", "The canvas changed since it was loaded. Reload it before saving again.");
  }
  return getCanvas(env, projectId);
};
