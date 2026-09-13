import { validateTimestampFormat,type TimestampFormat } from "../../../shared/metric-transforms";
import { AppError, type AppEnv } from "./auth";

type JsonObject = Record<string, unknown>;

export type DataSourceType = "rest_polling" | "websocket" | "mqtt";

export type RestPollingConfig = {
  timestampFormat?:TimestampFormat;
  url: string;
  endpointRef?: string;
  collectionMode?: "demand" | "continuous";
  intervalSeconds: number;
  timeoutMs: number;
  timestampPath: string | null;
  credentialRef: string | null;
};

export type WebSocketConfig = {
  timestampFormat?:TimestampFormat;
  url: string;
  endpointRef?: string;
  collectionMode?: "demand" | "continuous";
  heartbeatSeconds: number;
  timestampPath?: string | null;
  sampleIntervalMs?: number;
  topics?: string[];
  reconnectMaxSeconds: number;
  credentialRef: string | null;
};

export type MqttConfig = {
  url:""; endpointRef:string; credentialRef:string|null; topic:string;
  collectionMode?:"demand"|"continuous"; timestampPath:string; timestampFormat?:TimestampFormat;
  heartbeatSeconds:number; reconnectMaxSeconds:number; sampleIntervalMs:number;
};
export type DataSourceConfig = RestPollingConfig | WebSocketConfig | MqttConfig;
export function validateMqttTopic(value:unknown):string {
  if (typeof value !== "string" || !value || value.length>128 || /[+#\u0000-\u001f\u007f]/.test(value) || value.startsWith("$share/") || /[\ud800-\udfff]/u.test(value)) throw new AppError(400,"invalid_mqtt_topic","MQTT requires one exact printable topic of at most 128 characters without wildcards or shared subscriptions.");
  return value;
}

export type DataSource = {
  id: string;
  projectId: string;
  sourceType: DataSourceType;
  name: string;
  config: DataSourceConfig;
  createdAt: string;
  updatedAt: string;
};

export type DataSourceCreateInput = {
  sourceType: DataSourceType;
  name: string;
  config: DataSourceConfig;
};

export type DataSourcePatchInput = {
  sourceType?: DataSourceType;
  name?: string;
  config?: DataSourceConfig;
};

type DataSourceRow = {
  id: string;
  project_id: string;
  source_type: DataSourceType;
  name: string;
  config_json: string;
  created_at: string;
  updated_at: string;
};

const dataSourceFields = new Set(["sourceType", "name", "config"]);
const REST_CONFIG_FIELDS = new Set([
  "url",
  "endpointRef",
  "collectionMode",
  "intervalSeconds",
  "timeoutMs",
  "timestampPath",
  "timestampFormat",
  "credentialRef",
]);
const WEBSOCKET_CONFIG_FIELDS = new Set([
  "url",
  "endpointRef",
  "collectionMode",
  "heartbeatSeconds",
  "timestampPath",
  "timestampFormat",
  "sampleIntervalMs",
  "topics",
  "reconnectMaxSeconds",
  "credentialRef",
]);
const CREDENTIAL_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SENSITIVE_QUERY_KEY = /^(?:api[-_]?key|access[-_]?token|auth(?:orization)?|password|secret|token)$/i;

const requireObject = (value: unknown, field: string): JsonObject => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(400, "invalid_data_source_config", `${field} must be a JSON object.`);
  }
  return value as JsonObject;
};

const assertKnownFields = (
  body: JsonObject,
  fields: Set<string>,
  errorCode: string,
  context: string,
): void => {
  const unknownField = Object.keys(body).find((field) => !fields.has(field));
  if (unknownField) {
    throw new AppError(400, errorCode, `Unsupported ${context} field: ${unknownField}.`);
  }
};

const validateSourceType = (value: unknown): DataSourceType => {
  if (value !== "rest_polling" && value !== "websocket" && value !== "mqtt") {
    throw new AppError(
      400,
      "invalid_data_source_type",
      "Data source type must be rest_polling, websocket or mqtt.",
    );
  }
  return value;
};

