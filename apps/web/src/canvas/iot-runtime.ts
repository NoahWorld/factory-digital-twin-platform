import { parseIotBinding, type IotConnectionStatus, type IotParentMessage, type IotPoint, type IotPointValue } from "../../../../shared/iot-embed";
import { parseBasicProps, parseDashboardProps, type CanvasNode } from "./types";
import { evaluateStateBinding } from "../../../../shared/process-control";
import type { FluidDefinition } from "../../../../shared/fluids";

export type IotRuntimeState = {
  sessionId: string | null;
  status: IotConnectionStatus;
  retryCount: number;
  error: string | null;
  values: Record<string, IotPointValue>;
};
export const initialIotRuntimeState = (): IotRuntimeState => ({ sessionId: null, status: "connecting", retryCount: 0, error: null, values: Object.create(null) });
export type IotRuntimeNode = { node: CanvasNode; unavailable: string | null; stateColor?: string; stateLabel?: string; visible?: boolean };

/** Source and origin are checked before parsing or accepting a new session. */
export const isTrustedIotEvent = (event: { source: unknown; origin: string }, parent: unknown, origin: string) => event.source === parent && event.origin === origin;

export function receiveIotMessage(state: IotRuntimeState, message: IotParentMessage, points: readonly IotPoint[], now: number): IotRuntimeState {
  if (message.type === "hello") return message.sessionId === state.sessionId ? state : { ...initialIotRuntimeState(), sessionId: message.sessionId };
  if (message.sessionId !== state.sessionId) return state;
  if (message.type === "status") return { ...state, status: message.status, retryCount: message.retryCount, error: message.error ?? null, ...(message.status === "connected" ? {} : { values: Object.create(null) }) };
  const definitions = new Map(points.map((point) => [point.key, point]));
  const values: Record<string, IotPointValue> = Object.assign(Object.create(null), message.type === "snapshot" ? {} : state.values);
  for (const item of message.values) {
    const definition = definitions.get(item.key);
    const error = !definition ? `宿主发送了未声明的点位 ${item.key}。`
      : item.quality === "good" && typeof item.value !== definition.valueType ? `点位 ${item.key} 类型不匹配：期望 ${definition.valueType}。`
      : item.timestamp > now + 300_000 ? `点位 ${item.key} 的源时间超前超过 5 分钟。` : null;
    if (error) return { ...state, status: "error", error, values: Object.create(null) };
    const previous = state.values[item.key];
    // A late initial snapshot must not overwrite a newer live observation.
    values[item.key] = previous && previous.quality === "good" && item.quality === "good" && previous.timestamp > item.timestamp ? previous : item;
  }
  return { ...state, values };
}

const statusText: Record<IotConnectionStatus, string> = {
  connecting: "等待 IoT 连接", connected: "等待点位数据", reconnecting: "网络异常／正在重连", disconnected: "IoT 连接已断开", error: "IoT 数据异常",
};
function projectIotValueNode(node: CanvasNode, state: IotRuntimeState, now: number, setupError: string | null = null): IotRuntimeNode {
  if (node.iotBinding === undefined) return { node, unavailable: null };
  const binding = parseIotBinding(node.iotBinding, node.type);
  const unavailable = (message: string): IotRuntimeNode => ({ node, unavailable: message });
  if (!binding.ok) return unavailable(binding.message);
  if (setupError) return unavailable(setupError);
  if (state.status !== "connected") return unavailable(`${statusText[state.status]}${state.status === "reconnecting" ? `（第 ${state.retryCount} 次）` : ""}${state.error ? `：${state.error}` : ""}`);
  if (state.error) return unavailable(state.error);
  const point = state.values[binding.value.pointKey];
  if (!point || point.quality === "unknown") return unavailable("点位数据未知");
  if (point.quality === "bad") return unavailable("点位质量异常");
  if (point.timestamp > now + 300_000) return unavailable("点位源时间异常");
  if (now - point.timestamp > binding.value.staleAfterSeconds * 1000) return unavailable("数据已过期");
  if (point.value === null || typeof point.value !== binding.value.valueType) return unavailable("点位值类型不匹配");
  const props = node.type === "plain-text" ? { ...node.props, text: String(point.value) }
    : { ...node.props, sample: false, value: node.type === "radial-gauge" ? point.value : String(point.value) };
  const parsed = node.type === "plain-text" ? parseBasicProps("plain-text", props) : parseDashboardProps(node.type as "metric-card" | "radial-gauge", props);
  if (!parsed.ok) return unavailable(`点位无法显示：${parsed.message}`);
  return { node: { ...node, props }, unavailable: null };
}

export function iotConnectionError(state: IotRuntimeState, setupError: string | null = null): string | null {
  if (setupError) return setupError;
  if (state.status === "connected") return state.error;
  return `${state.status === "reconnecting" ? "🔴 " : ""}${statusText[state.status]}${state.status === "reconnecting" ? `（第 ${state.retryCount} 次）` : ""}${state.error ? `：${state.error}` : ""}`;
}

export function projectIotRuntimeNode(node: CanvasNode, state: IotRuntimeState, now: number, setupError: string | null = null): IotRuntimeNode {
  const projected = projectIotValueNode(node, state, now, setupError);
  if (!node.stateBinding) return projected;
  const result = evaluateStateBinding(node.stateBinding, state.values[node.stateBinding.pointKey], now, iotConnectionError(state, setupError));
  if (!result.ok || projected.unavailable) return { ...projected, node: { ...projected.node, props: { ...projected.node.props, ...(node.type === "process-pipe" ? { flowing: false, color: "#94a3b8" } : {}) } }, unavailable: result.ok ? projected.unavailable : result.message, visible: true };
  const s = result.value;
  const props = { ...projected.node.props, ...(node.type === "process-pipe" ? { color: s.color, flowing: s.flowing, direction: s.direction, speed: s.speed } : node.type === "rectangle" || node.type === "circle" ? { fillColor: s.color } : node.type === "vector-icon" ? { iconColor: s.color } : {}) };
  return { node: { ...projected.node, props }, unavailable: null, stateColor: s.color, stateLabel: s.label, visible: s.visible };
}

export function projectIotFluid(fluid: FluidDefinition, state: IotRuntimeState, now: number, setupError: string | null = null): { fluid: FluidDefinition; error: string | null } {
  if (!fluid.stateBinding) return { fluid, error: null };
  const result = evaluateStateBinding(fluid.stateBinding, state.values[fluid.stateBinding.pointKey], now, iotConnectionError(state, setupError));
  if (!result.ok) return { fluid: { ...fluid, color: "#94a3b8", playing: false, visible: true }, error: `${fluid.label}：${result.message}` };
  const s = result.value;
  return { fluid: { ...fluid, color: s.color, visible: s.visible, playing: s.flowing, direction: s.direction, speed: Math.max(0.01, s.speed) }, error: null };
}
