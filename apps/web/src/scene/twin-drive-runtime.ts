import { Euler, MathUtils, Matrix4, Quaternion, Vector3, type Object3D } from "three";
import { OBB } from "three/examples/jsm/math/OBB.js";
import { twinDriveErrors, type TwinCollisionEvent, type TwinDriveConfig, type TwinMotionBinding, type TwinTarget } from "../../../../shared/twin-drive";
import type { TwinDriveLiveSource } from "../twin/point-stream";
import type { InstanceRecord } from "./instance-manager";

export type TwinNodeCatalogEntry = { instanceId: string; modelAssetId: string; nodeName: string; unique: boolean; drivable: boolean };
export type TwinDriveDiagnostics = {
  status: "disabled" | "waiting" | "live" | "paused" | "stale" | "disconnected" | "error";
  message: string; sequence: number | null; boundNodes: number;
  activeCollisions: string[]; events: TwinCollisionEvent[];
};
export type TwinDriveAttachment = {
  config: TwinDriveConfig; source: TwinDriveLiveSource;
  onDiagnostics?: (diagnostics: TwinDriveDiagnostics) => void;
  onCatalog?: (nodes: TwinNodeCatalogEntry[]) => void;
};
type Resolved = { record: InstanceRecord; object: Object3D };
type Binding = Resolved & { definition: TwinMotionBinding; rest: Matrix4; motion: Matrix4; desired: Matrix4; visibility: boolean };
const radians = MathUtils.degToRad;
const rotation = (v: [number, number, number]) => new Quaternion().setFromEuler(new Euler(...v.map(radians) as [number, number, number], "XYZ"));
const depth = (object: Object3D): number => object.parent ? 1 + depth(object.parent) : 0;

/** No animation time or target integration: a coherent observation snapshot determines the entire pose. */
export class TwinDriveRuntime {
  private bindings: Binding[] = [];
  private writeOrder: Binding[] = [];
  private boxes = new Map<string, Resolved & { center: Vector3; halfSize: Vector3; box: OBB; active: boolean }>();
  private originals = new Map<Object3D, { matrix: Matrix4; auto: boolean; visible: boolean }>();
  private active = new Set<string>();
  private events: TwinCollisionEvent[] = [];
  private lastSequence: number | null = null;
  private hasPose = false;
  private dirty = true;
  private failed: string | null = null;
  private lastReport = -Infinity;
  private lastStatus = "";
  private disposed = false;
  readonly drivenInstances = new Set<string>();
  diagnostics: TwinDriveDiagnostics = { status: "waiting", message: "等待点位反馈", sequence: null, boundNodes: 0, activeCollisions: [], events: [] };

  constructor(private records: InstanceRecord[], private attachment: TwinDriveAttachment) {
    attachment.onCatalog?.(records.flatMap(record => [...record.objectsByName].map(([nodeName, objects]) => ({
      instanceId: record.id, modelAssetId: record.assetId, nodeName, unique: objects.length === 1,
      drivable: objects.length === 1 && objects[0] !== record.model,
    }))));
    const errors = twinDriveErrors(attachment.config);
    if (errors.length) throw new Error(errors.join("；"));
    if (!attachment.config.enabled) return;
    const pending = [...attachment.config.bindings];
    const byId = new Map<string, Binding>();
    while (pending.length) {
      const index = pending.findIndex(b => b.parentBindingId === null || byId.has(b.parentBindingId));
      if (index < 0) throw new Error("点位绑定包含循环或缺失的上级关节");
      const definition = pending.splice(index, 1)[0]!;
      const resolved = this.resolve(definition.target);
      if (resolved.object === resolved.record.model) throw new Error(`${definition.label}：请绑定模型内的节点，不支持驱动资源根节点`);
      const binding = { ...resolved, definition, rest: this.restMatrix(resolved), motion: new Matrix4(), desired: new Matrix4(), visibility: resolved.object.visible };
      byId.set(definition.id, binding);
      this.bindings.push(binding);
      this.drivenInstances.add(resolved.record.id);
    }
    this.writeOrder = [...this.bindings].sort((a, b) => depth(a.object) - depth(b.object));
    for (const c of attachment.config.colliders) this.boxes.set(c.id, { ...this.resolve(c.target), center: new Vector3(...c.center), halfSize: new Vector3(...c.size).multiplyScalar(0.5), box: new OBB(), active: true });
    // Resolve everything before taking ownership, so an invalid configuration cannot partially change a scene.
    for (const b of this.bindings) this.originals.set(b.object, { matrix: b.object.matrix.clone(), auto: b.object.matrixAutoUpdate, visible: b.object.visible });
  }

  private resolve(target: TwinTarget): Resolved {
    const record = this.records.find(r => r.id === target.instanceId && r.assetId === target.modelAssetId);
    if (!record) throw new Error(`点位目标模型实例不存在或资源已替换：${target.instanceId} / ${target.modelAssetId}`);
    const matches = record.objectsByName.get(target.nodeName);
    if (!matches?.length) throw new Error(`点位目标节点不存在：${target.nodeName}`);
    if (matches.length !== 1) throw new Error(`点位目标节点名称不唯一：${target.nodeName}`);
    return { record, object: matches[0]! };
  }

