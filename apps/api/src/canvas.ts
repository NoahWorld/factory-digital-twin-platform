import { AppError, type AppEnv, type DatabaseResult } from "./auth";

export type CanvasNodeType = "line-chart" | "bar-chart";

export type CanvasNode = {
  id: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  props: {
    title: string;
    categories: string[];
    values: number[];
    unit: string;
    color: string;
  };
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
const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/;
const colorPattern = /^#[0-9a-fA-F]{6}$/;
const encoder = new TextEncoder();

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

const requireStringArray = (value: unknown, label: string, identifiers = false): string[] => {
  if (!Array.isArray(value) || value.length > MAX_POINTS) {
    invalid("invalid_canvas_node", `${label} must contain at most ${MAX_POINTS} strings.`);
  }
  return (value as unknown[]).map((item, index) => identifiers
    ? requireIdentifier(item, `${label}[${index}]`)
    : requireNonEmptyString(item, `${label}[${index}]`, 80));
};

const validateNode = (value: unknown): CanvasNode => {
  const node = requireObject(value, "canvas node");
  const type = node.type;
  if (type !== "line-chart" && type !== "bar-chart") {
    invalid("unsupported_canvas_node_type", "Only line-chart and bar-chart nodes are currently supported.");
  }

  const props = requireObject(node.props, "canvas node props");
  const categories = requireStringArray(props.categories, "props.categories");
  if (categories.length < 2 || !Array.isArray(props.values) || props.values.length !== categories.length || props.values.length > MAX_POINTS) {
    invalid("invalid_canvas_node", "props.values must contain one finite value for every category, with at least two points.");
  }
  const values = (props.values as unknown[]).map((item, index) => requireNumber(item, `props.values[${index}]`, -1_000_000_000, 1_000_000_000));
  const color = requireString(props.color, "props.color", 7);
  if (!colorPattern.test(color)) {
    invalid("invalid_canvas_node", "props.color must be a six-digit hexadecimal color.");
  }

  const validated: CanvasNode = {
    id: requireIdentifier(node.id, "node.id"),
    type: type as CanvasNodeType,
    x: requireNumber(node.x, "node.x", -7680, 7680),
    y: requireNumber(node.y, "node.y", -4320, 4320),
    width: requireNumber(node.width, "node.width", 240, 3840),
    height: requireNumber(node.height, "node.height", 160, 2160),
    zIndex: requireNumber(node.zIndex, "node.zIndex", 0, 100000),
    props: {
      title: requireNonEmptyString(props.title, "props.title", 120),
      categories,
      values,
      unit: requireString(props.unit, "props.unit", 24),
      color,
    },
    resourceRefs: requireStringArray(node.resourceRefs, "node.resourceRefs", true),
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
