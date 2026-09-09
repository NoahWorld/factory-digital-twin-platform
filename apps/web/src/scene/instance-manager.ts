import { AnimationMixer, Box3, Group, type Material, type Object3D, type Quaternion, type Vector3 } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { acceleratedRaycast } from "three-mesh-bvh";
import type { ModelAssetInstance } from "../canvas/types";
import { ResourceManager, type ResourceLease } from "./resource-manager";

export type MaterialObject = Object3D & { material?: Material | Material[] };
export type InstanceRecord = {
  assetId: string;
  id: string;
  model: Object3D;
  wrapper: Group;
  mixer: AnimationMixer | null;
  animationCount: number;
  originals: Map<Object3D, { position: Vector3; quaternion: Quaternion; scale: Vector3 }>;
  originalVisibility: Map<Object3D, boolean>;
  originalMaterials: Map<MaterialObject, Material | Material[]>;
  activeMaterialClones: Map<MaterialObject, Material[]>;
  objectsByName: Map<string, Object3D[]>;
  release: () => void;
};

export function disposeClonedMaterials(record: InstanceRecord) {
  record.activeMaterialClones.forEach((materials, owner) => {
    owner.material = record.originalMaterials.get(owner);
    materials.forEach((material) => material.dispose());
  });
  record.activeMaterialClones.clear();
}

function createRecord(instance: ModelAssetInstance, lease: ResourceLease<GLTF>): InstanceRecord {
  if (new Box3().setFromObject(lease.value.scene).isEmpty()) throw new Error(`模型实例“${instance.label}”没有可显示的几何边界`);
  const model = clone(lease.value.scene);
  const wrapper = new Group();
  wrapper.userData.modelInstanceId = instance.id;
  wrapper.userData.modelAssetId = instance.assetId;
  wrapper.add(model);
  const mixer = lease.value.animations.length ? new AnimationMixer(model) : null;
  lease.value.animations.forEach((clip) => mixer!.clipAction(clip).play());
  const record: InstanceRecord = {
    assetId: instance.assetId, id: instance.id, model, wrapper, mixer,
    animationCount: lease.value.animations.length,
    originals: new Map(), originalVisibility: new Map(), originalMaterials: new Map(),
    activeMaterialClones: new Map(), objectsByName: new Map(), release: lease.release,
  };
  model.traverse((object) => {
    record.originals.set(object, { position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone() });
    record.originalVisibility.set(object, object.visible);
    const owner = object as MaterialObject;
    if (owner.material) record.originalMaterials.set(owner, owner.material);
    const name = object.name.trim();
    if (name) record.objectsByName.set(name, [...(record.objectsByName.get(name) ?? []), object]);
    const mesh = object as Object3D & { isMesh?: boolean; isSkinnedMesh?: boolean; isInstancedMesh?: boolean; geometry?: { boundsTree?: unknown } };
    // Preserve specialized SkinnedMesh/InstancedMesh raycasting; morph geometry has no static BVH.
    if (mesh.isMesh && !mesh.isSkinnedMesh && !mesh.isInstancedMesh && mesh.geometry?.boundsTree) object.raycast = acceleratedRaycast;
  });
  return record;
}

export function destroyInstance(record: InstanceRecord) {
  record.wrapper.removeFromParent();
  record.mixer?.stopAllAction();
  record.mixer?.uncacheRoot(record.model);
  disposeClonedMaterials(record);
  // SkeletonUtils.clone owns skeletons; geometry/material/texture belong to the source lease.
  record.model.traverse((object) => {
    const skinned = object as Object3D & { isSkinnedMesh?: boolean; skeleton?: { dispose: () => void } };
    if (skinned.isSkinnedMesh) skinned.skeleton?.dispose();
  });
  record.release();
}

/** Prepare additions before swapping, so failures leave a diagnosable last-good scene. */
export class InstanceManager {
  records: InstanceRecord[] = [];
  private pending: AbortController | null = null;
  private disposed = false;

  constructor(private resources: ResourceManager<GLTF>, private root: Object3D) {}

  cancelPending() {
    this.pending?.abort(new DOMException("实例配置已更新", "AbortError"));
    this.pending = null;
  }

  async reconcile(instances: ModelAssetInstance[]): Promise<boolean> {
    if (this.disposed) throw new Error("实例管理器已释放");
    if (new Set(instances.map((item) => item.id)).size !== instances.length) throw new Error("模型实例 ID 重复");
    this.cancelPending();
    const operation = new AbortController();
    this.pending = operation;
    const current = new Map(this.records.map((record) => [record.id, record]));
    const additions: InstanceRecord[] = [];
    const results = await Promise.allSettled(instances.map(async (instance) => {
      const previous = current.get(instance.id);
      if (previous?.assetId === instance.assetId) return previous;
      const lease = await this.resources.acquire(instance.assetId, operation.signal);
      try {
        operation.signal.throwIfAborted();
        const record = createRecord(instance, lease);
        additions.push(record);
        return record;
      } catch (reason) { lease.release(); throw reason; }
    }));
    if (operation.signal.aborted) {
      additions.forEach(destroyInstance);
      return false; // Superseded/disposed is an explicit lifecycle cancellation, not success.
    }
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") {
      additions.forEach(destroyInstance);
      throw failure.reason;
    }
    const next = results.map((result) => {
      if (result.status !== "fulfilled") throw new Error("实例准备结果不完整");
      return result.value;
    });
    const retained = new Set(next);
    this.records.filter((record) => !retained.has(record)).forEach(destroyInstance);
    additions.forEach((record) => this.root.add(record.wrapper));
    this.records = next;
    this.pending = null;
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.pending?.abort(new DOMException("场景已关闭", "AbortError"));
    this.records.forEach(destroyInstance);
    this.records = [];
  }
}
