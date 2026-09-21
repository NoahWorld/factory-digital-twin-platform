import { parseTwinActions, type TwinAction } from "../../../../shared/twin-actions";

export const TWIN_ACTION_EVENT_NAME = "factory-twin:actions:v1";
const MAX_EVENT_AGE_MS = 5 * 60 * 1000;
const MAX_CORRELATIONS = 512;
const MAX_SUBSCRIPTION_SCOPES = 32;

export type TwinActionEvent = {
  type: "twin-actions";
  version: 1;
  originProjectId: string;
  targetProjectId: string;
  correlationId: string;
  timestamp: string;
  actions: TwinAction[];
};
export type TwinActionSubscription = {
  targetProjectIds: readonly string[];
  allowedOriginProjectIds: readonly string[];
  onActions: (event: TwinActionEvent) => void;
  onError: (error: Error) => void;
};

// Pages execute locally before publishing. Suppress their own synchronous CustomEvent,
// including other subscribers sharing this page's runtime, without suppressing remote tabs.
const localPublished = new Map<string, number>();
const receivedByTarget = new Map<string, Map<string, number>>();

function subscriptionHistory(targetProjectId: string): Map<string, number> {
  const existing = receivedByTarget.get(targetProjectId);
  if (existing) return existing;
  const history = new Map<string, number>();
  receivedByTarget.set(targetProjectId, history);
  while (receivedByTarget.size > MAX_SUBSCRIPTION_SCOPES) receivedByTarget.delete(receivedByTarget.keys().next().value!);
  return history;
}

function remember(correlations: Map<string, number>, correlationId: string, now: number) {
  for (const [id, savedAt] of correlations) {
    if (savedAt < now - MAX_EVENT_AGE_MS) correlations.delete(id);
  }
  correlations.set(correlationId, now);
  while (correlations.size > MAX_CORRELATIONS) correlations.delete(correlations.keys().next().value!);
}

function identifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 128 || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`交互事件 ${name} 无效。`);
  return value;
}

/** No cast of untrusted messages to actions: validate the entire fixed envelope first. */
export function parseTwinActionEvent(value: unknown, now = Date.now()): TwinActionEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("交互事件必须是对象。");
  const input = value as Record<string, unknown>;
  const allowedKeys = new Set(["type", "version", "originProjectId", "targetProjectId", "correlationId", "timestamp", "actions"]);
  const unknownKey = Object.keys(input).find((key) => !allowedKeys.has(key));
  if (unknownKey) throw new Error(`交互事件包含不支持的字段 ${unknownKey}。`);
  if (input.type !== "twin-actions" || input.version !== 1) throw new Error("不支持的交互事件类型或版本。");
  const originProjectId = identifier(input.originProjectId, "originProjectId");
  const targetProjectId = identifier(input.targetProjectId, "targetProjectId");
  const correlationId = identifier(input.correlationId, "correlationId");
  if (typeof input.timestamp !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(input.timestamp)) throw new Error("交互事件时间戳格式无效。");
  const timestamp = Date.parse(input.timestamp);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > MAX_EVENT_AGE_MS) throw new Error(`交互事件 ${correlationId} 已过期或时间戳超前，已拒绝执行。`);
  const actions = parseTwinActions(input.actions);
  if (!actions.ok) throw new Error(`交互事件 ${correlationId}：${actions.message}`);
  const foreignFocus = actions.value.find((action) => action.type === "focus-model" && action.projectId !== targetProjectId);
  if (foreignFocus?.type === "focus-model") throw new Error(`交互事件 ${correlationId}：聚焦项目 ${foreignFocus.projectId} 与事件目标项目 ${targetProjectId} 不一致，整组动作未执行。`);
  return { type: "twin-actions", version: 1, originProjectId, targetProjectId, correlationId, timestamp: input.timestamp, actions: actions.value };
}

