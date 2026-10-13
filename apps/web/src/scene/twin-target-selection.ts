import { Box3, BoxHelper, Raycaster, Vector2, type Camera, type Object3D } from "three";
import type { TwinTarget } from "../../../../shared/twin-drive";
import type { InstanceRecord } from "./instance-manager";

export type TwinNodeCatalogEntry = {
  instanceId: string; modelAssetId: string; nodeName: string;
  unique: boolean; drivable: boolean; label?: string; parentNodeName?: string;
};

const uniqueNodeName = (record: InstanceRecord, object: Object3D): string | null => {
  const name = object.name.trim();
  const matches = record.objectsByName.get(name);
  return object !== record.model && matches?.length === 1 && matches[0] === object ? name : null;
};

export function buildTwinNodeCatalog(records: InstanceRecord[]): TwinNodeCatalogEntry[] {
  return records.flatMap(record => [...record.objectsByName].map(([nodeName, objects]) => {
    const object = objects.length === 1 ? objects[0] : undefined;
    let parentNodeName: string | undefined;
    for (let parent = object?.parent; parent && parent !== record.model; parent = parent.parent) {
      const name = uniqueNodeName(record, parent);
      if (name) { parentNodeName = name; break; }
    }
    const label = typeof object?.userData.label === "string" ? object.userData.label.trim() : "";
    return {
      instanceId: record.id, modelAssetId: record.assetId, nodeName,
      unique: objects.length === 1, drivable: !!object && object !== record.model,
      ...(label ? { label } : {}), ...(parentNodeName ? { parentNodeName } : {}),
    };
  }));
}

export function resolveTwinTarget(records: InstanceRecord[], target: TwinTarget): { record: InstanceRecord; object: Object3D } {
  const record = records.find(candidate => candidate.id === target.instanceId && candidate.assetId === target.modelAssetId);
  if (!record) throw new Error(`点选目标模型实例不存在或资源已替换：${target.instanceId} / ${target.modelAssetId}`);
  const objects = record.objectsByName.get(target.nodeName);
  if (!objects?.length) throw new Error(`点选目标节点不存在：${target.nodeName}`);
  if (objects.length !== 1) throw new Error(`点选目标节点名称不唯一：${target.nodeName}`);
  const object = objects[0]!;
  // Existing collider bindings may target the resource root. Outlining it is read-only;
  // picking and the motion catalog still exclude that root as a drivable target.
  if (object.name.trim() !== target.nodeName) throw new Error(`请选择模型内的唯一节点：${target.nodeName}`);
  return { record, object };
}

/** Only the nearest visible geometry owns the click; never raycast through an unbindable wall. */
export function createTwinTargetPickingService(camera: Camera, canvas: Pick<HTMLCanvasElement, "getBoundingClientRect">) {
  const raycaster = new Raycaster();
  raycaster.firstHitOnly = true;
  const pointer = new Vector2();
  const bounds = new Box3();
  return (clientX: number, clientY: number, records: InstanceRecord[], occluders: Object3D[] = []): TwinTarget[] => {
    const viewport = canvas.getBoundingClientRect();
    if (viewport.width <= 0 || viewport.height <= 0) throw new Error("3D 视窗尺寸无效，无法执行模型点选");
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) throw new Error("模型点选坐标无效");
    pointer.set((clientX - viewport.left) / viewport.width * 2 - 1, -(clientY - viewport.top) / viewport.height * 2 + 1);
    camera.updateMatrixWorld();
    raycaster.setFromCamera(pointer, camera);
    const candidates: Object3D[] = [];
    const owners = new Map<Object3D, InstanceRecord>();
    const addGeometry = (root: Object3D, owner?: InstanceRecord) => {
      root.updateWorldMatrix(true, true);
      root.traverseVisible(object => {
        if (!("isMesh" in object || "isLine" in object || "isPoints" in object)) return;
        candidates.push(object);
        if (owner) owners.set(object, owner);
      });
    };
    for (const record of records) {
      if (!record.wrapper.visible) continue;
      record.wrapper.updateWorldMatrix(true, true);
      if (!record.mixer && !raycaster.ray.intersectsBox(bounds.setFromObject(record.wrapper))) continue;
      addGeometry(record.wrapper, record);
    }
    occluders.forEach(root => addGeometry(root));
    const hit = raycaster.intersectObjects(candidates, false)[0];
    if (!hit) return [];
    const record = owners.get(hit.object);
    if (!record) return [];
    const targets: TwinTarget[] = [];
    for (let object: Object3D | null = hit.object; object && object !== record.model; object = object.parent) {
      const nodeName = uniqueNodeName(record, object);
      if (nodeName) targets.push({ instanceId: record.id, modelAssetId: record.assetId, nodeName });
    }
    return targets;
  };
}

/** Session-only outline; neither model materials nor persisted configuration are changed. */
export class TwinTargetSelectionOutline {
  private helper: BoxHelper | null = null;
  private selected: { record: InstanceRecord; object: Object3D } | null = null;
  constructor(private scene: Object3D) {}

  set(records: InstanceRecord[], target: TwinTarget | null) {
    this.clear();
    if (!target) return;
    const selected = resolveTwinTarget(records, target);
    selected.object.updateWorldMatrix(true, true);
    if (new Box3().setFromObject(selected.object).isEmpty()) return;
    this.selected = selected;
    this.helper = new BoxHelper(selected.object, 0x5ad8ff);
    this.helper.material.depthTest = false;
    this.helper.material.transparent = true;
    this.helper.material.opacity = 0.95;
    this.helper.material.toneMapped = false;
    this.helper.renderOrder = 100000;
    this.scene.add(this.helper);
    this.update();
  }

  update() {
    if (!this.helper || !this.selected) return;
    let attached = false;
    let visible = true;
    for (let object: Object3D | null = this.selected.object; object; object = object.parent) {
      visible = visible && object.visible;
      if (object === this.selected.record.wrapper) attached = true;
      if (object === this.scene) break;
    }
    if (!attached || !this.selected.record.wrapper.parent) { this.clear(); return; }
    this.helper.visible = visible;
    if (visible) this.helper.update();
  }

  clear() {
    if (this.helper) {
      this.helper.removeFromParent();
      this.helper.geometry.dispose();
      this.helper.material.dispose();
    }
    this.helper = null;
    this.selected = null;
  }

  dispose() { this.clear(); }
}
