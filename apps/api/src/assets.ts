import { AppError, type AppEnv } from "./auth";

type JsonObject = Record<string, unknown>;

type AssetRow = {
  id: string;
  project_id: string;
  asset_key: string;
  model_node: string | null;
  name: string;
  asset_type: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

export type Asset = {
  id: string;
  projectId: string;
  assetId: string;
  modelNode: string | null;
  name: string;
  assetType: string;
  metadata: JsonObject;
  createdAt: string;
  updatedAt: string;
};

export type AssetCreateInput = {
  assetId: string;
  modelNode: string | null;
  name: string;
  assetType: string;
  metadata: JsonObject;
};

export type AssetPatchInput = Partial<AssetCreateInput>;

const ASSET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const ASSET_TYPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const MAX_METADATA_BYTES = 16 * 1024;
const assetFields = new Set(["assetId", "modelNode", "name", "assetType", "metadata"]);

const assertKnownFields = (body: JsonObject): void => {
  const unknownField = Object.keys(body).find((field) => !assetFields.has(field));
  if (unknownField) {
    throw new AppError(400, "unknown_asset_field", `Unsupported asset field: ${unknownField}.`);
  }
};

const validateAssetId = (value: unknown): string => {
  if (typeof value !== "string") {
    throw new AppError(400, "invalid_asset_id", "Asset ID is required.");
  }
  const assetId = value.trim();
  if (assetId.length < 1 || assetId.length > 80 || !ASSET_ID_PATTERN.test(assetId)) {
    throw new AppError(
      400,
      "invalid_asset_id",
      "Asset ID must contain 1 to 80 ASCII letters, digits, dots, underscores, colons, or hyphens.",
    );
  }
  return assetId;
};

const validateAssetName = (value: unknown): string => {
  if (typeof value !== "string") {
    throw new AppError(400, "invalid_asset_name", "Asset name is required.");
  }
  const name = value.trim();
  if (name.length < 1 || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new AppError(400, "invalid_asset_name", "Asset name must contain 1 to 120 printable characters.");
  }
  return name;
};

const validateAssetType = (value: unknown): string => {
  if (typeof value !== "string") {
    throw new AppError(400, "invalid_asset_type", "Asset type is required.");
  }
  const assetType = value.trim();
  if (
    assetType.length < 1
    || assetType.length > 64
    || !ASSET_TYPE_PATTERN.test(assetType)
  ) {
    throw new AppError(
      400,
      "invalid_asset_type",
      "Asset type must contain 1 to 64 ASCII letters, digits, underscores, or hyphens.",
    );
  }
  return assetType;
};

const validateModelNode = (value: unknown): string | null => {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new AppError(400, "invalid_model_node", "Model node must be a string or null.");
  }
  const modelNode = value.trim();
  if (
    modelNode.length < 1
    || modelNode.length > 240
    || /[\u0000-\u001f\u007f]/.test(modelNode)
  ) {
    throw new AppError(
      400,
      "invalid_model_node",
      "Model node must contain 1 to 240 printable characters.",
    );
  }
  return modelNode;
};

const validateMetadata = (value: unknown): JsonObject => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(400, "invalid_asset_metadata", "Asset metadata must be a JSON object.");
  }
  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).byteLength > MAX_METADATA_BYTES) {
    throw new AppError(
      400,
      "asset_metadata_too_large",
      `Asset metadata cannot exceed ${MAX_METADATA_BYTES} bytes.`,
    );
  }
  return value as JsonObject;
};

export const validateAssetCreate = (body: JsonObject): AssetCreateInput => {
  assertKnownFields(body);
  return {
    assetId: validateAssetId(body.assetId),
    modelNode: body.modelNode === undefined ? null : validateModelNode(body.modelNode),
    name: validateAssetName(body.name),
    assetType: validateAssetType(body.assetType),
    metadata: body.metadata === undefined ? {} : validateMetadata(body.metadata),
  };
};

export const validateAssetPatch = (body: JsonObject): AssetPatchInput => {
  assertKnownFields(body);
  if (Object.keys(body).length === 0) {
    throw new AppError(400, "empty_asset_patch", "Asset update must contain at least one field.");
  }

  const patch: AssetPatchInput = {};
  if ("assetId" in body) patch.assetId = validateAssetId(body.assetId);
  if ("modelNode" in body) patch.modelNode = validateModelNode(body.modelNode);
  if ("name" in body) patch.name = validateAssetName(body.name);
  if ("assetType" in body) patch.assetType = validateAssetType(body.assetType);
  if ("metadata" in body) patch.metadata = validateMetadata(body.metadata);
  return patch;
};