/** One receiver handles both delivery paths, so a toggle is applied once per correlation. */
export function createTwinActionReceiver({ targetProjectIds, allowedOriginProjectIds, onActions, onError }: TwinActionSubscription, history: Map<string, number> | ((targetProjectId: string) => Map<string, number>) = new Map<string, number>()) {
  const targets = new Set(targetProjectIds);
  const origins = new Set(allowedOriginProjectIds);
  return (value: unknown) => {
    // Other projects' events are not ours, including their validation failures.
    if (value && typeof value === "object" && "targetProjectId" in value && typeof value.targetProjectId === "string" && !targets.has(value.targetProjectId)) return;
    let event: TwinActionEvent | undefined;
    try {
      event = parseTwinActionEvent(value);
      if (!targets.has(event.targetProjectId)) return;
      if (!origins.has(event.originProjectId)) throw new Error(`拒绝来自未关联项目 ${event.originProjectId} 的交互事件（目标 ${event.targetProjectId}）。`);
      const seen = typeof history === "function" ? history(event.targetProjectId) : history;
      if (localPublished.has(event.correlationId) || seen.has(event.correlationId)) return;
      remember(seen, event.correlationId, Date.now());
      onActions(event);
    } catch (reason) {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      console.error("Twin action event rejected", { targetProjectIds, allowedOriginProjectIds, originProjectId: event?.originProjectId, correlationId: event?.correlationId, reason });
      onError(error);
    }
  };
}

/** Call only after the originating page's local execute returned true. */
export function publishTwinActions({ originProjectId, targetProjectId, actions }: {
  originProjectId: string;
  targetProjectId: string;
  actions: readonly TwinAction[];
}): TwinActionEvent {
  const event = parseTwinActionEvent({ type: "twin-actions", version: 1, originProjectId, targetProjectId, actions, correlationId: crypto.randomUUID(), timestamp: new Date().toISOString() });
  remember(localPublished, event.correlationId, Date.now());
  window.dispatchEvent(new CustomEvent(TWIN_ACTION_EVENT_NAME, { detail: event }));
  let channel: BroadcastChannel | undefined;
  try {
    if (typeof BroadcastChannel === "undefined") throw new Error("浏览器不支持 BroadcastChannel。");
    channel = new BroadcastChannel(TWIN_ACTION_EVENT_NAME);
    channel.postMessage(event);
  } catch (reason) {
    console.error("Twin action broadcast failed", { originProjectId, targetProjectId, correlationId: event.correlationId, reason });
    throw new Error(`本页交互已执行，但无法同步其他页面：${reason instanceof Error ? reason.message : String(reason)}`);
  } finally {
    channel?.close();
  }
  return event;
}

export function subscribeTwinActions(options: TwinActionSubscription): () => void {
  // Keep per-target history when effects rerender or asynchronously discover additional
  // scene targets; a delayed second transport must not replay the original target's action.
  const receive = createTwinActionReceiver(options, subscriptionHistory);
  const onCustomEvent = (event: Event) => receive((event as CustomEvent<unknown>).detail);
  window.addEventListener(TWIN_ACTION_EVENT_NAME, onCustomEvent);
  let channel: BroadcastChannel | undefined;
  try {
    if (typeof BroadcastChannel === "undefined") throw new Error("浏览器不支持 BroadcastChannel。");
    channel = new BroadcastChannel(TWIN_ACTION_EVENT_NAME);
    channel.onmessage = (event: MessageEvent<unknown>) => receive(event.data);
    channel.onmessageerror = () => {
      const error = new Error("无法解码跨页面交互消息，消息未执行。");
      console.error("Twin action message could not be decoded", { targetProjectIds: options.targetProjectIds });
      options.onError(error);
    };
  } catch (reason) {
    const error = new Error(`无法接收跨页面交互：${reason instanceof Error ? reason.message : String(reason)}`);
    console.error("Twin action subscription failed", { targetProjectIds: options.targetProjectIds, reason });
    options.onError(error);
  }
  return () => {
    window.removeEventListener(TWIN_ACTION_EVENT_NAME, onCustomEvent);
    channel?.close();
  };
}
