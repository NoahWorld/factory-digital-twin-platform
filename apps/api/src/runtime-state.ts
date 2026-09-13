import { listAssetDataBindings, type AssetDataBinding } from "./asset-data-bindings";
import { getAsset, type Asset } from "./assets";
import { AppError, type AppEnv } from "./auth";
import { getDataSource, type DataSource, type RestPollingConfig } from "./data-sources";

const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_DISCOVERED_FIELDS = 200;
const MAX_DISCOVERY_DEPTH = 8;
const MAX_DISCOVERED_ARRAY_ITEMS = 10;
const MAX_SAMPLE_STRING_LENGTH = 160;

export type RuntimeMetricValue = number | string | boolean | null;

export type AssetRuntimeState = {
  asset: Pick<Asset, "id" | "assetId" | "assetType" | "modelNode" | "name">;
  timestamp: string;
  values: Record<string, RuntimeMetricValue>;
  metrics: Array<{
    bindingId: string;
    metricKey: string;
    value: RuntimeMetricValue;
    valueType: AssetDataBinding["valueType"];
    unit: string | null;
    staleAfterSeconds: number;
  }>;
  sources: Array<{
    id: string;
    name: string;
    collectedAt: string;
    sourceTimestamp: string | null;
    durationMs: number;
    staleAfterSeconds: number;
  }>;
  pollAfterSeconds: number;
  staleAfterSeconds: number;
};

export type RestDataSourceProbe = {
  dataSource: Pick<DataSource, "id" | "name" | "sourceType">;
  collectedAt: string;
  sourceTimestamp: string | null;
  sourceAgeSeconds: number | null;
  durationMs: number;
  responseBytes: number;
  fields: Array<{
    path: string;
    valueType: "number" | "string" | "boolean" | "null";
    sample: number | string | boolean | null;
  }>;
  fieldsTruncated: boolean;
};

type JsonPathToken = string | number;

const parseJsonPath = (path: string): JsonPathToken[] => {
  if (path === "$") return [];
  const tokens: JsonPathToken[] = [];
  let cursor = 1;

  while (cursor < path.length) {
    if (path[cursor] === ".") {
      const start = cursor + 1;
      cursor = start;
      while (cursor < path.length && path[cursor] !== "." && path[cursor] !== "[") {
        cursor += 1;
      }
      const key = path.slice(start, cursor);
      if (!key || /\s/.test(key)) {
        throw new AppError(422, "unsupported_source_path", `Unsupported JSON path segment in ${path}.`);
      }
      tokens.push(key);
      continue;
    }

    if (path[cursor] === "[") {
      const closing = path.indexOf("]", cursor + 1);
      if (closing < 0) {
        throw new AppError(422, "unsupported_source_path", `JSON path ${path} has an unclosed bracket.`);
      }
      const expression = path.slice(cursor + 1, closing);
      if (/^(?:0|[1-9]\d*)$/.test(expression)) {
        tokens.push(Number(expression));
      } else if (
        (expression.startsWith("\"") && expression.endsWith("\""))
        || (expression.startsWith("'") && expression.endsWith("'"))
      ) {
        const key = expression.slice(1, -1);
        if (!key || key.includes("\\")) {
          throw new AppError(422, "unsupported_source_path", `Escaped or empty bracket keys are not supported in ${path}.`);
        }
        tokens.push(key);
      } else {
        throw new AppError(422, "unsupported_source_path", `Only object keys and array indexes are supported in ${path}.`);
      }
      cursor = closing + 1;
      continue;
    }

    throw new AppError(422, "unsupported_source_path", `Unsupported JSON path syntax in ${path}.`);
  }

  return tokens;
};

const resolveJsonPath = (
  payload: unknown,
  path: string,
  context: string,
): unknown => {
  let current = payload;
  for (const token of parseJsonPath(path)) {
    if (typeof token === "number") {
      if (!Array.isArray(current) || token >= current.length) {
        throw new AppError(
          422,
          "source_path_not_found",
          `${context} cannot resolve array index ${token} from ${path}.`,
        );
      }
      current = current[token];
      continue;
    }

    if (
      !current
      || typeof current !== "object"
      || Array.isArray(current)
      || !Object.prototype.hasOwnProperty.call(current, token)
    ) {
      throw new AppError(
        422,
        "source_path_not_found",
        `${context} cannot resolve field ${token} from ${path}.`,
      );
    }
    current = (current as Record<string, unknown>)[token];
  }
  return current;
};

