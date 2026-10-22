import type { IotPointValue, IotValueType } from "./iot-embed";

export type ProcessState = {
  label: string;
  operator: "eq" | "gt" | "gte" | "lt" | "lte";
  value: number | string | boolean;
  color: string;
  visible: boolean;
  flowing: boolean;
  direction: "forward" | "reverse";
  speed: number;
};
export type StateBinding = {
  pointKey: string;
  valueType: IotValueType;
  staleAfterSeconds: number;
  states: ProcessState[];
};
export type PipePoint = { x: number; y: number };
export type PipeEndpoint = PipePoint & { nodeId: string | null; port: "left" | "right" | "top" | "bottom" };
export type PipeProps = {
  label: string;
  source: PipeEndpoint;
  target: PipeEndpoint;
  waypoints: PipePoint[];
  routing: "horizontal" | "vertical";
  color: string;
  width: number;
  flowing: boolean;
  direction: "forward" | "reverse";
  speed: number;
};
type Result<T> = { ok: true; value: T } | { ok: false; message: string };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, fields: string[]) => Object.keys(v).length === fields.length && fields.every(k => Object.hasOwn(v, k));
const number = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const label = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 80 && !/[\u0000-\u001f\u007f]/u.test(v);
const color = (v: unknown): v is string => typeof v === "string" && /^#[\da-f]{6}$/i.test(v);
const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });

export function parseStateBinding(input: unknown): Result<StateBinding> {
  if (!object(input) || !exact(input, ["pointKey", "valueType", "staleAfterSeconds", "states"])) return fail("状态联动配置字段不完整或含未知字段。");
  if (typeof input.pointKey !== "string" || input.pointKey.length > 200 || !/^[A-Za-z0-9_.:-]+\/[A-Za-z_][A-Za-z0-9_]*$/.test(input.pointKey)) return fail("点位格式应为设备ID/属性ID。");
  if (!["number", "boolean", "string"].includes(String(input.valueType))) return fail("点位类型无效。");
  if (!number(input.staleAfterSeconds, 1, 86400) || !Number.isInteger(input.staleAfterSeconds)) return fail("过期时间须为 1–86400 秒的整数。");
  if (!Array.isArray(input.states) || input.states.length < 1 || input.states.length > 8) return fail("请配置 1–8 条状态规则，按顺序匹配。");
  for (const [i, state] of input.states.entries()) {
    if (!object(state) || !exact(state, ["label", "operator", "value", "color", "visible", "flowing", "direction", "speed"])) return fail(`状态 ${i + 1} 字段不完整或含未知字段。`);
    if (!label(state.label)) return fail(`状态 ${i + 1} 名称须为 1–80 个可读字符。`);
    if (!["eq", "gt", "gte", "lt", "lte"].includes(String(state.operator)) || input.valueType !== "number" && state.operator !== "eq") return fail(`状态 ${i + 1} 只能对数字使用大小比较。`);
    if (typeof state.value !== input.valueType || typeof state.value === "number" && !Number.isFinite(state.value) || typeof state.value === "string" && (state.value.length > 1000 || !state.value.length)) return fail(`状态 ${i + 1} 比较值与点位类型不一致。`);
    if (!color(state.color) || typeof state.visible !== "boolean" || typeof state.flowing !== "boolean" || !["forward", "reverse"].includes(String(state.direction)) || !number(state.speed, 0, 30)) return fail(`状态 ${i + 1} 显示参数无效（速度为 0–30）。`);
  }
  return { ok: true, value: input as StateBinding };
}

export function evaluateStateBinding(binding: StateBinding, point: IotPointValue | undefined, now: number, connectionError: string | null): Result<ProcessState> {
  const parsed = parseStateBinding(binding);
  if (!parsed.ok) return parsed;
  if (connectionError) return fail(connectionError);
  if (!point || point.quality === "unknown") return fail("点位数据未知");
  if (point.quality !== "good") return fail("点位质量异常");
  if (!Number.isFinite(point.timestamp) || point.timestamp <= 0 || point.timestamp > now + 300000) return fail("点位源时间异常");
  if (now - point.timestamp > binding.staleAfterSeconds * 1000) return fail("数据已过期");
  const value = point.value;
  if (typeof value !== binding.valueType || typeof value === "number" && !Number.isFinite(value)) return fail("点位值类型不匹配");
  const state = binding.states.find(s => s.operator === "eq" ? value === s.value : typeof value === "number" && typeof s.value === "number" && (
    s.operator === "gt" ? value > s.value : s.operator === "gte" ? value >= s.value : s.operator === "lt" ? value < s.value : value <= s.value));
  return state ? { ok: true, value: { ...state, flowing: state.flowing && state.speed > 0 } } : fail(`点位值 ${String(value)} 未匹配状态规则`);
}

