/** Saved room data alarms. Observations and their last state are runtime-only. */
export type RoomAlarmRule = {
  id: string;
  label: string;
  enabled: boolean;
  source: { projectId: string; assetId: string; metricKey: string };
  target: { instanceId: string; modelAssetId: string; nodeName: string };
  condition: { operator: "eq" | "gt" | "gte" | "lt" | "lte"; value: number | string | boolean };
  color: string;
};

export const ROOM_ALARM_LIMITS = {
  maximumRules: 64,
  maximumAffectedMeshes: 256,
  maximumLabelLength: 80,
  maximumNodeNameLength: 256,
  maximumStringValueLength: 120,
  maximumNumericValue: 1_000_000_000,
} as const;

const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}(?![\s\S])/;
const printable = (value: unknown, maximum: number): value is string =>
  typeof value === "string" && value.length >= 1 && value.length <= maximum
  && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const keysAre = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= ROOM_ALARM_LIMITS.maximumNumericValue;

export function parseRoomAlarms(input: unknown): { ok: true; value: RoomAlarmRule[] } | { ok: false; message: string } {
  const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });
  if (!Array.isArray(input) || input.length > ROOM_ALARM_LIMITS.maximumRules) return fail(`roomAlarms must be an array of at most ${ROOM_ALARM_LIMITS.maximumRules} rules.`);
  const ids = new Set<string>();
  const targets = new Set<string>();
  const parsed: RoomAlarmRule[] = [];
  for (let index = 0; index < input.length; index++) {
    const item = input[index];
    const at = `roomAlarms[${index}]`;
    if (!record(item) || !keysAre(item, ["id", "label", "enabled", "source", "target", "condition", "color"])) return fail(`${at} has missing or unsupported fields.`);
    if (typeof item.id !== "string" || !identifier.test(item.id)) return fail(`${at}.id must be a stable identifier.`);
    if (ids.has(item.id)) return fail(`${at}.id is duplicated.`);
    ids.add(item.id);
    if (!printable(item.label, ROOM_ALARM_LIMITS.maximumLabelLength)) return fail(`${at}.label must be 1–80 printable characters.`);
    if (typeof item.enabled !== "boolean") return fail(`${at}.enabled must be boolean.`);
    if (!record(item.source) || !keysAre(item.source, ["projectId", "assetId", "metricKey"])) return fail(`${at}.source is invalid.`);
    for (const key of ["projectId", "assetId", "metricKey"] as const) if (typeof item.source[key] !== "string" || !identifier.test(item.source[key])) return fail(`${at}.source.${key} must be an identifier.`);
    if (!record(item.target) || !keysAre(item.target, ["instanceId", "modelAssetId", "nodeName"])) return fail(`${at}.target is invalid.`);
    for (const key of ["instanceId", "modelAssetId"] as const) if (typeof item.target[key] !== "string" || !identifier.test(item.target[key])) return fail(`${at}.target.${key} must be an identifier.`);
    if (!printable(item.target.nodeName, ROOM_ALARM_LIMITS.maximumNodeNameLength)) return fail(`${at}.target.nodeName must be 1–256 printable characters.`);
    const targetKey = JSON.stringify([item.target.instanceId, item.target.modelAssetId, item.target.nodeName]);
    if (targets.has(targetKey)) return fail(`${at}.target duplicates another rule.`);
    targets.add(targetKey);
    if (!record(item.condition) || !keysAre(item.condition, ["operator", "value"])) return fail(`${at}.condition is invalid.`);
    const operator = item.condition.operator;
    if (!["eq", "gt", "gte", "lt", "lte"].includes(operator as string)) return fail(`${at}.condition.operator is invalid.`);
    const value = item.condition.value;
    if (typeof value === "number" ? !finite(value) : typeof value === "string" ? value.length > ROOM_ALARM_LIMITS.maximumStringValueLength : typeof value !== "boolean") return fail(`${at}.condition.value is invalid.`);
    if (operator !== "eq" && typeof value !== "number") return fail(`${at}.condition requires a number.`);
    if (typeof item.color !== "string" || !/^#[0-9a-fA-F]{6}(?![\s\S])/.test(item.color)) return fail(`${at}.color must be six-digit HEX.`);
    parsed.push({
      id: item.id, label: item.label, enabled: item.enabled,
      source: { projectId: item.source.projectId as string, assetId: item.source.assetId as string, metricKey: item.source.metricKey as string },
      target: { instanceId: item.target.instanceId as string, modelAssetId: item.target.modelAssetId as string, nodeName: item.target.nodeName as string },
      condition: { operator: operator as RoomAlarmRule["condition"]["operator"], value: value as number | string | boolean },
      color: item.color,
    });
  }
  return { ok: true, value: parsed };
}