const inspectSourceTimestamp = (
  payload: unknown,
  source: DataSource,
  config: RestPollingConfig,
): { sourceTimestamp: string | null; sourceAgeSeconds: number | null } => {
  if (!config.timestampPath) {
    return { sourceTimestamp: null, sourceAgeSeconds: null };
  }
  const value = resolveJsonPath(
    payload,
    config.timestampPath,
    `Data source ${source.id} timestampPath`,
  );
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new AppError(
      422,
      "source_timestamp_invalid",
      `Data source ${source.id} timestampPath must resolve to an ISO-compatible timestamp string.`,
    );
  }

  const timestampMs = Date.parse(value);
  const now = Date.now();
  const futureToleranceMs = 5 * 60 * 1000;
  if (timestampMs > now + futureToleranceMs) {
    throw new AppError(
      502,
      "data_source_timestamp_in_future",
      `Data source ${source.id} timestamp is more than 300 seconds ahead of the server clock.`,
    );
  }
  return {
    sourceTimestamp: new Date(timestampMs).toISOString(),
    sourceAgeSeconds: Math.max(0, Math.floor((now - timestampMs) / 1000)),
  };
};

const sourceTimestamp = (
  payload: unknown,
  source: DataSource,
  config: RestPollingConfig,
  staleAfterSeconds: number,
): string | null => {
  const inspected = inspectSourceTimestamp(payload, source, config);
  if (
    inspected.sourceAgeSeconds !== null
    && inspected.sourceAgeSeconds > staleAfterSeconds
  ) {
    throw new AppError(
      502,
      "data_source_stale",
      `Data source ${source.id} timestamp is ${inspected.sourceAgeSeconds} seconds old; the configured limit is ${staleAfterSeconds} seconds.`,
    );
  }
  return inspected.sourceTimestamp;
};

const sampleValue = (value: string): string => value.length > MAX_SAMPLE_STRING_LENGTH
  ? `${value.slice(0, MAX_SAMPLE_STRING_LENGTH)}…`
  : value;

const objectPath = (parentPath: string, key: string): string | null => {
  if (key.length === 0 || key.includes("\\") || key.includes("'") || /[\u0000-\u001f\u007f]/.test(key)) {
    return null;
  }
  return /^[^.[\]\s]+$/.test(key)
    ? `${parentPath}.${key}`
    : `${parentPath}['${key}']`;
};

const discoverScalarFields = (
  payload: unknown,
): Pick<RestDataSourceProbe, "fields" | "fieldsTruncated"> => {
  const fields: RestDataSourceProbe["fields"] = [];
  let fieldsTruncated = false;

  const visit = (value: unknown, path: string, depth: number): void => {
    if (fields.length >= MAX_DISCOVERED_FIELDS) {
      fieldsTruncated = true;
      return;
    }
    if (value === null) {
      fields.push({ path, valueType: "null", sample: null });
      return;
    }
    if (typeof value === "string") {
      fields.push({ path, valueType: "string", sample: sampleValue(value) });
      return;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      fields.push({ path, valueType: "number", sample: value });
      return;
    }
    if (typeof value === "boolean") {
      fields.push({ path, valueType: "boolean", sample: value });
      return;
    }
    if (depth >= MAX_DISCOVERY_DEPTH) {
      fieldsTruncated = true;
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > MAX_DISCOVERED_ARRAY_ITEMS) fieldsTruncated = true;
      value.slice(0, MAX_DISCOVERED_ARRAY_ITEMS).forEach((item, index) => {
        visit(item, `${path}[${index}]`, depth + 1);
      });
      return;
    }
    if (typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        const childPath = objectPath(path, key);
        if (childPath === null) {
          fieldsTruncated = true;
          continue;
        }
        visit(child, childPath, depth + 1);
        if (fields.length >= MAX_DISCOVERED_FIELDS) break;
      }
    }
  };

  visit(payload, "$", 0);
  return { fields, fieldsTruncated };
};

