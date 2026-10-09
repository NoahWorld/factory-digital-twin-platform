/** Versioned data-driven scene contract. Points are observations, never an animation clock. */
export type TwinVector = [number, number, number];
export type TwinPoint = {
  id: string; label: string; assetId: string; metricKey: string; unit: string;
  /** JSON field observed from the configured business API, e.g. agv.positionM. */
  sourcePath?: string;
  /** Exact project-scoped WebSocket topic. No wildcard subscriptions. */
  topic?: string;
  /** Optional human-readable labels for discrete API feedback, also shown in delivery previews. */
  valueLabels?: { value: number; label: string }[];
  min: number; max: number; initialValue: number; maxSpeed: number; staleAfterMs: number;
};
export type TwinApiConnection = {
  protocol: "rest" | "websocket";
  /** Relative built-in test endpoint, or an allowlisted upstream absolute URL. */
  url: string;
  timestampPath: string;
  intervalMs: number;
  timeoutMs: number;
  /** Optional JSON subscription request sent after opening an upstream WebSocket. */
  subscribeMessage?: string;
  /** Read-only projection: upstream URL and subscription payload are hidden from viewers. */
  redacted?: boolean;
};
export type TwinApiSourceTest = { timestamp: string; fields: { path: string; type: "number" | "boolean" | "string"; value: number | boolean | string }[] };
export type TwinTarget = { instanceId: string; modelAssetId: string; nodeName: string };
export type TwinPoseKey = { value: number; position: TwinVector; rotation: TwinVector; scale: TwinVector };
export type TwinMotionBinding = {
  id: string; label: string; pointId: string; target: TwinTarget;
  parentBindingId: string | null;
  /** Model coordinates (metres, Y-up). false permits an explicitly calibrated zero pose. */
  useNodeRestPose: boolean;
  kind: "translation" | "rotation" | "pose" | "visibility";
  axis: TwinVector; pivot: TwinVector; valueScale: number; valueOffset: number;
  /** Pose keys use point engineering units, not seconds. Rotation values are degrees. */
  poses: TwinPoseKey[];
};
export type TwinCollider = { id: string; label: string; target: TwinTarget; center: TwinVector; size: TwinVector };
export type TwinCollisionRule = { id: string; label: string; first: string; second: string; severity: "warning" | "error"; enabled: boolean };
export type TwinSetpoint = { pointId: string; value: number };
export type TwinProcedureStep = { id: string; label: string; targets: TwinSetpoint[]; tolerance: number; timeoutMs: number };
export type TwinProcedure = { id: string; label: string; steps: TwinProcedureStep[] };
export type TwinSimulation = { enabled: boolean; procedureId: string; repeat: boolean };
export type TwinDriveConfig = {
  version: 1; enabled: boolean; source: "simulator" | "api";
  connection?: TwinApiConnection;
  description?: string;
  /** Historical configuration only; the platform simulation executor has been retired. */
  simulation?: TwinSimulation;
  points: TwinPoint[]; bindings: TwinMotionBinding[];
  colliders: TwinCollider[]; collisionRules: TwinCollisionRule[]; procedures: TwinProcedure[];
};
export type TwinDrivePatch = { expectedRevision: number; config: TwinDriveConfig };
export type TwinDriveDocument = { projectId: string; revision: number; config: TwinDriveConfig; editable: boolean };
export type TwinPointSample = { value: number; target: number; timestamp: string; quality: "good" | "stale" | "error"; topic?: string };
export type TwinDriveSnapshot = {
  type: "snapshot"; projectId: string; revision: number; sequence: number; timestamp: string;
  source: "simulator" | "api"; status: "idle" | "running" | "paused" | "error";
  /** Source collection failure; samples remain last observations, never substituted. */
  error?: string;
  retryCount?: number;
  points: Record<string, TwinPointSample>;
  procedure: { id: string; stepIndex: number; status: "running" | "completed" | "error"; message: string } | null;
};
export type TwinDriveCommand = {
  type: "command"; commandId: string; expectedRevision: number;
  operation: "set" | "move" | "pause" | "resume" | "reset" | "run-procedure" | "stop-procedure";
  values?: TwinSetpoint[]; procedureId?: string;
};
export type TwinCollisionEvent = {
  ruleId: string; phase: "enter" | "exit"; timestamp: string; sequence: number;
  provenance: "browser-obb"; severity: "warning" | "error";
};
export const TWIN_DRIVE_LIMITS = { points: 128, bindings: 128, colliders: 64, collisionRules: 128, procedures: 16, steps: 64, poses: 64 } as const;
export const emptyTwinDriveConfig = (): TwinDriveConfig => ({ version: 1, enabled: false, source: "api", connection: { protocol: "rest", url: "", timestampPath: "timestamp", intervalMs: 500, timeoutMs: 5000 }, points: [], bindings: [], colliders: [], collisionRules: [], procedures: [] });
export const twinDrivePath = (projectId: string) => `/api/v1/projects/${encodeURIComponent(projectId)}/twin-drive`;

