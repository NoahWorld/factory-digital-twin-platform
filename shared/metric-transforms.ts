import { AppError } from "./errors";
export type TransformScalar = number|string|boolean|null;
export type TimestampFormat = "iso"|"unix_seconds"|"unix_ms";
export type MetricTransformStep = { type:"number";coerceString:boolean;scale:number;offset:number }
  | { type:"enum";entries:Array<{ from:Exclude<TransformScalar,null>;to:TransformScalar }>;unmapped:"error"|"null" }
  | { type:"timestamp";format:TimestampFormat };
export type MetricTransform = { version:1;steps:MetricTransformStep[] };
const bad = (message:string):never => { throw new AppError(400,"invalid_metric_transform",message); };
const object = (value:unknown,fields:string[]):Record<string,unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !fields.includes(key))) return bad("转换配置包含未知字段或不是对象。");return value as Record<string,unknown>;
};
const scalar = (value:unknown):value is TransformScalar => value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) || typeof value === "string" && value.length<=2000;
export function validateTimestampFormat(value:unknown):TimestampFormat {
  if (value !== "iso" && value !== "unix_seconds" && value !== "unix_ms") return bad("时间格式必须是ISO、Unix秒或Unix毫秒。");return value;
}
export function validateMetricTransform(input:unknown):MetricTransform {
  const value = object(input,["version","steps"]);if (value.version !== 1 || !Array.isArray(value.steps) || value.steps.length<1 || value.steps.length>4) return bad("转换v1必须包含1–4个步骤。");
  const steps = value.steps.map((input):MetricTransformStep => {
    const step = object(input,["type","coerceString","scale","offset","entries","unmapped","format"]);
    if (step.type === "number") {
      object(step,["type","coerceString","scale","offset"]);
      if (typeof step.coerceString !== "boolean" || typeof step.scale !== "number" || !Number.isFinite(step.scale) || typeof step.offset !== "number" || !Number.isFinite(step.offset)) return bad("数值转换需要明确字符串转换开关、有限倍率和偏移量。");
      return { type:step.type,coerceString:step.coerceString,scale:step.scale,offset:step.offset };
    }
    if (step.type === "enum") {
      object(step,["type","entries","unmapped"]);if (!Array.isArray(step.entries) || step.entries.length<1 || step.entries.length>64 || step.unmapped !== "error" && step.unmapped !== "null") return bad("枚举转换需要1–64个条目和明确的未匹配策略。");
      const entries = step.entries.map((input) => { const entry = object(input,["from","to"]);if (!scalar(entry.from) || entry.from === null || !scalar(entry.to)) return bad("映射输入是非空标量，输出是标量或NULL。");return { from:entry.from,to:entry.to }; });
      if (new Set(entries.map((entry) => `${typeof entry.from}:${JSON.stringify(entry.from)}`)).size !== entries.length) return bad("同类型枚举输入不能重复。");
      return { type:step.type,entries,unmapped:step.unmapped };
    }
    if (step.type === "timestamp") { object(step,["type","format"]);return { type:step.type,format:validateTimestampFormat(step.format) }; }
    return bad("不支持此转换步骤；不执行脚本。");
  });return { version:1,steps };
}
export function timestampToIso(value:unknown,format:TimestampFormat):string {
  let milliseconds:number;
  if (format === "iso") { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error("时间字段必须是有效日期文本。");milliseconds = Date.parse(value); }
  else { if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Unix时间字段必须是有限数值。");milliseconds = value*(format === "unix_seconds" ? 1000:1); }
  if (!Number.isFinite(milliseconds) || Math.abs(milliseconds)>8640000000000000) throw new Error("时间值超出支持范围。");
  return new Date(Math.trunc(milliseconds)).toISOString();
}
export function applyMetricTransform(value:unknown,transform:MetricTransform|undefined,bindingId:string):unknown {
  if (!transform || value === null) return value;
  let result:unknown = value;
  for (const [index,step] of transform.steps.entries()) {
    if (result === null) return null;
    const fail = (code:string,message:string):never => { throw new AppError(422,code,`Binding ${bindingId}, transform step ${index+1}: ${message}`); };
    if (step.type === "number") {
      if (typeof result === "string" && step.coerceString) {
        const trimmed = result.trim();if (!trimmed || trimmed.length>128 || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) fail("metric_transform_number_invalid","Numeric text has an unsupported format.");
        const parsed = Number(trimmed);if (!Number.isFinite(parsed) || Number.isInteger(parsed) && !Number.isSafeInteger(parsed)) fail("metric_transform_number_invalid","Numeric text exceeds finite or safe integer precision.");result = parsed;
      }
      if (typeof result !== "number" || !Number.isFinite(result)) fail("metric_transform_type_error","A finite number is required.");
      result = (result as number)*step.scale;if (!Number.isFinite(result)) fail("metric_transform_overflow","Scale overflowed.");result = (result as number)+step.offset;if (!Number.isFinite(result)) fail("metric_transform_overflow","Offset overflowed.");
    } else if (step.type === "enum") {
      const match = step.entries.find((entry) => entry.from === result);
      if (!match && step.unmapped === "error") fail("metric_transform_unmapped","No mapping matches this input type and value.");result = match ? match.to:null;
    } else {
      try { result = timestampToIso(result,step.format); } catch { fail("metric_transform_timestamp_invalid","Timestamp input or range is invalid."); }
    }
  }
  return result;
}