const validateMetricValue = (
  binding: AssetDataBinding,
  value: unknown,
): RuntimeMetricValue => {
  // Null means the upstream has no value. Keep it distinct from numeric zero.
  if (value === null) return null;
  if (binding.valueType === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new AppError(422, "metric_type_mismatch", `Metric ${binding.metricKey} must resolve to a finite number.`);
    }
    return value;
  }
  if (binding.valueType === "boolean") {
    if (typeof value !== "boolean") {
      throw new AppError(422, "metric_type_mismatch", `Metric ${binding.metricKey} must resolve to a boolean.`);
    }
    return value;
  }
  if (binding.valueType === "timestamp") {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
      throw new AppError(422, "metric_type_mismatch", `Metric ${binding.metricKey} must resolve to an ISO-compatible timestamp string.`);
    }
    return new Date(value).toISOString();
  }
  if (typeof value !== "string") {
    throw new AppError(422, "metric_type_mismatch", `Metric ${binding.metricKey} must resolve to a string.`);
  }
  return value;
};

const runtimeHosts = (env: AppEnv): Set<string> => new Set(
  (env.RUNTIME_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
);

const requireRestConfig = (source: DataSource): RestPollingConfig => {
  if (source.sourceType !== "rest_polling") {
    throw new AppError(
      409,
      "runtime_source_not_supported",
      `Data source ${source.id} uses ${source.sourceType}; this local vertical slice executes REST polling only.`,
    );
  }
  if (!("intervalSeconds" in source.config)) {
    throw new AppError(500, "stored_data_source_config_invalid", `REST data source ${source.id} does not contain REST polling config.`);
  }
  return source.config;
};

const readLimitedText = async (
  response: Response,
  sourceId: string,
): Promise<{ text: string; byteSize: number }> => {
  if (!response.body) return { text: "", byteSize: 0 };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    totalBytes += result.value.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel("Runtime response size limit exceeded.");
      throw new AppError(
        502,
        "data_source_response_too_large",
        `Data source ${sourceId} returned more than ${MAX_RESPONSE_BYTES} response bytes.`,
      );
    }
    chunks.push(result.value);
  }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(body), byteSize: totalBytes };
};

const rejectPrivateEcho = (payload:unknown,config:RestPollingConfig,headers:Record<string,string>):void => {
  const secrets = new Set(Object.values(headers).filter(Boolean));
  const authorization = headers.authorization;
  const bearer = authorization?.match(/^Bearer +(.+?) *$/i),basic = authorization?.match(/^Basic +(\S+) *$/i);
  if (bearer) secrets.add(bearer[1]);
  if (basic) {
    try {
      const bytes = atob(basic[1]),unicode = new TextDecoder().decode(Uint8Array.from(bytes,(character) => character.charCodeAt(0)));
      for (const decoded of [bytes,unicode]) { secrets.add(decoded); const colon = decoded.indexOf(":"); if (colon >= 0) secrets.add(decoded.slice(colon+1)); }
    } catch { /* Invalid header is handled by upstream authentication. */ }
  }
  if (headers.cookie) for (const cookie of headers.cookie.split(";")) { const index = cookie.indexOf("="); if (index >= 0) secrets.add(cookie.slice(index+1).trim()); }
  if (config.endpointRef) { const endpoint = new URL(config.url); secrets.add(endpoint.href); secrets.add(endpoint.host); secrets.add(endpoint.hostname); secrets.add(endpoint.hostname.replace(/^\[|\]$/g,"")); }
  secrets.delete(""); if (!secrets.size) return;
  const contains = (value:string) => [...secrets].some((secret) => value.includes(secret));
  const pending:unknown[] = [payload];
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === "string" && contains(value)) throw new AppError(502,"data_source_private_echo","Upstream echoed private environment information; the response was rejected.");
    if (value && typeof value === "object") for (const [key,item] of Object.entries(value)) {
      if (contains(key)) throw new AppError(502,"data_source_private_echo","Upstream echoed private environment information; the response was rejected.");
      pending.push(item);
    }
  }
};

