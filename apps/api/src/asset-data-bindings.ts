import { AppError, type AppEnv } from "./auth";

type JsonObject = Record<string, unknown>;

export type MetricValueType = "number" | "string" | "boolean" | "timestamp";

export type AssetDataBinding = {
  id: string;
  assetRecordId: string;
  dataSourceId: string;
  dataSourceName: string;
  dataSourceType: "rest_polling" | "websocket";
  metricKey: string;
  sourcePath: string;
  valueType: MetricValueType;
  unit: string | null;
  staleAfterSeconds: number;
  createdAt: string;
  updatedAt: string;
};

export type AssetDataBindingCreateInput = {
  dataSourceId: string;
  metricKey: string;
  sourcePath: string;
  valueType: MetricValueType;
  unit: string | null;
  staleAfterSeconds: number;
};

type AssetDataBindingRow = {
  id: string;
  asset_id: string;
  data_source_id: string;
  data_source_name: string;
  data_source_type: "rest_polling" | "websocket";
  metric_key: string;
  source_path: string;
  value_type: string;
  unit: string | null;
  stale_after_seconds: number;
  created_at: string;
  updated_at: string;
};

const bindingFields = new Set([
  "dataSourceId",
  "metricKey",
  "sourcePath",
  "valueType",
  "unit",
  "staleAfterSeconds",
]);
const REFERENCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const METRIC_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]*$/;

const assertKnownFields = (body: JsonObject): void => {
  const unknownField = Object.keys(body).find((field) => !bindingFields.has(field));
  if (unknownField) {
    throw new AppError(
      400,
      "unknown_asset_data_binding_field",
      `Unsupported asset data binding field: ${unknownField}.`,
    );
  }
};

const validateReferenceId = (
  value: unknown,
  field: string,
): string => {
  if (typeof value !== "string") {
    throw new AppError(400, "invalid_asset_data_binding", `${field} is required.`);
  }
  const referenceId = value.trim();
  if (
    referenceId.length < 1
    || referenceId.length > 100
    || !REFERENCE_ID_PATTERN.test(referenceId)
  ) {
    throw new AppError(
      400,
      "invalid_asset_data_binding",
      `${field} must contain 1 to 100 ASCII letters, digits, or hyphens.`,
    );
  }
  return referenceId;
};

const validateMetricKey = (value: unknown): string => {
  if (typeof value !== "string") {
    throw new AppError(400, "invalid_metric_key", "Metric key is required.");
  }
  const metricKey = value.trim();
  if (
    metricKey.length < 1
    || metricKey.length > 80
    || !METRIC_KEY_PATTERN.test(metricKey)
  ) {
    throw new AppError(
      400,
      "invalid_metric_key",
      "Metric key must contain 1 to 80 ASCII letters, digits, dots, underscores, colons, or hyphens, and must start with a letter.",
    );
  }
  return metricKey;
};

const validateSourcePath = (value: unknown): string => {
  if (typeof value !== "string") {
    throw new AppError(400, "invalid_source_path", "Source path is required.");
  }
  const sourcePath = value.trim();
  if (
    sourcePath.length < 1
    || sourcePath.length > 256
    || !sourcePath.startsWith("$")
    || /[\u0000-\u001f\u007f]/.test(sourcePath)
  ) {
    throw new AppError(
      400,
      "invalid_source_path",
      "Source path must be a printable JSON path beginning with $ and contain at most 256 characters.",
    );
  }
  return sourcePath;
};

const validateValueType = (value: unknown): MetricValueType => {
  if (
    value !== "number"
    && value !== "string"
    && value !== "boolean"
    && value !== "timestamp"
  ) {
    throw new AppError(
      400,
      "invalid_metric_value_type",
      "Value type must be number, string, boolean, or timestamp.",
    );
  }
  return value;
};

const validateUnit = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new AppError(400, "invalid_metric_unit", "Metric unit must be a string or null.");
  }
  const unit = value.trim();
  if (
    unit.length < 1
    || unit.length > 32
    || /[\u0000-\u001f\u007f]/.test(unit)
  ) {
    throw new AppError(
      400,
      "invalid_metric_unit",
      "Metric unit must contain 1 to 32 printable characters.",
    );
  }
  return unit;
};

const validateStaleAfterSeconds = (value: unknown): number => {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 86_400) {
    throw new AppError(
      400,
      "invalid_stale_after_seconds",
      "staleAfterSeconds must be an integer between 1 and 86400.",
    );
  }
  return value as number;
};

