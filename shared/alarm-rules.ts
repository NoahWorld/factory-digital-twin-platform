import { AppError } from "./errors";
import { requireIdentifier } from "./canvas-schema";
import { validateInteractionCondition,conditionValues,type InteractionCondition } from "./interactions";
import type { MetricCatalogEntry } from "./component-bindings";

export type AlarmRule = { id:string;name:string;assetId:string;enabled:boolean;severity:"info"|"warning"|"critical";message:string;condition:InteractionCondition;recoveryCondition:InteractionCondition|null };
const bad = (message:string):never => { throw new AppError(400,"invalid_alarm_rule",message); };
const text = (value:unknown,max:number,label:string) => typeof value === "string" && value.trim() && value.length <= max ? value.trim():bad(`${label}必须是1–${max}个字符。`);
export function validateAlarmRules(input:unknown):AlarmRule[] {
  if (!Array.isArray(input) || input.length > 200) return bad("每个项目最多配置200条告警规则。");
  const rules = input.map((value):AlarmRule => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return bad("告警规则必须是对象。");
    const row = value as Record<string,unknown>;
    if (Object.keys(row).some((key) => !["id","name","assetId","enabled","severity","message","condition","recoveryCondition"].includes(key))) return bad("告警规则包含未知字段。");
    if (typeof row.enabled !== "boolean" || !["info","warning","critical"].includes(String(row.severity))) return bad("告警启用状态或级别无效。");
    const condition = validateInteractionCondition(row.condition),recoveryCondition = row.recoveryCondition === null ? null:validateInteractionCondition(row.recoveryCondition),assetId = requireIdentifier(row.assetId,"alarm.assetId");
    for (const expression of [condition,recoveryCondition]) if (expression) {
      const values = conditionValues(expression);
      if (!values.some((value) => value.kind === "metric")) bad("告警条件必须引用设备指标。");
      if (values.some((value) => value.kind !== "literal" && (value.kind !== "metric" || value.assetId !== assetId))) bad("告警仅引用所属设备的指标及常量，不读取页面状态或浏览器事件。");
    }
    return { id:requireIdentifier(row.id,"alarm.id"),name:text(row.name,100,"规则名称"),assetId,enabled:row.enabled,severity:row.severity as AlarmRule["severity"],message:text(row.message,500,"告警消息"),condition,recoveryCondition };
  });
  if (new Set(rules.map((rule) => rule.id)).size !== rules.length) bad("告警规则ID重复。");
  return rules;
}
export function alarmMetricKeys(rule:AlarmRule):string[] {
  return [...new Set([...conditionValues(rule.condition),...conditionValues(rule.recoveryCondition)].flatMap((value) => value.kind === "metric" ? [value.metricKey]:[]))];
}
export function validateAlarmCatalog(rules:AlarmRule[],catalog:MetricCatalogEntry[],assetIds:Set<string>) {
  for (const rule of rules) {
    if (!assetIds.has(rule.assetId)) bad(`告警「${rule.name}」引用的设备不存在。`);
    for (const key of alarmMetricKeys(rule)) if (!catalog.some((metric) => metric.assetId === rule.assetId && metric.metricKey === key)) bad(`告警「${rule.name}」引用的指标${key}不存在。`);
    const check = (condition:InteractionCondition) => {
      if ("conditions" in condition) { condition.conditions.forEach(check);return; }
      if ("condition" in condition) { check(condition.condition);return; }
      if ("value" in condition || condition.op === "eq" || condition.op === "ne") return;
      for (const value of [condition.left,condition.right]) {
        if (value.kind === "literal" && typeof value.value !== "number") bad("大小比较只能使用数值指标和有限数字。");
        if (value.kind === "metric" && catalog.find((metric) => metric.assetId === value.assetId && metric.metricKey === value.metricKey)?.valueType !== "number") bad("大小比较只能使用数值指标。");
      }
    };
    check(rule.condition);if (rule.recoveryCondition) check(rule.recoveryCondition);
  }
}