const fetchJson = async (
  source: DataSource,
  config: RestPollingConfig,
  requestId: string,
  signal?: AbortSignal,
  headers: Record<string,string> = {},
): Promise<{
  payload: unknown;
  collectedAt: string;
  durationMs: number;
  responseBytes: number;
}> => {
  if (signal?.aborted) throw new AppError(499,"data_source_cancelled",`Data source ${source.id} collection was cancelled.`);
  const controller = new AbortController();
  const cancel = () => controller.abort(); signal?.addEventListener("abort",cancel,{ once: true });
  let response: Response | undefined, consumed = false;
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const startedAt = Date.now();
  try {
    response = await fetch(config.url, {
      headers: {
        ...headers,
        accept: "application/json",
        "x-factory-twin-request-id": requestId,
      },
      redirect: "manual",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new AppError(502, "data_source_http_error", `Data source ${source.id} returned HTTP ${response.status}.`);
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      throw new AppError(502, "data_source_response_too_large", `Data source ${source.id} declared more than ${MAX_RESPONSE_BYTES} response bytes.`);
    }
    const { text, byteSize } = await readLimitedText(response, source.id); consumed = true;
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new AppError(502, "data_source_invalid_json", `Data source ${source.id} did not return valid JSON.`);
    }
    rejectPrivateEcho(payload,config,headers);
    return {
      payload,
      collectedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      responseBytes: byteSize,
    };
  } catch (error) {
    if (signal?.aborted) throw new AppError(499,"data_source_cancelled",`Data source ${source.id} collection was cancelled.`);
    if (error instanceof AppError) throw error;
    if (controller.signal.aborted) {
      throw new AppError(504, "data_source_timeout", `Data source ${source.id} exceeded its ${config.timeoutMs} ms timeout.`);
    }
    throw new AppError(
      502,
      "data_source_request_failed",
      `Data source ${source.id} request failed.`,
    );
  } finally {
    if (response && !consumed) { controller.abort(); await response.body?.cancel().catch(() => {}); }
    clearTimeout(timeout); signal?.removeEventListener("abort",cancel);
  }
};

const requireAllowedRestSource = (
  env: AppEnv,
  source: DataSource,
): { config:RestPollingConfig;headers:Record<string,string> } => {
  if (env.RUNTIME_POLLING_ENABLED !== "true") {
    throw new AppError(503, "runtime_polling_disabled", "REST runtime polling is disabled on this server.");
  }
  const allowedHosts = runtimeHosts(env);
  if (allowedHosts.size === 0) {
    throw new AppError(503, "runtime_allowed_hosts_missing", "REST runtime polling requires at least one explicitly allowed host.");
  }
  const original = requireRestConfig(source);
  if (!env.RESOLVE_SOURCE && (original.endpointRef || original.credentialRef)) throw new AppError(503,"source_environment_unavailable","This source requires server environment configuration.");
  const resolved = env.RESOLVE_SOURCE?.(source) ?? { url:original.url,headers:{} };
  const config = { ...original,url:resolved.url };
  const url = new URL(config.url);
  if (!allowedHosts.has(url.host.toLowerCase())) {
    throw new AppError(
      403,
      "runtime_data_source_host_not_allowed",
      `Data source ${source.id} host is not in RUNTIME_ALLOWED_HOSTS.`,
    );
  }
  return { config,headers:resolved.headers };
};

export const probeRestDataSource = async (
  env: AppEnv,
  projectId: string,
  dataSourceId: string,
  requestId: string,
  signal?: AbortSignal,
): Promise<RestDataSourceProbe> => {
  const source = await getDataSource(env, projectId, dataSourceId);
  const { config,headers } = requireAllowedRestSource(env, source);
  const fetched = await fetchJson(source, config, requestId,signal,headers);
  const timestamp = inspectSourceTimestamp(fetched.payload, source, config);
  const discovery = discoverScalarFields(fetched.payload);
  return {
    dataSource: {
      id: source.id,
      name: source.name,
      sourceType: source.sourceType,
    },
    collectedAt: fetched.collectedAt,
    sourceTimestamp: timestamp.sourceTimestamp,
    sourceAgeSeconds: timestamp.sourceAgeSeconds,
    durationMs: fetched.durationMs,
    responseBytes: fetched.responseBytes,
    ...discovery,
  };
};

export type SourceSample = Awaited<ReturnType<typeof fetchJson>>;
export type RuntimeAssetPlan = { asset: Asset; bindings: AssetDataBinding[]; sources: DataSource[] };

