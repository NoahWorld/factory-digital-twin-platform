import { TWIN_DRIVE_LIMITS, twinDriveErrors, type TwinDriveConfig } from "../../../../shared/twin-drive";

type Check = (value: unknown, path: string) => void;
const fail = (path: string, expected: string): never => { throw new Error(`${path}：${expected}`); };
const text: Check = (value, path) => { if (typeof value !== "string") fail(path, "必须是字符串"); };
const number: Check = (value, path) => { if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "必须是有限数值"); };
const boolean: Check = (value, path) => { if (typeof value !== "boolean") fail(path, "必须是布尔值"); };
const oneOf = (...choices: unknown[]): Check => (value, path) => { if (!choices.includes(value)) fail(path, `必须为 ${choices.join(" / ")}`); };
const list = (item: Check, limit: number): Check => (value, path) => {
  if (!Array.isArray(value)) fail(path, "必须是数组");
  const values = value as unknown[];
  if (values.length > limit) fail(path, `最多允许 ${limit} 项`);
  values.forEach((value, index) => item(value, `${path}[${index}]`));
};
const object = (required: Record<string, Check>, optional: Record<string, Check> = {}): Check => (value, path) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "必须是对象");
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!Object.hasOwn(required, key) && !Object.hasOwn(optional, key)) fail(`${path}.${key}`, "未知字段，不会被静默忽略");
  for (const [key, check] of Object.entries(required)) {
    if (!Object.hasOwn(record, key)) fail(`${path}.${key}`, "缺少必需字段");
    check(record[key], `${path}.${key}`);
  }
  for (const [key, check] of Object.entries(optional)) if (Object.hasOwn(record, key)) check(record[key], `${path}.${key}`);
};
const vector: Check = (value, path) => {
  if (!Array.isArray(value) || value.length !== 3) fail(path, "必须包含 X / Y / Z 三个数值");
  list(number, 3)(value, path);
};
const identity = { id: text, label: text };
const target = object({ instanceId: text, modelAssetId: text, nodeName: text });
const point = object({ ...identity, assetId: text, metricKey: text, unit: text, min: number, max: number, initialValue: number, maxSpeed: number, staleAfterMs: number }, { topic: text });
const pose = object({ value: number, position: vector, rotation: vector, scale: vector });
const binding = object({ ...identity, pointId: text, target, parentBindingId: (value, path) => { if (value !== null) text(value, path); }, useNodeRestPose: boolean, kind: oneOf("translation", "rotation", "pose", "visibility"), axis: vector, pivot: vector, valueScale: number, valueOffset: number, poses: list(pose, TWIN_DRIVE_LIMITS.poses) });
const collider = object({ ...identity, target, center: vector, size: vector });
const rule = object({ ...identity, first: text, second: text, severity: oneOf("warning", "error"), enabled: boolean });
const step = object({ ...identity, targets: list(object({ pointId: text, value: number }), TWIN_DRIVE_LIMITS.points), tolerance: number, timeoutMs: number });
const procedure = object({ ...identity, steps: list(step, TWIN_DRIVE_LIMITS.steps) });
const configuration = object({ version: oneOf(1), enabled: boolean, source: oneOf("simulator"), points: list(point, TWIN_DRIVE_LIMITS.points), bindings: list(binding, TWIN_DRIVE_LIMITS.bindings), colliders: list(collider, TWIN_DRIVE_LIMITS.colliders), collisionRules: list(rule, TWIN_DRIVE_LIMITS.collisionRules), procedures: list(procedure, TWIN_DRIVE_LIMITS.procedures) }, {
  description: (value, path) => { text(value, path); if ((value as string).length > 4000) fail(path, "最多 4000 字符"); },
  simulation: object({ enabled: boolean, procedureId: text, repeat: boolean }),
});

/** Advanced JSON is untrusted input: reject unknown fields and malformed structures before rendering. */
export function parseTwinDriveConfig(value: unknown): TwinDriveConfig {
  configuration(value, "配置");
  const config = value as TwinDriveConfig;
  const errors = twinDriveErrors(config);
  if (errors.length) throw new Error(errors.join("\n"));
  return config;
}