export const validateAssetDataBindingCreate = (
  body: JsonObject,
): AssetDataBindingCreateInput => {
  assertKnownFields(body);
  return {
    dataSourceId: validateReferenceId(body.dataSourceId, "dataSourceId"),
    metricKey: validateMetricKey(body.metricKey),
    sourcePath: validateSourcePath(body.sourcePath),
    valueType: validateValueType(body.valueType),
    unit: validateUnit(body.unit),
    staleAfterSeconds: validateStaleAfterSeconds(body.staleAfterSeconds),
  };
};

const presentBinding = (row: AssetDataBindingRow): AssetDataBinding => {
  try {
    return {
      id: validateReferenceId(row.id, "stored binding ID"),
      assetRecordId: validateReferenceId(row.asset_id, "stored asset record ID"),
      dataSourceId: validateReferenceId(row.data_source_id, "stored data source ID"),
      dataSourceName: row.data_source_name,
      dataSourceType: row.data_source_type,
      metricKey: validateMetricKey(row.metric_key),
      sourcePath: validateSourcePath(row.source_path),
      valueType: validateValueType(row.value_type),
      unit: validateUnit(row.unit),
      staleAfterSeconds: validateStaleAfterSeconds(row.stale_after_seconds),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch (error) {
    throw new AppError(
      500,
      "stored_asset_data_binding_invalid",
      `Asset data binding ${row.id} is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const bindingColumns = `
  b.id, b.asset_id, b.data_source_id, d.name AS data_source_name,
  d.source_type AS data_source_type, b.metric_key, b.source_path,
  b.value_type, b.unit, b.stale_after_seconds, b.created_at, b.updated_at
`;

const requireProjectAsset = async (
  env: AppEnv,
  projectId: string,
  assetRecordId: string,
): Promise<void> => {
  const asset = await env.DB.prepare(
    "SELECT id FROM assets WHERE project_id = ? AND id = ?",
  )
    .bind(projectId, assetRecordId)
    .first<{ id: string }>();
  if (!asset) {
    throw new AppError(
      404,
      "asset_not_found",
      "Asset was not found in this project.",
    );
  }
};

const requireProjectDataSource = async (
  env: AppEnv,
  projectId: string,
  dataSourceId: string,
): Promise<void> => {
  const dataSource = await env.DB.prepare(
    "SELECT id FROM data_sources WHERE project_id = ? AND id = ?",
  )
    .bind(projectId, dataSourceId)
    .first<{ id: string }>();
  if (!dataSource) {
    throw new AppError(
      400,
      "data_source_not_in_project",
      "The selected data source does not belong to this project.",
    );
  }
};

const getBinding = async (
  env: AppEnv,
  projectId: string,
  assetRecordId: string,
  bindingId: string,
): Promise<AssetDataBinding> => {
  await requireProjectAsset(env, projectId, assetRecordId);
  const row = await env.DB.prepare(
    `SELECT ${bindingColumns}
     FROM asset_data_bindings b
     JOIN data_sources d ON d.id = b.data_source_id
     JOIN assets a ON a.id = b.asset_id
     WHERE a.project_id = ? AND a.id = ? AND b.id = ?`,
  )
    .bind(projectId, assetRecordId, bindingId)
    .first<AssetDataBindingRow>();
  if (!row) {
    throw new AppError(
      404,
      "asset_data_binding_not_found",
      "Asset data binding was not found for this asset.",
    );
  }
  return presentBinding(row);
};

const assertMetricKeyAvailable = async (
  env: AppEnv,
  assetRecordId: string,
  metricKey: string,
  excludedBindingId: string | null,
): Promise<void> => {
  const conflict = await env.DB.prepare(
    `SELECT id
     FROM asset_data_bindings
     WHERE asset_id = ? AND metric_key = ? AND (? IS NULL OR id <> ?)
     LIMIT 1`,
  )
    .bind(assetRecordId, metricKey, excludedBindingId, excludedBindingId)
    .first<{ id: string }>();
  if (conflict) {
    throw new AppError(
      409,
      "duplicate_asset_metric_key",
      `Metric key ${metricKey} already exists for this asset.`,
    );
  }
};

const runBindingWrite = async (
  operation: () => Promise<unknown>,
): Promise<void> => {
  try {
    await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE constraint failed")) {
      throw new AppError(
        409,
        "asset_data_binding_conflict",
        "This asset metric was changed by another request. Reload the mappings and try again.",
      );
    }
    if (message.includes("FOREIGN KEY constraint failed")) {
      throw new AppError(
        409,
        "asset_data_binding_reference_changed",
        "The asset or data source was removed by another request. Reload the project and try again.",
      );
    }
    throw error;
  }
};

export const listAssetDataBindings = async (
  env: AppEnv,
  projectId: string,
  assetRecordId: string,
): Promise<AssetDataBinding[]> => {
  await requireProjectAsset(env, projectId, assetRecordId);
  const result = await env.DB.prepare(
    `SELECT ${bindingColumns}
     FROM asset_data_bindings b
     JOIN data_sources d ON d.id = b.data_source_id
     JOIN assets a ON a.id = b.asset_id
     WHERE a.project_id = ? AND a.id = ?
     ORDER BY b.metric_key ASC`,
  )
    .bind(projectId, assetRecordId)
    .all<AssetDataBindingRow>();
  return (result.results ?? []).map(presentBinding);
};

export const createAssetDataBinding = async (
  env: AppEnv,
  projectId: string,
  assetRecordId: string,
  input: AssetDataBindingCreateInput,
): Promise<AssetDataBinding> => {
  await requireProjectAsset(env, projectId, assetRecordId);
  await requireProjectDataSource(env, projectId, input.dataSourceId);
  await assertMetricKeyAvailable(env, assetRecordId, input.metricKey, null);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await runBindingWrite(() => env.DB.prepare(
    `INSERT INTO asset_data_bindings (
      id, asset_id, data_source_id, metric_key, source_path,
      value_type, unit, stale_after_seconds, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      assetRecordId,
      input.dataSourceId,
      input.metricKey,
      input.sourcePath,
      input.valueType,
      input.unit,
      input.staleAfterSeconds,
      now,
      now,
    )
    .run());

  return getBinding(env, projectId, assetRecordId, id);
};

export const updateAssetDataBinding = async (
  env: AppEnv,
  projectId: string,
  assetRecordId: string,
  bindingId: string,
  body: JsonObject,
): Promise<AssetDataBinding> => {
  assertKnownFields(body);
  if (Object.keys(body).length === 0) {
    throw new AppError(
      400,
      "empty_asset_data_binding_patch",
      "Asset data binding update must contain at least one field.",
    );
  }

  const current = await getBinding(env, projectId, assetRecordId, bindingId);
  const next: AssetDataBindingCreateInput = {
    dataSourceId: "dataSourceId" in body
      ? validateReferenceId(body.dataSourceId, "dataSourceId")
      : current.dataSourceId,
    metricKey: "metricKey" in body
      ? validateMetricKey(body.metricKey)
      : current.metricKey,
    sourcePath: "sourcePath" in body
      ? validateSourcePath(body.sourcePath)
      : current.sourcePath,
    valueType: "valueType" in body
      ? validateValueType(body.valueType)
      : current.valueType,
    unit: "unit" in body ? validateUnit(body.unit) : current.unit,
    staleAfterSeconds: "staleAfterSeconds" in body
      ? validateStaleAfterSeconds(body.staleAfterSeconds)
      : current.staleAfterSeconds,
  };
  await requireProjectDataSource(env, projectId, next.dataSourceId);
  await assertMetricKeyAvailable(env, assetRecordId, next.metricKey, bindingId);
  const now = new Date().toISOString();

  await runBindingWrite(() => env.DB.prepare(
    `UPDATE asset_data_bindings
     SET data_source_id = ?, metric_key = ?, source_path = ?,
         value_type = ?, unit = ?, stale_after_seconds = ?, updated_at = ?
     WHERE asset_id = ? AND id = ?`,
  )
    .bind(
      next.dataSourceId,
      next.metricKey,
      next.sourcePath,
      next.valueType,
      next.unit,
      next.staleAfterSeconds,
      now,
      assetRecordId,
      bindingId,
    )
    .run());

  return getBinding(env, projectId, assetRecordId, bindingId);
};

export const deleteAssetDataBinding = async (
  env: AppEnv,
  projectId: string,
  assetRecordId: string,
  bindingId: string,
): Promise<AssetDataBinding> => {
  const current = await getBinding(env, projectId, assetRecordId, bindingId);
  await env.DB.prepare(
    "DELETE FROM asset_data_bindings WHERE asset_id = ? AND id = ?",
  )
    .bind(assetRecordId, bindingId)
    .run();
  return current;
};