  private restMatrix({ record, object }: Resolved) {
    const result = new Matrix4();
    for (let node: Object3D | null = object; node !== record.model; node = node.parent) {
      if (!node) throw new Error(`节点不属于模型：${object.name}`);
      const original = record.originals.get(node);
      if (!original) throw new Error(`缺少节点初始变换：${node.name}`);
      result.premultiply(new Matrix4().compose(original.position, original.quaternion, original.scale));
    }
    return result;
  }

  invalidate() { this.dirty = true; this.failed = null; }

  private motion(definition: TwinMotionBinding, observed: number): Matrix4 {
    const value = observed * definition.valueScale + definition.valueOffset;
    if (!Number.isFinite(value)) throw new Error(`${definition.label}：点值换算超出有效数值范围`);
    if (definition.kind === "translation") return new Matrix4().makeTranslation(new Vector3(...definition.axis).multiplyScalar(value));
    if (definition.kind === "rotation") {
      const pivot = new Vector3(...definition.pivot);
      return new Matrix4().makeTranslation(pivot).multiply(new Matrix4().makeRotationAxis(new Vector3(...definition.axis), radians(value))).multiply(new Matrix4().makeTranslation(pivot.clone().negate()));
    }
    if (definition.kind === "visibility") return new Matrix4();
    const keys = definition.poses;
    if (value < keys[0]!.value || value > keys[keys.length - 1]!.value) throw new Error(`${definition.label}：反馈值 ${value} 超出姿态映射范围`);
    const upper = keys.findIndex(k => k.value >= value);
    const left = keys[Math.max(0, upper - 1)]!, right = keys[upper]!;
    const t = left === right ? 0 : (value - left.value) / (right.value - left.value);
    return new Matrix4().compose(new Vector3(...left.position).lerp(new Vector3(...right.position), t), rotation(left.rotation).slerp(rotation(right.rotation), t), new Vector3(...left.scale).lerp(new Vector3(...right.scale), t));
  }

  private writePose(poses?: Map<Binding, { desired: Matrix4; visibility: boolean }>) {
    const previous = this.writeOrder.map(b => ({ object: b.object, matrix: b.object.matrix.clone(), auto: b.object.matrixAutoUpdate, visible: b.object.visible }));
    try { for (const b of this.writeOrder) {
      const parent = b.object.parent;
      if (!parent) throw new Error(`驱动节点已被移除：${b.definition.target.nodeName}`);
      parent.updateWorldMatrix(true, false);
      b.record.model.updateWorldMatrix(true, false);
      if (Math.abs(parent.matrixWorld.determinant()) < 1e-15) throw new Error(`驱动节点父级变换不可逆：${b.definition.target.nodeName}（检查父级零缩放）`);
      b.object.matrixAutoUpdate = false;
      const pose = poses?.get(b) ?? b;
      b.object.matrix.copy(parent.matrixWorld).invert().multiply(b.record.model.matrixWorld).multiply(pose.desired);
      b.object.matrixWorldNeedsUpdate = true;
      if (b.definition.kind === "visibility") b.object.visible = pose.visibility;
    } } catch (error) {
      // A later child can have a singular parent. Never leave earlier nodes in a half-applied snapshot.
      for (const p of previous) {
        p.object.matrix.copy(p.matrix); p.object.matrixAutoUpdate = p.auto; p.object.visible = p.visible;
        p.object.matrixWorldNeedsUpdate = true;
      }
      throw error;
    }
    this.dirty = false;
  }

  private collisions(sequence: number, timestamp: string) {
    for (const [id, c] of this.boxes) {
      c.object.updateWorldMatrix(true, false);
      const m = c.object.matrixWorld;
      const x = new Vector3().setFromMatrixColumn(m, 0), y = new Vector3().setFromMatrixColumn(m, 1), z = new Vector3().setFromMatrixColumn(m, 2);
      const scale = new Vector3(x.length(), y.length(), z.length());
      c.active = scale.x > 1e-12 && scale.y > 1e-12 && scale.z > 1e-12;
      if (!c.active) continue;
      x.divideScalar(scale.x); y.divideScalar(scale.y); z.divideScalar(scale.z);
      if (Math.max(Math.abs(x.dot(y)), Math.abs(x.dot(z)), Math.abs(y.dot(z))) > 1e-4) throw new Error(`碰撞体 ${id} 存在剪切变换，不能用定向盒准确表示；请调整父级非等比缩放`);
      c.box.center.copy(c.center).applyMatrix4(m);
      c.box.halfSize.copy(c.halfSize).multiply(scale);
      c.box.rotation.set(x.x, y.x, z.x, x.y, y.y, z.y, x.z, y.z, z.z);
    }
    for (const rule of this.attachment.config.collisionRules.filter(r => r.enabled)) {
      const a = this.boxes.get(rule.first)!, b = this.boxes.get(rule.second)!;
      const hit = a.active && b.active && a.box.intersectsOBB(b.box, 1e-8);
      if (hit === this.active.has(rule.id)) continue;
      if (hit) this.active.add(rule.id); else this.active.delete(rule.id);
      this.events.push({ ruleId: rule.id, phase: hit ? "enter" : "exit", timestamp, sequence, provenance: "browser-obb", severity: rule.severity });
      if (this.events.length > 100) this.events.shift();
    }
  }

