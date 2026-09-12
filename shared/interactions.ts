import { AppError } from "./errors";
import { requireIdentifier } from "./canvas-schema";
import type { SceneDefinition } from "./scene-definition";

export type Scalar = string | number | boolean | null;
export type InteractionValue = { kind: "literal"; value: Scalar } | { kind: "state"; stateId: string }
  | { kind: "event"; field: "value" | "previous" | "sourceId" | "assetId" | "metricKey" | "status" }
  | { kind: "metric"; assetId: string; metricKey: string };
export type InteractionCondition = { op: "all" | "any"; conditions: InteractionCondition[] }
  | { op: "not"; condition: InteractionCondition }
  | { op: "exists"; value: InteractionValue }
  | { op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte"; left: InteractionValue; right: InteractionValue };
export const INTERACTION_EVENTS = ["page.enter", "node.click", "node.change", "asset.select", "data.change", "connection.change", "state.change", "custom"] as const;
export type InteractionEventType = typeof INTERACTION_EVENTS[number];
export type InteractionEvent = { type: InteractionEventType; sourceId?: string; value?: Scalar; previous?: Scalar; assetId?: string; metricKey?: string; status?: string };
export type InteractionTrigger = { type: InteractionEventType; sourceId?: string; metricKey?: string };
export type InteractionState = { id: string; name: string; pageId: string | null; valueType: "string" | "number" | "boolean"; initial: Scalar };
export type InteractionAction = { type: "state.set"; stateId: string; value: InteractionValue }
  | { type: "asset.select"; value: InteractionValue; details: boolean }
  | { type: "page.navigate"; pageId: string }
  | { type: "node.visible"; nodeId: string; visible: boolean }
  | { type: "motion.play" | "motion.stop"; nodeId: string; motionId: string }
  | { type: "delay"; milliseconds: number }
  | { type: "event.emit"; name: string; value: InteractionValue };
export type InteractionRule = { id: string; name: string; pageId: string | null; enabled: boolean; reentry: "restart" | "ignore";
  trigger: InteractionTrigger; condition: InteractionCondition | null; actions: InteractionAction[] };
export type InteractionDefinition = { states: InteractionState[]; rules: InteractionRule[] };
export const emptyInteractions = (): InteractionDefinition => ({ states: [], rules: [] });

const invalid = (message: string): never => { throw new AppError(400, "invalid_interactions", message); };
function record(value: unknown, fields: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid(`${label} 必须是对象。`);
  if (Object.keys(value).some((key) => !fields.includes(key))) invalid(`${label} 包含不支持的字段。`);
  return value as Record<string, unknown>;
}
function list(value: unknown, max: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > max) return invalid(`${label} 必须是最多 ${max} 项的数组。`);
  return value;
}
function text(value: unknown, label: string, max = 100): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) return invalid(`${label} 必须是 1–${max} 个字符。`);
  return value.trim();
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") return invalid(`${label} 必须是布尔值。`);
  return value;
}
export function interactionScalar(value: unknown): Scalar {
  if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && value.length <= 2000)) return value;
  return invalid("交互值只能是有限数字、布尔值、空值或最多 2000 字符的文本。");
}
export function validateInteractionValue(value: unknown): InteractionValue {
  const input = record(value, ["kind", "value", "stateId", "field", "assetId", "metricKey"], "取值表达式");
  const fields: Record<string, string[]> = { literal: ["kind", "value"], state: ["kind", "stateId"], event: ["kind", "field"], metric: ["kind", "assetId", "metricKey"] };
  if (typeof input.kind !== "string" || !Object.hasOwn(fields, input.kind)) return invalid("取值来源不支持。");
  record(input, fields[input.kind], "取值表达式");
  switch (input.kind) {
    case "literal": return { kind: input.kind, value: interactionScalar(input.value) };
    case "state": return { kind: input.kind, stateId: requireIdentifier(input.stateId, "stateId") };
    case "event": if (!["value", "previous", "sourceId", "assetId", "metricKey", "status"].includes(String(input.field))) return invalid("事件字段不支持。");
      return { kind: input.kind, field: input.field as Extract<InteractionValue, { kind: "event" }>["field"] };
    default: return { kind: "metric", assetId: requireIdentifier(input.assetId, "assetId"), metricKey: requireIdentifier(input.metricKey, "metricKey") };
  }
}
export function validateInteractionCondition(value: unknown, depth = 0, budget = { remaining: 64 }): InteractionCondition {
  if (depth > 8 || --budget.remaining < 0) return invalid("条件最多 8 层、64 个表达式。");
  const input = record(value, ["op", "conditions", "condition", "value", "left", "right"], "条件");
  const fields: Record<string, string[]> = { all: ["op", "conditions"], any: ["op", "conditions"], not: ["op", "condition"], exists: ["op", "value"] };
  if (input.op === "all" || input.op === "any") {
    record(input, fields[input.op], "组合条件");
    return { op: input.op, conditions: list(input.conditions, 16, "组合条件").map((item) => validateInteractionCondition(item, depth + 1, budget)) };
  }
  if (input.op === "not") { record(input, fields.not, "否定条件"); return { op: "not", condition: validateInteractionCondition(input.condition, depth + 1, budget) }; }
  if (input.op === "exists") { record(input, fields.exists, "存在条件"); return { op: "exists", value: validateInteractionValue(input.value) }; }
  if (!["eq", "ne", "gt", "gte", "lt", "lte"].includes(String(input.op))) return invalid("比较操作不支持。");
  record(input, ["op", "left", "right"], "比较条件");
  return { op: input.op as "eq", left: validateInteractionValue(input.left), right: validateInteractionValue(input.right) };
}
export function validateInteractionAction(value: unknown): InteractionAction {
  const input = record(value, ["type", "stateId", "value", "details", "pageId", "nodeId", "visible", "milliseconds", "name", "motionId"], "动作");
  const fields: Record<string, string[]> = {
    "state.set": ["type", "stateId", "value"], "asset.select": ["type", "value", "details"], "page.navigate": ["type", "pageId"],
    "node.visible": ["type", "nodeId", "visible"], delay: ["type", "milliseconds"], "event.emit": ["type", "name", "value"],
    "motion.play": ["type", "nodeId", "motionId"], "motion.stop": ["type", "nodeId", "motionId"],
  };
  if (typeof input.type !== "string" || !Object.hasOwn(fields, input.type)) return invalid("不支持的交互动作。");
  record(input, fields[input.type], "动作");
  switch (input.type) {
    case "state.set": return { type: input.type, stateId: requireIdentifier(input.stateId, "stateId"), value: validateInteractionValue(input.value) };
    case "asset.select": {
      const value = validateInteractionValue(input.value);
      if (value.kind === "literal" && value.value !== null && typeof value.value !== "string") invalid("设备选择值必须为资产 ID 文本或空值。");
      return { type: input.type, value, details: boolean(input.details, "详情开关") };
    }
    case "page.navigate": return { type: input.type, pageId: requireIdentifier(input.pageId, "pageId") };
    case "node.visible": return { type: input.type, nodeId: requireIdentifier(input.nodeId, "nodeId"), visible: boolean(input.visible, "显隐") };
    case "motion.play": case "motion.stop": return { type: input.type, nodeId: requireIdentifier(input.nodeId,"nodeId"), motionId: requireIdentifier(input.motionId,"motionId") };
    case "event.emit": return { type: input.type, name: requireIdentifier(input.name, "event.name"), value: validateInteractionValue(input.value) };
    default:
      if (typeof input.milliseconds !== "number" || !Number.isInteger(input.milliseconds) || input.milliseconds < 0 || input.milliseconds > 60000) return invalid("等待时间必须是 0–60000 毫秒的整数。");
      return { type: "delay", milliseconds: input.milliseconds };
  }
}
export function validateInteractions(value: unknown): InteractionDefinition {
  const input = record(value, ["states", "rules"], "交互配置");
  const states = list(input.states, 100, "状态定义").map((value): InteractionState => {
    const state = record(value, ["id", "name", "pageId", "valueType", "initial"], "状态");
    const initial = interactionScalar(state.initial);
    if (!["string", "number", "boolean"].includes(String(state.valueType)) || (initial !== null && typeof initial !== state.valueType)) invalid("状态初始值与类型不匹配。");
    return { id: requireIdentifier(state.id, "state.id"), name: text(state.name, "状态名"), pageId: state.pageId === null ? null : requireIdentifier(state.pageId, "state.pageId"), valueType: state.valueType as InteractionState["valueType"], initial };
  });
  const rules = list(input.rules, 200, "交互规则").map((value): InteractionRule => {
    const rule = record(value, ["id", "name", "pageId", "enabled", "reentry", "trigger", "condition", "actions"], "规则");
    const trigger = record(rule.trigger, ["type", "sourceId", "metricKey"], "触发器");
    if (!INTERACTION_EVENTS.includes(trigger.type as InteractionEventType)) invalid("触发事件不支持。");
    if (rule.reentry !== "restart" && rule.reentry !== "ignore") invalid("重复触发策略必须为 restart 或 ignore。");
    if (trigger.metricKey !== undefined && trigger.type !== "data.change") invalid("只有指标变化事件支持 metricKey。");
    return { id: requireIdentifier(rule.id, "rule.id"), name: text(rule.name, "规则名"), pageId: rule.pageId === null ? null : requireIdentifier(rule.pageId, "rule.pageId"), enabled: boolean(rule.enabled, "规则启用"),
      reentry: rule.reentry as InteractionRule["reentry"], trigger: { type: trigger.type as InteractionEventType,
        ...(trigger.sourceId === undefined ? {} : { sourceId: requireIdentifier(trigger.sourceId, "trigger.sourceId") }),
        ...(trigger.metricKey === undefined ? {} : { metricKey: requireIdentifier(trigger.metricKey, "trigger.metricKey") }) },
      condition: rule.condition === null ? null : validateInteractionCondition(rule.condition), actions: list(rule.actions, 32, "顺序动作").map(validateInteractionAction) };
  });
  for (const values of [states, rules]) if (new Set(values.map((item) => item.id)).size !== values.length) invalid("状态或规则 ID 重复。");
  return { states, rules };
}