export const loadRuntimeAssetPlan = async (env: AppEnv, projectId: string, assetRecordId: string): Promise<RuntimeAssetPlan> => {
  const [asset, bindings] = await Promise.all([getAsset(env, projectId, assetRecordId),listAssetDataBindings(env, projectId, assetRecordId)]);
  if (!bindings.length) throw new AppError(409,"asset_data_binding_required",`Asset ${asset.assetId} has no data bindings.`);
  const sources = await Promise.all([...new Set(bindings.map((binding) => binding.dataSourceId))].map((id) => getDataSource(env,projectId,id)));
  return { asset,bindings,sources };
};

export const fetchRuntimeSource = (env: AppEnv, source: DataSource, requestId: string, signal?: AbortSignal): Promise<SourceSample> => {
  const { config,headers } = requireAllowedRestSource(env,source);
  return fetchJson(source,config,requestId,signal,headers);
};

export const normalizeRuntimeAsset = (plan: RuntimeAssetPlan, samples: Map<string,SourceSample>): AssetRuntimeState => {
  const { asset,bindings } = plan;
  const sourceResults = plan.sources.map((source) => {
    const config = requireRestConfig(source), sample = samples.get(source.id);
    if (!sample) throw new AppError(503,"data_source_pending","Waiting for the first source sample.");
    const sourceBindings = bindings.filter((binding) => binding.dataSourceId === source.id);
    return { source,config,bindings: sourceBindings,...sample,
      sourceTimestamp: sourceTimestamp(sample.payload,source,config,Math.min(...sourceBindings.map((binding) => binding.staleAfterSeconds))) };
  });
  const values: Record<string, RuntimeMetricValue> = {};
  const metrics: AssetRuntimeState["metrics"] = [];
  const sources: AssetRuntimeState["sources"] = [];
  for (const result of sourceResults) {
    sources.push({
      id: result.source.id,
      name: result.source.name,
      collectedAt: result.collectedAt,
      sourceTimestamp: result.sourceTimestamp,
      durationMs: result.durationMs,
      staleAfterSeconds: Math.min(...result.bindings.map((binding) => binding.staleAfterSeconds)),
    });
    for (const binding of result.bindings) {
      const value = validateMetricValue(
        binding,
        resolveJsonPath(
          result.payload,
          binding.sourcePath,
          `Binding ${binding.id}`,
        ),
      );
      values[binding.metricKey] = value;
      metrics.push({
        bindingId: binding.id,
        metricKey: binding.metricKey,
        value,
        valueType: binding.valueType,
        unit: binding.unit,
        staleAfterSeconds: binding.staleAfterSeconds,
      });
    }
  }

  const timestamp = sources.reduce(
    (latest, source) => {
      const timestamp = source.sourceTimestamp ?? source.collectedAt;
      return timestamp > latest ? timestamp : latest;
    },
    sources[0]!.sourceTimestamp ?? sources[0]!.collectedAt,
  );
  return {
    asset: {
      id: asset.id,
      assetId: asset.assetId,
      assetType: asset.assetType,
      modelNode: asset.modelNode,
      name: asset.name,
    },
    timestamp,
    values,
    metrics,
    sources,
    pollAfterSeconds: Math.min(...sourceResults.map((result) => result.config.intervalSeconds)),
    staleAfterSeconds: Math.min(...bindings.map((binding) => binding.staleAfterSeconds)),
  };
};


export const collectAssetRuntimeState = async (env: AppEnv, projectId: string, assetRecordId: string, requestId: string, signal?: AbortSignal): Promise<AssetRuntimeState> => {
  const plan = await loadRuntimeAssetPlan(env,projectId,assetRecordId);
  const controller = new AbortController(),cancel = () => controller.abort();
  signal?.addEventListener("abort",cancel,{ once: true }); if (signal?.aborted) cancel();
  const tasks = plan.sources.map(async (source) => [source.id,await fetchRuntimeSource(env,source,requestId,controller.signal)] as const);
  try { return normalizeRuntimeAsset(plan,new Map(await Promise.all(tasks))); }
  catch (reason) { controller.abort(); await Promise.allSettled(tasks); throw reason; }
  finally { signal?.removeEventListener("abort",cancel); }
};