  private report(status: TwinDriveDiagnostics["status"], message: string, now: number) {
    this.diagnostics = { status, message, sequence: this.lastSequence, boundNodes: this.bindings.length, activeCollisions: [...this.active], events: [...this.events] };
    const key = `${status}/${message}`;
    if (key !== this.lastStatus || now - this.lastReport >= 200) {
      this.lastReport = now; this.lastStatus = key;
      this.attachment.onDiagnostics?.(this.diagnostics);
    }
  }

  /** Called by the existing renderer loop; no new RAF, timer, mixer or WebGL context. */
  tick(now = Date.now(), animationConflict = false) {
    if (this.disposed) return;
    if (!this.attachment.config.enabled) { this.report("disabled", "点位驱动未启用", now); return; }
    try {
      if (animationConflict) throw new Error("点位驱动与原生动画冲突，请关闭已绑定实例的原生动画");
      if (this.failed) { this.report("error", this.failed, now); return; }
      // Settings edits may reset transforms. Restore the last coherent pose even if transport is down.
      if (this.dirty && this.hasPose) this.writePose();
      const state = this.attachment.source.getState(), snapshot = state.snapshot;
      if (!state.connected) { this.report("disconnected", "连接中断：模型保持最后有效姿态", now); return; }
      if (!snapshot || snapshot.status === "idle") { this.report("waiting", this.attachment.config.simulation?.enabled ? "等待后端自动模拟源的点位反馈" : "等待点位初始化；请在编辑页检查模拟源配置", now); return; }
      if (snapshot.status === "error") { this.report("error", snapshot.procedure?.message || "模拟器报告错误，已停止接收运动", now); return; }
      const required = new Set(this.bindings.map(b => b.definition.pointId));
      for (const p of this.attachment.config.points.filter(p => required.has(p.id))) {
        const sample = snapshot.points[p.id];
        if (!sample) { this.report("waiting", `缺少点位反馈：${p.label}`, now); return; }
        const age = now - Date.parse(sample.timestamp);
        if (sample.quality !== "good" || !Number.isFinite(age) || age > p.staleAfterMs || age < -5000) { this.report("stale", `点位过期或质量异常：${p.label}；模型保持最后有效姿态`, now); return; }
        if (!Number.isFinite(sample.value) || sample.value < p.min || sample.value > p.max) throw new Error(`点位 ${p.label} 的反馈值超出量程`);
      }
      if (this.lastSequence !== null && snapshot.sequence < this.lastSequence) throw new Error("点位序号回退，请重新连接当前配置");
      const changed = snapshot.sequence !== this.lastSequence || !this.hasPose;
      if (changed) {
        const motions = new Map<string, Matrix4>();
        const poses = new Map<Binding, { motion: Matrix4; desired: Matrix4; visibility: boolean }>();
        // Compute every target before touching the scene (atomic coherent snapshot).
        for (const b of this.bindings) {
          const value = snapshot.points[b.definition.pointId]!.value;
          const parent = b.definition.parentBindingId ? motions.get(b.definition.parentBindingId)! : new Matrix4();
          const motion = parent.clone().multiply(this.motion(b.definition, value));
          const desired = motion.clone();
          if (b.definition.useNodeRestPose) desired.multiply(b.rest);
          poses.set(b, { motion, desired, visibility: value * b.definition.valueScale + b.definition.valueOffset > 0 });
          motions.set(b.definition.id, motion);
        }
        this.writePose(poses);
        for (const [b, pose] of poses) { b.motion.copy(pose.motion); b.desired.copy(pose.desired); b.visibility = pose.visibility; }
        this.hasPose = true; this.lastSequence = snapshot.sequence;
      }
      // World-space collision boxes also respond to editor instance transforms.
      if (changed || now - this.lastReport >= 200) this.collisions(snapshot.sequence, snapshot.timestamp);
      this.report(snapshot.status === "paused" ? "paused" : "live", snapshot.status === "paused" ? "模拟器已暂停；显示最后反馈位置" : "模型由实际点位反馈驱动", now);
    } catch (reason) {
      this.failed = reason instanceof Error ? reason.message : String(reason);
      console.error("Twin drive runtime failed", { bindings: this.bindings.map(b => b.definition.id), sequence: this.lastSequence, reason });
      this.report("error", this.failed, now);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const [object, original] of this.originals) {
      object.matrixAutoUpdate = original.auto; object.matrix.copy(original.matrix);
      object.visible = original.visible; object.matrixWorldNeedsUpdate = true;
    }
  }
}
