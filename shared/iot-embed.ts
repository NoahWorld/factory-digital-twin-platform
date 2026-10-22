import { parseStateBinding } from "./process-control";
/** Optional point input. These values never become saved configuration. */
export const IOT_EMBED_CHANNEL = "kingdom.iot.points" as const;
export const IOT_EMBED_VERSION = 1 as const;
export const IOT_MAX_POINTS = 500;
export const IOT_BINDING_LIMITS = { maxPointKeyLength: 200, maxStaleAfterSeconds: 86400, maxPointCount: IOT_MAX_POINTS } as const;
export const IOT_BINDABLE_NODE_TYPES = ["plain-text", "metric-card", "radial-gauge"] as const;
export type IotValueType = "number" | "string" | "boolean";
export type IotBinding = { pointKey: string; valueType: IotValueType; staleAfterSeconds: number };
export type IotPoint = { key: string; valueType: IotValueType; staleAfterSeconds: number };
export type IotPointValue = { key: string; value: number | string | boolean | null; timestamp: number; quality: "good" | "bad" | "unknown" };
export type IotConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected" | "error";
type Envelope = { channel: typeof IOT_EMBED_CHANNEL; version: typeof IOT_EMBED_VERSION; sessionId: string };
export type IotParentMessage = Envelope & (
  | { type: "hello" }
  | { type: "snapshot" | "updates"; values: IotPointValue[] }
  | { type: "status"; status: IotConnectionStatus; retryCount: number; error?: string }
);
export type IotReadyMessage = Envelope & { type: "ready"; points: IotPoint[]; error?: string };
/** A newly mounted preview has no session yet; only its trusted parent can issue hello. */
export type IotRequestHelloMessage = { channel: typeof IOT_EMBED_CHANNEL; version: typeof IOT_EMBED_VERSION; type: "request-hello" };
export type IotResult<T> = { ok: true; value: T } | { ok: false; message: string };
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const identifier = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
const valueType = (value: unknown): value is IotValueType => value === "number" || value === "string" || value === "boolean";
export const isIotBindableNodeType = (type: string) => (IOT_BINDABLE_NODE_TYPES as readonly string[]).includes(type);

export function parseIotBinding(value: unknown, nodeType: string): IotResult<IotBinding> {
  if (!isIotBindableNodeType(nodeType)) return { ok: false, message: `组件 ${nodeType} 不支持外部 IoT 点位。` };
  if (!object(value) || Object.keys(value).some((key) => !["pointKey", "valueType", "staleAfterSeconds"].includes(key))) return { ok: false, message: "IoT 绑定必须是仅包含 pointKey、valueType、staleAfterSeconds 的对象。" };
  if (!identifier(value.pointKey, IOT_BINDING_LIMITS.maxPointKeyLength)) return { ok: false, message: "点位名称须为 1–200 个字符，不能包含控制字符或首尾空格。" };
  if (!valueType(value.valueType) || (nodeType === "radial-gauge" && value.valueType !== "number")) return { ok: false, message: "点位类型须为 number/string/boolean；环形进度仅支持 number。" };
  if (typeof value.staleAfterSeconds !== "number" || !Number.isInteger(value.staleAfterSeconds) || value.staleAfterSeconds < 1 || value.staleAfterSeconds > IOT_BINDING_LIMITS.maxStaleAfterSeconds) return { ok: false, message: "数据过期时间须为 1–86400 秒的整数。" };
  return { ok: true, value: { pointKey: value.pointKey, valueType: value.valueType, staleAfterSeconds: value.staleAfterSeconds } };
}