const pointValid = (p: unknown): boolean => object(p) && number(p.x, 0, 16384) && number(p.y, 0, 16384);
export function parsePipeProps(input: unknown): Result<PipeProps> {
  if (!object(input) || !exact(input, ["label", "source", "target", "waypoints", "routing", "color", "width", "flowing", "direction", "speed"])) return fail("管路配置字段不完整或含未知字段。");
  if (!label(input.label) || !color(input.color) || !number(input.width, 2, 40) || !number(input.speed, 0, 30) || typeof input.flowing !== "boolean" || !["forward", "reverse"].includes(String(input.direction)) || !["horizontal", "vertical"].includes(String(input.routing))) return fail("管路外观或速度参数无效。");
  for (const key of ["source", "target"]) {
    const end = input[key];
    if (!object(end) || !exact(end, ["x", "y", "nodeId", "port"]) || !pointValid(end) || !(end.nodeId === null || typeof end.nodeId === "string" && end.nodeId.length > 0 && end.nodeId.length <= 120) || !["left", "right", "top", "bottom"].includes(String(end.port))) return fail("管路端点无效。");
  }
  if (!Array.isArray(input.waypoints) || input.waypoints.length > 32 || input.waypoints.some(p => !object(p) || !pointValid(p) || !exact(p, ["x", "y"]))) return fail("管路最多支持 32 个途经点，坐标范围 0–16384。");
  return { ok: true, value: input as PipeProps };
}

export type PipeAnchorNode = { id: string; type: string; x: number; y: number; width: number; height: number; props: Record<string, unknown> };
export function pipeEndpoint(end: PipeEndpoint, nodes: readonly PipeAnchorNode[]): PipePoint {
  if (!end.nodeId) return { x: end.x, y: end.y };
  const node = nodes.find(n => n.id === end.nodeId && n.type !== "process-pipe");
  if (!node) throw new Error(`管路连接的组件 ${end.nodeId} 不存在，请重新连接。`);
  return { x: node.x + (end.port === "left" ? 0 : end.port === "right" ? node.width : node.width / 2), y: node.y + (end.port === "top" ? 0 : end.port === "bottom" ? node.height : node.height / 2) };
}
export function pipeRoute(props: PipeProps, nodes: readonly PipeAnchorNode[]): PipePoint[] {
  const source = pipeEndpoint(props.source, nodes), target = pipeEndpoint(props.target, nodes);
  const stub = (p: PipePoint, end: PipeEndpoint) => ({ x: p.x + (end.port === "left" ? -24 : end.port === "right" ? 24 : 0), y: p.y + (end.port === "top" ? -24 : end.port === "bottom" ? 24 : 0) });
  const controls = [source, ...(props.source.nodeId ? [stub(source, props.source)] : []), ...props.waypoints, ...(props.target.nodeId ? [stub(target, props.target)] : []), target];
  const route: PipePoint[] = [];
  for (const p of controls) {
    const prev = route.at(-1);
    if (prev && prev.x !== p.x && prev.y !== p.y) route.push(props.routing === "horizontal" ? { x: p.x, y: prev.y } : { x: prev.x, y: p.y });
    if (!prev || prev.x !== p.x || prev.y !== p.y) route.push(p);
  }
  return route;
}
export function validatePipeReferences(nodes: readonly PipeAnchorNode[]): Result<true> {
  for (const node of nodes) if (node.type === "process-pipe") {
    const parsed = parsePipeProps(node.props);
    if (!parsed.ok) return fail(`${node.id}：${parsed.message}`);
    for (const end of [parsed.value.source, parsed.value.target]) if (end.nodeId && !nodes.some(n => n.id === end.nodeId && n.type !== "process-pipe")) return fail(`管路「${parsed.value.label}」连接的组件不存在，请先重新连接或删除管路。`);
  }
  return { ok: true, value: true };
}
export const createPipeProps = (x: number, y: number): PipeProps => ({ label: "工艺管路", source: { nodeId: null, port: "right", x, y: y + 40 }, target: { nodeId: null, port: "left", x: x + 280, y: y + 120 }, waypoints: [], routing: "horizontal", color: "#38bdf8", width: 10, flowing: false, direction: "forward", speed: 1 });