/** Bounded field paths, deliberately excluding expressions and prototype traversal. */
export function twinSourcePathValid(path: string): boolean {
  if (typeof path !== "string" || path.length > 256 || !/^(?:\$\.)?[A-Za-z_][A-Za-z0-9_]*(?:\[\d{1,3}\]|\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(path)) return false;
  const tokens = path.replace(/^\$\./, "").match(/[A-Za-z_][A-Za-z0-9_]*|\d+/g)!;
  return tokens.length <= 8 && !tokens.some(token => ["__proto__", "prototype", "constructor"].includes(token));
}

export function twinApiConnectionErrors(connection: TwinApiConnection, allowEmpty = false): string[] {
  const errors: string[] = [];
  if (!["rest", "websocket"].includes(connection.protocol)) errors.push("请选择 REST 轮询或 WebSocket 订阅");
  if (!twinSourcePathValid(connection.timestampPath)) errors.push("采样时间字段无效，例如 timestamp");
  if (!Number.isInteger(connection.intervalMs) || connection.intervalMs < 200 || connection.intervalMs > 60000) errors.push("采集间隔须为 200–60000 毫秒");
  if (!Number.isInteger(connection.timeoutMs) || connection.timeoutMs < 500 || connection.timeoutMs > 30000) errors.push("接口超时须为 500–30000 毫秒");
  const internal = connection.protocol === "rest" ? "/api/v1/test-business/handling-cell/state" : "/api/v1/test-business/handling-cell/live";
  if (connection.redacted !== undefined && typeof connection.redacted !== "boolean") errors.push("接口地址可见状态无效");
  if (connection.redacted && (connection.url !== "" || connection.subscribeMessage !== undefined)) errors.push("只读接口配置不能暴露私有地址或订阅消息");
  if (!(connection.redacted && connection.url === "") && !(allowEmpty && connection.url === "") && connection.url !== internal) {
    try {
      const url = new URL(connection.url);
      const protocols = connection.protocol === "rest" ? ["http:", "https:"] : ["ws:", "wss:"];
      if (!protocols.includes(url.protocol) || !url.hostname || url.username || url.password || url.hash || connection.url.length > 2048 || [...url.searchParams.keys()].some(key => /(?:token|secret|password|credential|api[-_]?key|authorization)/i.test(key))) errors.push("接口地址无效；协议须匹配，凭据不能放在地址中");
    } catch { errors.push("请填写完整接口地址，或选择内置测试接口"); }
  }
  if (connection.subscribeMessage !== undefined) {
    if (connection.protocol !== "websocket" || connection.subscribeMessage.length > 8192) errors.push("订阅消息仅用于 WebSocket，不能超过 8192 字符");
    try { const parsed: unknown = JSON.parse(connection.subscribeMessage); if (!parsed || typeof parsed !== "object") errors.push("订阅消息须为 JSON 对象或数组"); } catch { errors.push("订阅消息不是有效 JSON"); }
  }
  return errors;
}

/** Shared semantic checks; structural validation is additionally enforced by the generated API schema. */
export function twinDriveErrors(config: TwinDriveConfig): string[] {
  const errors: string[] = [];
  const error = (text: string) => errors.push(text);
  const finite = (v: number) => Number.isFinite(v);
  const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
  const metricPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
  const topicPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
  const unique = (items: { id: string; label: string }[], label: string, max: number) => {
    if (items.length > max) error(`${label}最多 ${max} 项`);
    const ids = new Set<string>();
    items.forEach(item => { if (!idPattern.test(item.id) || ids.has(item.id)) error(`${label} ID 无效或重复：${item.id}`); if (!item.label.trim() || item.label.length > 120) error(`${label}名称不能为空且不能超过 120 字符`); ids.add(item.id); });
    return ids;
  };
  if (config.version !== 1 || !["simulator", "api"].includes(config.source)) error("不支持的数据驱动版本或数据源");
  if (config.source === "api") {
    if (!config.connection) error("请配置业务接口");
    else errors.push(...twinApiConnectionErrors(config.connection, !config.enabled && !config.points.length));
    if (config.simulation !== undefined || config.procedures.length) error("接口驱动不使用平台模拟流程，请重新接入业务接口");
    if (config.enabled && (!config.points.length || !config.bindings.length)) error("启用接口驱动前，请至少绑定一个模型动作");
  } else if (config.connection !== undefined) error("旧模拟配置不能携带业务接口");
  if (config.description !== undefined && (typeof config.description !== "string" || config.description.length > 4000)) error("配置说明不能超过 4000 字符");
  const points = unique(config.points, "点位", TWIN_DRIVE_LIMITS.points);
  const bindings = unique(config.bindings, "运动绑定", TWIN_DRIVE_LIMITS.bindings);
  const colliders = unique(config.colliders, "碰撞体", TWIN_DRIVE_LIMITS.colliders);
  unique(config.collisionRules, "碰撞规则", TWIN_DRIVE_LIMITS.collisionRules);
  const procedures = unique(config.procedures, "模拟工序", TWIN_DRIVE_LIMITS.procedures);
  const metrics = new Set<string>();
  const topics = new Set<string>();
  for (const p of config.points) {
    if (p.topic !== undefined) {
      if (typeof p.topic !== "string" || !topicPattern.test(p.topic) || topics.has(p.topic)) error(`${p.id}：topic 无效或重复（1–200 字符，不支持通配符）`);
      topics.add(p.topic);
    }
    if (config.source === "api") {
      if (!p.sourcePath || !twinSourcePathValid(p.sourcePath)) error(`${p.id}：业务数据字段无效`);
      if (p.topic !== undefined) error(`${p.id}：接口驱动不需要 Topic 配置`);
    }
    if (((config.source === "simulator" || p.assetId !== "") && !metricPattern.test(p.assetId)) || !metricPattern.test(p.metricKey)) error(`${p.id}：资产编号或指标键无效`);
    if (p.unit.length > 32) error(`${p.id}：单位不能超过 32 字符`);
    if (p.valueLabels !== undefined) {
      const labels = new Set<number>();
      if (!Array.isArray(p.valueLabels) || p.valueLabels.length < 1 || p.valueLabels.length > 64) error(`${p.id}：状态说明需要 1–64 个值`);
      else for (const entry of p.valueLabels) {
        if (!Number.isInteger(entry.value) || entry.value < p.min || entry.value > p.max || labels.has(entry.value)
          || typeof entry.label !== "string" || !entry.label.trim() || entry.label.length > 120 || /[\u0000-\u001f\u007f-\u009f]/.test(entry.label)) error(`${p.id}：状态值须唯一、在量程内，说明须为 1–120 字符的文字`);
        labels.add(entry.value);
      }
    }
    const metric = `${p.assetId}/${p.metricKey}`;
    if (metrics.has(metric)) error(`资产指标重复：${metric}`);
    metrics.add(metric);
    if (config.source === "api") {
      if (![p.min,p.max,p.staleAfterMs].every(finite) || Math.max(Math.abs(p.min), Math.abs(p.max)) > 1e6 || p.min >= p.max || !Number.isInteger(p.staleAfterMs) || p.staleAfterMs < 500 || p.staleAfterMs > 60000) error(`${p.id}：数据范围或过期时间无效`);
      // Historical structural fields are retained for document compatibility, never as API motion inputs.
      if (![p.initialValue,p.maxSpeed].every(finite) || Math.abs(p.initialValue) > 1e6 || p.maxSpeed < 0 || p.maxSpeed > 1e6) error(`${p.id}：历史兼容字段异常，请在高级配置中修正`);
    } else if (![p.min,p.max,p.initialValue,p.maxSpeed,p.staleAfterMs].every(finite) || Math.max(Math.abs(p.min), Math.abs(p.max)) > 1e6 || p.min >= p.max || p.initialValue < p.min || p.initialValue > p.max || p.maxSpeed <= 0 || p.maxSpeed > 1e6 || !Number.isInteger(p.staleAfterMs) || p.staleAfterMs < 500 || p.staleAfterMs > 60000) error(`${p.id}：量程、初值、速度或陈旧时间无效`);
  }
  if (config.simulation !== undefined) {
    const simulation = config.simulation;
    if (typeof simulation.enabled !== "boolean" || typeof simulation.repeat !== "boolean" || typeof simulation.procedureId !== "string" || simulation.procedureId.length > 120) error("后端模拟源配置无效");
    if (simulation.enabled) {
      if (!config.enabled || !config.points.length || !config.bindings.length) error("启动后端模拟源需要启用数据驱动并配置点位和模型绑定");
      if (!procedures.has(simulation.procedureId)) error("后端模拟源必须选择已配置的工序");
      if (config.points.some(point => !point.topic)) error("启动后端模拟源前必须为每个点位配置 topic");
    }
  }
  const targetKeys = new Set<string>();
  const vector = (v: TwinVector) => v.length === 3 && v.every(x => finite(x) && Math.abs(x) <= 1e6);
  const target = (t: TwinTarget) => idPattern.test(t.instanceId) && idPattern.test(t.modelAssetId) && t.nodeName.length > 0 && t.nodeName.length <= 256;
  const byId = new Map(config.bindings.map(b => [b.id, b]));
  for (const b of config.bindings) {
    const key = `${b.target.instanceId}/${b.target.nodeName}`;
    if (!target(b.target) || targetKeys.has(key)) error(`${b.id}：模型节点无效或被重复驱动`);
    targetKeys.add(key);
    if (!points.has(b.pointId) || !finite(b.valueScale) || !finite(b.valueOffset) || !vector(b.axis) || !vector(b.pivot)) error(`${b.id}：点位或变换参数无效`);
    const point = config.points.find(p => p.id === b.pointId);
    if (point && ![point.min, point.max].every(value => finite(value * b.valueScale + b.valueOffset))) error(`${b.id}：点位量程经变换后超出有效数值范围`);
    if ((b.kind === "rotation" || b.kind === "translation") && Math.abs(Math.hypot(...b.axis) - 1) > 1e-5) error(`${b.id}：运动轴必须是单位向量`);
    if (b.parentBindingId !== null && (!bindings.has(b.parentBindingId) || byId.get(b.parentBindingId)?.target.instanceId !== b.target.instanceId)) error(`${b.id}：上级关节必须属于同一模型实例`);
    const ancestors = new Set([b.id]); let parent = b.parentBindingId;
    while (parent && byId.has(parent)) { if (ancestors.has(parent)) { error(`${b.id}：关节依赖存在循环`); break; } ancestors.add(parent); parent = byId.get(parent)!.parentBindingId; }
    if (b.kind === "pose") {
      if (b.poses.length < 2 || b.poses.length > TWIN_DRIVE_LIMITS.poses) error(`${b.id}：姿态映射需要 2–64 个点值关键姿态`);
      b.poses.forEach((p,i) => { if (!finite(p.value) || (i > 0 && p.value <= b.poses[i-1].value) || !vector(p.position) || !vector(p.rotation) || !vector(p.scale) || p.scale.some(x => x < 0)) error(`${b.id}：姿态点值必须递增，变换必须有效`); });
    } else if (b.poses.length) error(`${b.id}：非姿态绑定不能携带姿态序列`);
  }
  for (const c of config.colliders) if (!target(c.target) || !vector(c.center) || !vector(c.size) || c.size.some(x => x <= 0)) error(`${c.id}：碰撞盒节点、中心或尺寸无效`);
  const pairs = new Set<string>();
  for (const r of config.collisionRules) {
    if (!colliders.has(r.first) || !colliders.has(r.second) || r.first === r.second) error(`${r.id}：碰撞对无效`);
    const pair = [r.first,r.second].sort().join("/"); if (pairs.has(pair)) error(`${r.id}：重复碰撞对`); pairs.add(pair);
  }
  for (const procedure of config.procedures) {
    unique(procedure.steps, `${procedure.id} 工序`, TWIN_DRIVE_LIMITS.steps);
    if (!procedure.steps.length) error(`${procedure.id}：工序不能为空`);
    for (const step of procedure.steps) {
      if (!finite(step.tolerance) || step.tolerance < 0 || !Number.isInteger(step.timeoutMs) || step.timeoutMs < 1000 || step.timeoutMs > 600000 || !step.targets.length || step.targets.length > TWIN_DRIVE_LIMITS.points) error(`${step.id}：工序容差、超时或目标数量无效`);
      const seen = new Set<string>();
      for (const setpoint of step.targets) { const p = config.points.find(p => p.id === setpoint.pointId); if (!p || seen.has(setpoint.pointId) || !finite(setpoint.value) || setpoint.value < p.min || setpoint.value > p.max) error(`${step.id}：目标点值无效 ${setpoint.pointId}`); seen.add(setpoint.pointId); }
    }
  }
  return errors;
}