const validateName = (value: unknown): string => {
  if (typeof value !== "string") {
    throw new AppError(400, "invalid_data_source_name", "Data source name is required.");
  }
  const name = value.trim();
  if (name.length < 1 || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new AppError(
      400,
      "invalid_data_source_name",
      "Data source name must contain 1 to 100 printable characters.",
    );
  }
  return name;
};

const validateInteger = (
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number => {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new AppError(
      400,
      "invalid_data_source_config",
      `${field} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return value as number;
};

const validateCredentialRef = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new AppError(
      400,
      "invalid_credential_ref",
      "Credential reference must be a string or null.",
    );
  }
  const credentialRef = value.trim();
  if (
    credentialRef.length > 120
    || !CREDENTIAL_REF_PATTERN.test(credentialRef)
  ) {
    throw new AppError(
      400,
      "invalid_credential_ref",
      "Credential reference must contain 1 to 120 ASCII letters, digits, dots, underscores, colons, or hyphens.",
    );
  }
  return credentialRef;
};

const validateTimestampPath = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new AppError(
      400,
      "invalid_data_source_timestamp_path",
      "REST timestampPath must be a string or null.",
    );
  }
  const path = value.trim();
  if (path.length > 256 || (path !== "$" && !path.startsWith("$.") && !path.startsWith("$["))) {
    throw new AppError(
      400,
      "invalid_data_source_timestamp_path",
      "REST timestampPath must be a JSON path starting with $ and contain at most 256 characters.",
    );
  }
  return path;
};

export const validateConnectionUrl = (
  value: unknown,
  protocols: string[],
  sourceLabel: string,
): string => {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > 2048) {
    throw new AppError(
      400,
      "invalid_data_source_url",
      `${sourceLabel} URL must contain 1 to 2048 characters.`,
    );
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new AppError(400, "invalid_data_source_url", `${sourceLabel} URL is not valid.`);
  }

  if (!protocols.includes(url.protocol)) {
    throw new AppError(
      400,
      "invalid_data_source_url",
      `${sourceLabel} URL must use ${protocols.join(" or ")}.`,
    );
  }
  if (url.username || url.password) {
    throw new AppError(
      400,
      "credentials_in_data_source_url",
      "Credentials cannot be embedded in a data source URL. Use credentialRef.",
    );
  }
  if (url.hash) {
    throw new AppError(400, "invalid_data_source_url", "Data source URL fragments are not supported.");
  }
  let sensitiveQueryKey: string | null = null;
  url.searchParams.forEach((_value, key) => {
    if (SENSITIVE_QUERY_KEY.test(key)) {
      sensitiveQueryKey = key;
    }
  });
  if (sensitiveQueryKey) {
    throw new AppError(
      400,
      "credentials_in_data_source_url",
      `Sensitive query parameter ${sensitiveQueryKey} cannot be stored in a data source URL. Use credentialRef.`,
    );
  }
  return url.toString();
};

const validateConfig = (
  sourceType: DataSourceType,
  value: unknown,
): DataSourceConfig => {
  const config = requireObject(value, "config");
  const endpointRef = config.endpointRef == null || config.endpointRef === "" ? undefined : validateCredentialRef(config.endpointRef) ?? undefined;
  if (endpointRef && config.url !== "") throw new AppError(400,"data_source_endpoint_conflict","Use either a logical endpoint reference or a direct URL.");
  if (config.collectionMode !== undefined && config.collectionMode !== "demand" && config.collectionMode !== "continuous") throw new AppError(400,"invalid_collection_mode","Collection mode must be demand or continuous.");
  if (config.timestampFormat !== undefined && !config.timestampPath) throw new AppError(400,"invalid_timestamp_format","A source time format requires a timestamp path.");
  const endpoint = { ...(config.timestampFormat !== undefined ? { timestampFormat:validateTimestampFormat(config.timestampFormat) }:{}), ...(endpointRef ? { endpointRef } : {}),...(config.collectionMode ? { collectionMode:config.collectionMode as "demand" | "continuous" } : {}) };
  if (sourceType === "mqtt") {
    assertKnownFields(config,new Set(["url","endpointRef","credentialRef","topic","collectionMode","timestampPath","timestampFormat","heartbeatSeconds","reconnectMaxSeconds","sampleIntervalMs"]),"unknown_data_source_config_field","MQTT config");
    const timestampPath = validateTimestampPath(config.timestampPath);
    if (!endpointRef || !timestampPath) throw new AppError(400,"invalid_mqtt_config","MQTT requires a private endpoint reference and a source timestamp path, including for retained messages.");
    return { ...endpoint,url:"",endpointRef,credentialRef:validateCredentialRef(config.credentialRef),topic:validateMqttTopic(config.topic),timestampPath,heartbeatSeconds:validateInteger(config.heartbeatSeconds,"config.heartbeatSeconds",5,300),reconnectMaxSeconds:validateInteger(config.reconnectMaxSeconds,"config.reconnectMaxSeconds",5,300),sampleIntervalMs:validateInteger(config.sampleIntervalMs,"config.sampleIntervalMs",16,60000) };
  }
  if (sourceType === "rest_polling") {
    assertKnownFields(
      config,
      REST_CONFIG_FIELDS,
      "unknown_data_source_config_field",
      "REST polling config",
    );
    return {
      url: endpointRef ? "" : validateConnectionUrl(config.url, ["http:", "https:"], "REST polling"),
      ...endpoint,
      intervalSeconds: validateInteger(
        config.intervalSeconds,
        "config.intervalSeconds",
        1,
        3600,
      ),
      timeoutMs: validateInteger(config.timeoutMs, "config.timeoutMs", 500, 30_000),
      timestampPath: validateTimestampPath(config.timestampPath),
      credentialRef: validateCredentialRef(config.credentialRef),
    };
  }

  assertKnownFields(
    config,
    WEBSOCKET_CONFIG_FIELDS,
    "unknown_data_source_config_field",
    "WebSocket config",
  );
  if (config.topics !== undefined && (!Array.isArray(config.topics) || config.topics.length > 32 || !config.topics.every((topic) => typeof topic === "string" && topic.length > 0 && topic.length <= 128 && !/[\u0000-\u001f\u007f]/.test(topic)))) throw new AppError(400,"invalid_websocket_topics","Use at most 32 printable subscription topics of at most 128 characters.");
  return {
    ...(config.timestampPath !== undefined ? { timestampPath:validateTimestampPath(config.timestampPath) } : {}),
    ...(config.sampleIntervalMs !== undefined ? { sampleIntervalMs:validateInteger(config.sampleIntervalMs,"config.sampleIntervalMs",16,60000) } : {}),
    ...(config.topics !== undefined ? { topics:[...new Set(config.topics as string[])] } : {}),
    url: endpointRef ? "" : validateConnectionUrl(config.url, ["ws:", "wss:"], "WebSocket"),
    ...endpoint,
    heartbeatSeconds: validateInteger(
      config.heartbeatSeconds,
      "config.heartbeatSeconds",
      5,
      300,
    ),
    reconnectMaxSeconds: validateInteger(
      config.reconnectMaxSeconds,
      "config.reconnectMaxSeconds",
      5,
      300,
    ),
    credentialRef: validateCredentialRef(config.credentialRef),
  };
};

export const validateDataSourceCreate = (body: JsonObject): DataSourceCreateInput => {
  assertKnownFields(body, dataSourceFields, "unknown_data_source_field", "data source");
  const sourceType = validateSourceType(body.sourceType);
  return {
    sourceType,
    name: validateName(body.name),
    config: validateConfig(sourceType, body.config),
  };
};

export const validateDataSourcePatch = (
  body: JsonObject,
  current: DataSource,
): DataSourcePatchInput => {
  assertKnownFields(body, dataSourceFields, "unknown_data_source_field", "data source");
  if (Object.keys(body).length === 0) {
    throw new AppError(
      400,
      "empty_data_source_patch",
      "Data source update must contain at least one field.",
    );
  }

  const sourceType = "sourceType" in body
    ? validateSourceType(body.sourceType)
    : current.sourceType;
  const patch: DataSourcePatchInput = {};
  if ("sourceType" in body) patch.sourceType = sourceType;
  if ("name" in body) patch.name = validateName(body.name);
  if ("config" in body) patch.config = validateConfig(sourceType, body.config);
  if ("sourceType" in body && !("config" in body) && sourceType !== current.sourceType) {
    throw new AppError(
      400,
      "data_source_config_required",
      "Changing data source type requires a matching config object.",
    );
  }
  return patch;
};

const parseStoredConfig = (row: DataSourceRow): DataSourceConfig => {
  let config: unknown;
  try {
    config = JSON.parse(row.config_json);
  } catch (error) {
    throw new AppError(
      500,
      "stored_data_source_config_invalid",
      `Data source ${row.id} has invalid config JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    return validateConfig(row.source_type, config);
  } catch (error) {
    if (error instanceof AppError) {
      throw new AppError(
        500,
        "stored_data_source_config_invalid",
        `Data source ${row.id} config is invalid: ${error.message}`,
      );
    }
    throw error;
  }
};

const presentDataSource = (row: DataSourceRow): DataSource => ({
  id: row.id,
  projectId: row.project_id,
  sourceType: row.source_type,
  name: row.name,
  config: parseStoredConfig(row),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const dataSourceColumns = `
  id, project_id, source_type, name, config_json, created_at, updated_at
`;

export const listDataSources = async (
  env: AppEnv,
  projectId: string,
): Promise<DataSource[]> => {
  const result = await env.DB.prepare(
    `SELECT ${dataSourceColumns}
     FROM data_sources
     WHERE project_id = ?
     ORDER BY updated_at DESC, name ASC`,
  )
    .bind(projectId)
    .all<DataSourceRow>();
  return (result.results ?? []).map(presentDataSource);
};

export const listContinuousDataSources = async (env:AppEnv,projectId?:string):Promise<DataSource[]> => {
  const result = await env.DB.prepare(`SELECT ${dataSourceColumns} FROM data_sources WHERE json_extract(config_json,'$.collectionMode') = 'continuous' AND (? IS NULL OR project_id = ?) ORDER BY project_id,id`).bind(projectId ?? null,projectId ?? null).all<DataSourceRow>();
  return result.results.map(presentDataSource);
};

export const getDataSource = async (
  env: AppEnv,
  projectId: string,
  dataSourceId: string,
): Promise<DataSource> => {
  const row = await env.DB.prepare(
    `SELECT ${dataSourceColumns}
     FROM data_sources
     WHERE project_id = ? AND id = ?`,
  )
    .bind(projectId, dataSourceId)
    .first<DataSourceRow>();
  if (!row) {
    throw new AppError(404, "data_source_not_found", "Data source was not found in this project.");
  }
  return presentDataSource(row);
};

export const createDataSource = async (
  env: AppEnv,
  projectId: string,
  input: DataSourceCreateInput,
): Promise<DataSource> => {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const configJson = JSON.stringify(input.config);
  await env.DB.prepare(
    `INSERT INTO data_sources (
      id, project_id, source_type, name, config_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, projectId, input.sourceType, input.name, configJson, now, now)
    .run();
  return {
    id,
    projectId,
    sourceType: input.sourceType,
    name: input.name,
    config: input.config,
    createdAt: now,
    updatedAt: now,
  };
};

export const updateDataSource = async (
  env: AppEnv,
  projectId: string,
  dataSourceId: string,
  body: JsonObject,
): Promise<DataSource> => {
  const current = await getDataSource(env, projectId, dataSourceId);
  const patch = validateDataSourcePatch(body, current);
  const next: DataSourceCreateInput = {
    sourceType: patch.sourceType ?? current.sourceType,
    name: patch.name ?? current.name,
    config: patch.config ?? current.config,
  };
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE data_sources
     SET source_type = ?, name = ?, config_json = ?, updated_at = ?
     WHERE project_id = ? AND id = ?`,
  )
    .bind(
      next.sourceType,
      next.name,
      JSON.stringify(next.config),
      now,
      projectId,
      dataSourceId,
    )
    .run();
  return {
    ...current,
    sourceType: next.sourceType,
    name: next.name,
    config: next.config,
    updatedAt: now,
  };
};