export function buildIotPointManifest(nodes: readonly { id: string; type: string; iotBinding?: unknown; stateBinding?: unknown }[]): IotResult<IotPoint[]> {
  const points = new Map<string, IotPoint>();
  for (const node of nodes) {
    for (const field of ["iotBinding", "stateBinding"] as const) {
    if (node[field] === undefined) continue;
    const parsed = field === "iotBinding" ? parseIotBinding(node.iotBinding, node.type) : parseStateBinding(node.stateBinding);
    if (!parsed.ok) return { ok: false, message: `组件 ${node.id}：${parsed.message}` };
    const binding = parsed.value;
    const previous = points.get(binding.pointKey);
    if (previous && previous.valueType !== binding.valueType) return { ok: false, message: `点位 ${binding.pointKey} 在多个组件中的数据类型不一致。` };
    points.set(binding.pointKey, { key: binding.pointKey, valueType: binding.valueType, staleAfterSeconds: Math.min(previous?.staleAfterSeconds ?? binding.staleAfterSeconds, binding.staleAfterSeconds) });
    if (points.size > IOT_MAX_POINTS) return { ok: false, message: `每个画面最多绑定 ${IOT_MAX_POINTS} 个不同点位。` };
    }
  }
  return { ok: true, value: [...points.values()] };
}

export function parseIotParentMessage(input: unknown): IotResult<IotParentMessage> {
  if (!object(input) || input.channel !== IOT_EMBED_CHANNEL || input.version !== IOT_EMBED_VERSION || !identifier(input.sessionId, 128)) return { ok: false, message: "IoT 消息通道、版本或会话标识无效。" };
  const envelope: Envelope = { channel: IOT_EMBED_CHANNEL, version: IOT_EMBED_VERSION, sessionId: input.sessionId };
  if (input.type === "hello") return { ok: true, value: { ...envelope, type: "hello" } };
  if (input.type === "status") {
    if (!["connecting", "connected", "reconnecting", "disconnected", "error"].includes(String(input.status)) || typeof input.retryCount !== "number" || !Number.isInteger(input.retryCount) || input.retryCount < 0 || input.retryCount > 1_000_000 || (input.error !== undefined && (typeof input.error !== "string" || input.error.length > 2000))) return { ok: false, message: "IoT 连接状态、重试次数或错误说明无效。" };
    return { ok: true, value: { ...envelope, type: "status", status: input.status as IotConnectionStatus, retryCount: input.retryCount, ...(input.error === undefined ? {} : { error: input.error as string }) } };
  }
  if (input.type !== "snapshot" && input.type !== "updates") return { ok: false, message: "IoT 消息类型无效。" };
  if (!Array.isArray(input.values) || input.values.length > IOT_MAX_POINTS) return { ok: false, message: `每条 IoT 消息最多包含 ${IOT_MAX_POINTS} 个点位。` };
  const keys = new Set<string>();
  const values: IotPointValue[] = [];
  for (const item of input.values) {
    if (!object(item) || !identifier(item.key, IOT_BINDING_LIMITS.maxPointKeyLength) || keys.has(item.key) || !["good", "bad", "unknown"].includes(String(item.quality)) || typeof item.timestamp !== "number" || !Number.isSafeInteger(item.timestamp) || item.timestamp < 0 || (item.quality === "good" && item.timestamp === 0)) return { ok: false, message: "IoT 点位名称、质量或源时间戳无效（同批点位不能重复）。" };
    if (!(item.value === null || typeof item.value === "boolean" || (typeof item.value === "string" && item.value.length <= 1000) || (typeof item.value === "number" && Number.isFinite(item.value))) || (item.quality === "good" && item.value === null)) return { ok: false, message: `IoT 点位 ${item.key} 的值须为有效标量，正常质量不可为空。` };
    keys.add(item.key);
    values.push({ key: item.key, value: item.value as IotPointValue["value"], timestamp: item.timestamp, quality: item.quality as IotPointValue["quality"] });
  }
  return { ok: true, value: { ...envelope, type: input.type, values } };
}

export function parseIotEmbedOptions(search: string): IotResult<{ enabled: false } | { enabled: true; parentOrigin: string }> {
  const params = new URLSearchParams(search);
  if (params.get("iotEmbed") !== "1") return { ok: true, value: { enabled: false } };
  const origin = params.get("parentOrigin");
  if (!origin) return { ok: false, message: "IoT 嵌入缺少 parentOrigin。" };
  let url: URL;
  try { url = new URL(origin); } catch { return { ok: false, message: "IoT parentOrigin 不是有效来源。" }; }
  if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin || url.username || url.password) return { ok: false, message: "IoT parentOrigin 必须是精确的 HTTP(S) 来源，不能包含路径、凭据或通配符。" };
  return { ok: true, value: { enabled: true, parentOrigin: origin } };
}