const parseMetadata = (row: AssetRow): JsonObject => {
  let metadata: unknown;
  try {
    metadata = JSON.parse(row.metadata_json);
  } catch (error) {
    throw new AppError(
      500,
      "stored_asset_metadata_invalid",
      `Asset ${row.id} has invalid metadata JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new AppError(
      500,
      "stored_asset_metadata_invalid",
      `Asset ${row.id} metadata must be a JSON object.`,
    );
  }
  return metadata as JsonObject;
};

const presentAsset = (row: AssetRow): Asset => ({
  id: row.id,
  projectId: row.project_id,
  assetId: row.asset_key,
  modelNode: row.model_node,
  name: row.name,
  assetType: row.asset_type,
  metadata: parseMetadata(row),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const assetColumns = `
  id, project_id, asset_key, model_node, name, asset_type,
  metadata_json, created_at, updated_at
`;

export const listAssets = async (env: AppEnv, projectId: string): Promise<Asset[]> => {
  const result = await env.DB.prepare(
    `SELECT ${assetColumns}
     FROM assets
     WHERE project_id = ?
     ORDER BY updated_at DESC, asset_key ASC`,
  )
    .bind(projectId)
    .all<AssetRow>();
  return (result.results ?? []).map(presentAsset);
};

const getAssetRow = async (
  env: AppEnv,
  projectId: string,
  recordId: string,
): Promise<AssetRow> => {
  const row = await env.DB.prepare(
    `SELECT ${assetColumns}
     FROM assets
     WHERE project_id = ? AND id = ?`,
  )
    .bind(projectId, recordId)
    .first<AssetRow>();
  if (!row) {
    throw new AppError(404, "asset_not_found", "Asset was not found in this project.");
  }
  return row;
};

const assertNoAssetConflicts = async (
  env: AppEnv,
  projectId: string,
  assetId: string,
  modelNode: string | null,
  excludedRecordId: string | null,
): Promise<void> => {
  const assetIdConflict = await env.DB.prepare(
    `SELECT id FROM assets
     WHERE project_id = ? AND asset_key = ? AND (? IS NULL OR id <> ?)
     LIMIT 1`,
  )
    .bind(projectId, assetId, excludedRecordId, excludedRecordId)
    .first<{ id: string }>();
  if (assetIdConflict) {
    throw new AppError(409, "duplicate_asset_id", `Asset ID ${assetId} already exists in this project.`);
  }

  if (modelNode !== null) {
    const modelNodeConflict = await env.DB.prepare(
      `SELECT id FROM assets
       WHERE project_id = ? AND model_node = ? AND (? IS NULL OR id <> ?)
       LIMIT 1`,
    )
      .bind(projectId, modelNode, excludedRecordId, excludedRecordId)
      .first<{ id: string }>();
    if (modelNodeConflict) {
      throw new AppError(
        409,
        "model_node_already_bound",
        `Model node ${modelNode} is already bound to another asset.`,
      );
    }
  }
};

const runAssetWrite = async (
  operation: () => Promise<unknown>,
): Promise<void> => {
  try {
    await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE constraint failed")) {
      throw new AppError(
        409,
        "asset_binding_conflict",
        "The asset ID or model node was assigned by another request. Reload the asset list and try again.",
      );
    }
    throw error;
  }
};

export const createAsset = async (
  env: AppEnv,
  projectId: string,
  input: AssetCreateInput,
): Promise<Asset> => {
  await assertNoAssetConflicts(env, projectId, input.assetId, input.modelNode, null);
  const recordId = crypto.randomUUID();
  const now = new Date().toISOString();

  await runAssetWrite(() => env.DB.prepare(
    `INSERT INTO assets (
      id, project_id, asset_key, model_node, name, asset_type,
      metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      recordId,
      projectId,
      input.assetId,
      input.modelNode,
      input.name,
      input.assetType,
      JSON.stringify(input.metadata),
      now,
      now,
    )
    .run());

  return presentAsset({
    id: recordId,
    project_id: projectId,
    asset_key: input.assetId,
    model_node: input.modelNode,
    name: input.name,
    asset_type: input.assetType,
    metadata_json: JSON.stringify(input.metadata),
    created_at: now,
    updated_at: now,
  });
};

export const updateAsset = async (
  env: AppEnv,
  projectId: string,
  recordId: string,
  patch: AssetPatchInput,
): Promise<Asset> => {
  const current = await getAssetRow(env, projectId, recordId);
  const next: AssetCreateInput = {
    assetId: patch.assetId ?? current.asset_key,
    modelNode: patch.modelNode === undefined ? current.model_node : patch.modelNode,
    name: patch.name ?? current.name,
    assetType: patch.assetType ?? current.asset_type,
    metadata: patch.metadata ?? parseMetadata(current),
  };
  await assertNoAssetConflicts(env, projectId, next.assetId, next.modelNode, recordId);
  const now = new Date().toISOString();

  await runAssetWrite(() => env.DB.prepare(
    `UPDATE assets
     SET asset_key = ?, model_node = ?, name = ?, asset_type = ?,
         metadata_json = ?, updated_at = ?
     WHERE project_id = ? AND id = ?`,
  )
    .bind(
      next.assetId,
      next.modelNode,
      next.name,
      next.assetType,
      JSON.stringify(next.metadata),
      now,
      projectId,
      recordId,
    )
    .run());

  return presentAsset({
    ...current,
    asset_key: next.assetId,
    model_node: next.modelNode,
    name: next.name,
    asset_type: next.assetType,
    metadata_json: JSON.stringify(next.metadata),
    updated_at: now,
  });
};
