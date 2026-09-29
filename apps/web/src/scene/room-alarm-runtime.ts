import { errorMessage, reportError } from "../errors";
import type { Material, Object3D } from "three";
import type { RoomAlarmRule } from "../../../../shared/room-alarms";
import { ROOM_ALARM_LIMITS, parseRoomAlarms } from "../../../../shared/room-alarms";
import type { InstanceRecord, MaterialObject } from "./instance-manager";

export type RoomAlarmObservation = {
  status: "live" | "loading" | "offline";
  timestamp: string | null;
  collectedAt?: string;
  staleAfterMs: number;
  value: number | string | boolean | null;
  message?: string;
};
export type RoomAlarmStatus = {
  id: string;
  state: "normal" | "alarm" | "waiting" | "stale" | "offline" | "error";
  active: boolean;
  message: string;
};

type Target = { record: InstanceRecord; meshes: MaterialObject[] };
type Overlay = { material: Material | Material[]; clones: Material[] };
type Entry = {
  rule: RoomAlarmRule;
  record: InstanceRecord | undefined;
  target: Target | undefined;
  error: string | undefined;
  active: boolean;
  latestTimestamp: number | undefined;
  latestValue: number | string | boolean | undefined;
  overlays: Map<MaterialObject, Overlay>;
};
const sameRule = (left: RoomAlarmRule, right: RoomAlarmRule) => JSON.stringify(left) === JSON.stringify(right);
const isMesh = (object: Object3D): object is MaterialObject => {
  if ((object as Object3D & { isMesh?: boolean }).isMesh !== true) return false;
  const material = (object as MaterialObject).material;
  return Boolean(material && (Array.isArray(material) ? material : [material]).some((slot) => "color" in slot));
};
const conditionMet = (rule: RoomAlarmRule, value: number | string | boolean): boolean => {
  const expected = rule.condition.value;
  switch (rule.condition.operator) {
    case "eq": return value === expected;
    case "gt": return typeof value === "number" && value > (expected as number);
    case "gte": return typeof value === "number" && value >= (expected as number);
    case "lt": return typeof value === "number" && value < (expected as number);
    case "lte": return typeof value === "number" && value <= (expected as number);
  }
};

/** A read-only presentation layer; static instance materials retain their own ownership. */
export class RoomAlarmRuntime {
  private entries = new Map<string, Entry>();

  private restore(entry: Entry) {
    entry.overlays.forEach(({ material, clones }, mesh) => {
      mesh.material = material;
      clones.forEach((clone) => clone.dispose());
    });
    entry.overlays.clear();
  }

  private paint(entry: Entry) {
    if (!entry.active || !entry.target || entry.overlays.size) return;
    const prepared = new Map<MaterialObject, Overlay>();
    try {
      for (const mesh of entry.target.meshes) {
        const material = mesh.material;
        if (!material) continue;
        const clones: Material[] = [];
        prepared.set(mesh, { material, clones });
        for (const source of Array.isArray(material) ? material : [material]) {
          const clone = source.clone();
          clones.push(clone);
          const colored = clone as Material & { color?: { set: (color: string) => void } };
          colored.color?.set(entry.rule.color);
          clone.needsUpdate = true;
        }
      }
      prepared.forEach((overlay, mesh) => {
        mesh.material = Array.isArray(overlay.material) ? overlay.clones : overlay.clones[0];
        entry.overlays.set(mesh, overlay);
      });
    } catch (error) {
      prepared.forEach(({ material, clones }, mesh) => {
        mesh.material = material;
        clones.forEach((clone) => clone.dispose());
      });
      entry.overlays.clear();
      reportError(error, { operation: "room-alarm.paint", instanceId: entry.record?.id, ruleId: entry.rule.id });
      entry.error = `报警材质创建失败：${errorMessage(error)}`;
    }
  }

  beforeModelStateChange(): void {
    this.entries.forEach((entry) => this.restore(entry));
  }