export function conditionValues(condition: InteractionCondition | null): InteractionValue[] {
  if (!condition) return [];
  if ("conditions" in condition) return condition.conditions.flatMap(conditionValues);
  if ("condition" in condition) return conditionValues(condition.condition);
  return "value" in condition ? [condition.value] : [condition.left, condition.right];
}
export function ruleValues(rule: InteractionRule): InteractionValue[] {
  return [...conditionValues(rule.condition), ...rule.actions.flatMap((action) => "value" in action ? [action.value] : [])];
}
export function interactionAssetIds(config: InteractionDefinition): string[] {
  return [...new Set(config.rules.flatMap((rule) => [
    ...(["data.change", "connection.change", "asset.select"].includes(rule.trigger.type) && rule.trigger.sourceId ? [rule.trigger.sourceId] : []),
    ...ruleValues(rule).flatMap((value) => value.kind === "metric" ? [value.assetId] : []),
    ...rule.actions.flatMap((action) => action.type === "asset.select" && action.value.kind === "literal" && typeof action.value.value === "string" ? [action.value.value] : []),
  ]))];
}
export function validateInteractionReferences(config: InteractionDefinition, pages: Array<{ id: string; nodes: Array<{ id: string; sceneId?: string }> }>, scenes: SceneDefinition[] = []) {
  const pageIds = new Set(pages.map((page) => page.id));
  const nodes = new Map(pages.flatMap((page) => page.nodes.map((node) => [node.id, page.id] as const)));
  for (const item of [...config.states, ...config.rules]) if (item.pageId !== null && !pageIds.has(item.pageId)) invalid(`交互「${item.name}」所属页面不存在，请先修复引用。`);
  for (const rule of config.rules) {
    const stateRef = (id: string) => {
      const state = config.states.find((state) => state.id === id);
      if (!state || (state.pageId !== null && state.pageId !== rule.pageId)) invalid(`规则「${rule.name}」引用不存在或其他页面的状态。`);
    };
    const nodeRef = (id: string) => {
      if (!nodes.has(id) || (rule.pageId !== null && nodes.get(id) !== rule.pageId)) invalid(`规则「${rule.name}」引用不存在或其他页面的组件，请先修复引用。`);
    };
    const { type, sourceId } = rule.trigger;
    if (sourceId) {
      if (type === "node.click" || type === "node.change") nodeRef(sourceId);
      if (type === "state.change") stateRef(sourceId);
      if (type === "page.enter" && (!pageIds.has(sourceId) || (rule.pageId !== null && rule.pageId !== sourceId))) invalid("页面进入事件引用不匹配。");
    }
    for (const value of ruleValues(rule)) if (value.kind === "state") stateRef(value.stateId);
    for (const action of rule.actions) {
      if (action.type === "state.set") {
        stateRef(action.stateId);
        const state = config.states.find((state) => state.id === action.stateId)!;
        if (action.value.kind === "literal" && action.value.value !== null && typeof action.value.value !== state.valueType) invalid("设置状态的常量类型不匹配。");
      }
      if (action.type === "node.visible") nodeRef(action.nodeId);
      if (action.type === "motion.play" || action.type === "motion.stop") {
        nodeRef(action.nodeId);
        const node = pages.flatMap((page) => page.nodes).find((node) => node.id === action.nodeId);
        if (!node?.sceneId || !scenes.find((scene) => scene.id === node.sceneId)?.motions?.some((motion) => motion.id === action.motionId)) invalid(`规则「${rule.name}」引用的场景动画不存在，请先修复或移除关联动作。`);
      }
      if (action.type === "page.navigate" && !pageIds.has(action.pageId)) invalid("跳转页面不存在。");
    }
  }
}