  reconcile(records: InstanceRecord[], rules: RoomAlarmRule[]): void {
    const parsed = parseRoomAlarms(rules);
    if (!parsed.ok) throw new Error(parsed.message);
    const previous = this.entries;
    const next = new Map<string, Entry>();
    const byId = new Map(records.map((record) => [record.id, record]));
    // Every target is resolved before any replacement material is allocated.
    for (const rule of parsed.value) {
      const record = byId.get(rule.target.instanceId);
      const old = previous.get(rule.id);
      const unchanged = old && sameRule(old.rule, rule) && old.record === record;
      const entry: Entry = {
        rule, record, target: undefined, error: undefined,
        active: Boolean(unchanged && old.active),
        latestTimestamp: unchanged ? old.latestTimestamp : undefined,
        latestValue: unchanged ? old.latestValue : undefined,
        overlays: unchanged ? old.overlays : new Map(),
      };
      if (!rule.enabled) { next.set(rule.id, entry); continue; }
      if (!record || record.assetId !== rule.target.modelAssetId) entry.error = "目标模型实例或资源不匹配";
      else {
        const matches = record.objectsByName.get(rule.target.nodeName) ?? [];
        if (matches.length !== 1 || matches[0] === record.model) entry.error = matches.length > 1 ? "目标节点名称重复" : "目标子节点不存在";
        else {
          const meshes: MaterialObject[] = [];
          matches[0].traverse((object) => { if (isMesh(object)) meshes.push(object); });
          if (!meshes.length) entry.error = "目标子树没有可着色网格";
          else entry.target = { record, meshes };
        }
      }
      next.set(rule.id, entry);
    }
    const occupied = new Map<MaterialObject, Entry>();
    let count = 0;
    for (const entry of next.values()) {
      if (!entry.rule.enabled || !entry.target || entry.error) continue;
      if (count + entry.target.meshes.length > ROOM_ALARM_LIMITS.maximumAffectedMeshes) {
        entry.error = `受影响网格超过 ${ROOM_ALARM_LIMITS.maximumAffectedMeshes} 个`;
        continue;
      }
      count += entry.target.meshes.length;
      for (const mesh of entry.target.meshes) {
        const owner = occupied.get(mesh);
        if (owner) { owner.error = "报警目标子树重叠"; entry.error = "报警目标子树重叠"; }
        else occupied.set(mesh, entry);
      }
    }
    previous.forEach((old, id) => {
      const entry = next.get(id);
      if (!entry || entry.error || entry.overlays !== old.overlays) this.restore(old);
    });
    next.forEach((entry) => {
      if (entry.error || !entry.rule.enabled) { entry.active = false; entry.latestTimestamp = undefined; entry.latestValue = undefined; this.restore(entry); }
      else this.paint(entry);
    });
    this.entries = next;
  }

  update(observations: Record<string, RoomAlarmObservation>, now = Date.now()): RoomAlarmStatus[] {
    const results: RoomAlarmStatus[] = [];
    for (const entry of this.entries.values()) {
      const { rule } = entry;
      let state: RoomAlarmStatus["state"] = entry.active ? "alarm" : "waiting";
      let message = entry.active ? "报警保持中" : "等待有效数据";
      if (entry.error) { state = "error"; message = entry.error; }
      else if (!rule.enabled) { state = "normal"; message = "报警规则已停用"; }
      else {
        const observation = observations[rule.id];
        if (!observation || observation.status === "loading") {
          state = "waiting"; message = observation?.message || "等待有效数据";
        } else if (observation.status === "offline") {
          state = "offline"; message = observation.message || "数据源失联，保留最后有效报警状态";
        } else {
          const timestamp = typeof observation.timestamp === "string" ? Date.parse(observation.timestamp) : NaN;
          const value = observation.value;
          const collected = observation.collectedAt === undefined ? timestamp : Date.parse(observation.collectedAt);
          if (!Number.isFinite(timestamp) || !Number.isFinite(collected) || !Number.isFinite(observation.staleAfterMs) || observation.staleAfterMs <= 0
            || collected > now + 5_000 || now - collected > observation.staleAfterMs
            || timestamp > now + 5_000 || now - timestamp > observation.staleAfterMs) {
            state = "stale"; message = "数据时间无效或已过期，保留最后有效报警状态";
          } else if (value === null || typeof value !== typeof rule.condition.value
            || (typeof value === "number" && (!Number.isFinite(value) || Math.abs(value) > ROOM_ALARM_LIMITS.maximumNumericValue))) {
            state = "error"; message = "指标值缺失或类型无效，保留最后有效报警状态";
          } else if (entry.latestTimestamp !== undefined && timestamp < entry.latestTimestamp) {
            state = "stale"; message = "旧数据不能覆盖最后有效状态";
          } else if (entry.latestTimestamp === timestamp && value !== entry.latestValue) {
            state = "error"; message = "同一时间戳的指标值冲突，保留最后有效报警状态";
          } else if (entry.latestTimestamp === timestamp) {
            state = entry.active ? "alarm" : "normal";
            message = entry.active ? "达到报警条件" : "报警条件未达到";
          } else {
            entry.latestTimestamp = timestamp;
            entry.latestValue = value as number | string | boolean;
            entry.active = conditionMet(rule, value as number | string | boolean);
            state = entry.active ? "alarm" : "normal";
            message = entry.active ? "达到报警条件" : "报警条件已解除";
          }
        }
      }
      if (!entry.active || entry.error || !rule.enabled) this.restore(entry);
      else this.paint(entry);
      if (entry.error) { state = "error"; message = entry.error; }
      results.push({ id: rule.id, state, active: entry.active, message });
    }
    return results;
  }

  dispose(): void {
    this.beforeModelStateChange();
    this.entries.clear();
  }
}
