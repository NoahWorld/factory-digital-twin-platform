import { Box3, Group, MathUtils, Vector3, type Material, type Object3D } from "three";
import type { ModelInstance } from "../../../../shared/scene-definition";
import { modelObjectLocator, modelSubObjectId, type ModelObject } from "../../../../shared/model-inspection";
import type { ModelNodeAppearance, ModelNodeTransform } from "./types";
import { buildModelSceneTree } from "./model-scene";
import type { MotionProperty, MotionValue, MotionVector } from "../../../../shared/scene-motion";

export type ObjectTarget = { instanceId: string; objectId: string | null };
type MaterialOwner = Object3D & { material?: Material | Material[] };
type LoadedModel = { scene: Object3D; nodesByIndex: Map<number, Object3D>; objectsByLocator?: Map<string, Object3D> };

export function createModelInstance(definition: ModelInstance, model: LoadedModel, objects: ModelObject[], legacyNames = false) {
  const root = new Group(); root.name = definition.name; root.add(model.scene);
  const byId = new Map<string, Object3D>(); const byObject = new Map<Object3D, string>();
  const byName = new Map<string, Object3D[]>();
  const paths = new Map<string, Object3D>(); const objectPaths = new Map<Object3D, string>();
  const originals = new Map<Object3D, { position: ModelNodeTransform["position"]; rotation: ModelNodeTransform["rotation"]; scale: ModelNodeTransform["scale"]; visible: boolean; material?: Material | Material[]; morphWeights?: number[] }>();
  const clones = new Map<MaterialOwner, Material[]>();
  const motionMaterialBases = new WeakMap<Material, { transparent: boolean; depthWrite: boolean }>();
  for (const object of objects) {
    const target = model.objectsByLocator?.get(modelObjectLocator(object)) ?? (object.primitiveIndex === undefined && !object.attachment ? model.nodesByIndex.get(object.nodeIndex) : undefined);
    if (target) { byId.set(object.objectId, target); byObject.set(target, object.objectId); }
  }
  // Old files without an upgraded manifest still have session-only node identities.
  for (const [index, target] of model.nodesByIndex) if (!byObject.has(target)) { const id = `legacy-node-${index}`; byId.set(id, target); byObject.set(target, id); }
  // Older reports can be upgraded without changing their node IDs. Sub-object
  // identifiers are deterministic within this immutable resource version.
  for (const [locator, target] of model.objectsByLocator ?? []) if (!byObject.has(target)) {
    const [nodeIndex, attachment, primitiveIndex] = JSON.parse(locator) as [number, ModelObject["attachment"] | null, number | null];
    if (!attachment && primitiveIndex === null) continue;
    const id = modelSubObjectId(definition.modelAssetId, nodeIndex, attachment ?? `primitive-${primitiveIndex}`);
    byId.set(id, target); byObject.set(target, id);
  }
  const stack = model.scene.children.map((object, index) => ({ object, path: String(index) }));
  while (stack.length) {
    const { object, path } = stack.pop()!; paths.set(path, object); objectPaths.set(object, path);
    object.children.forEach((child, index) => stack.push({ object: child, path: `${path}/${index}` }));
  }
  model.scene.traverse((object) => {
    originals.set(object, { position: object.position.toArray(), rotation: [MathUtils.radToDeg(object.rotation.x), MathUtils.radToDeg(object.rotation.y), MathUtils.radToDeg(object.rotation.z)], scale: object.scale.toArray(), visible: object.visible, material: (object as MaterialOwner).material,
      morphWeights: (object as Object3D & { morphTargetInfluences?: number[] }).morphTargetInfluences?.slice() });
    if (object.name) { const entries = byName.get(object.name) ?? []; entries.push(object); byName.set(object.name, entries); }
  });
  const resolve = (key: string) => {
    if (!legacyNames) { const target = byId.get(key); if (!target) throw new Error(`实例「${definition.name}」缺少对象 ${key}`); return target; }
    const matches = byName.get(key); if (matches?.length !== 1) throw new Error(`模型对象名缺失或不唯一：${key}`); return matches[0];
  };
  const restoreAppearances = () => {
    clones.forEach((materials, object) => { object.material = originals.get(object)?.material; materials.forEach((material) => material.dispose()); }); clones.clear();
    originals.forEach((original, object) => { object.visible = original.visible; });
  };
  const transform = (object: Object3D, value: ModelNodeTransform) => {
    object.position.fromArray(value.position); object.rotation.set(...value.rotation.map(MathUtils.degToRad) as [number, number, number]); object.scale.fromArray(value.scale);
  };
  const appearance = (target: Object3D, value: ModelNodeAppearance) => {
    target.visible = value.visible;
    target.traverse((child) => {
      const owner = child as MaterialOwner; const original = originals.get(child)?.material;
      if (!original) return;
      let materials = clones.get(owner);
      if (!materials) { materials = (Array.isArray(original) ? original : [original]).map((material) => material.clone()); clones.set(owner, materials); owner.material = Array.isArray(original) ? materials : materials[0]; }
      for (const [index, material] of materials.entries()) {
        const source = Array.isArray(original) ? original[index] : original;
        (material as Material & { color?: { set: (color: string) => void } }).color?.set(value.color);
        const transparent = value.opacity < 1 || source.transparent, depthWrite = value.opacity < 1 ? false : source.depthWrite;
        if (material.transparent !== transparent || material.depthWrite !== depthWrite) material.needsUpdate = true;
        material.opacity = value.opacity; material.transparent = transparent; material.depthWrite = depthWrite;
      }
    });
  };
  let transformSignature: string | undefined, appearanceSignature: string | undefined;
  let latestDefinition = definition;
  let latestRuntime: Record<string, ModelNodeAppearance> = {};
  const restorePose = () => {
    transform(root, latestDefinition.transform);
    originals.forEach((original, object) => {
      transform(object, original);
      const weights = (object as Object3D & { morphTargetInfluences?: number[] }).morphTargetInfluences;
      if (weights && original.morphWeights) original.morphWeights.forEach((weight, index) => { weights[index] = weight; });
    });
    for (const [id, value] of Object.entries(latestDefinition.objectTransforms)) transform(resolve(id), value);
    root.updateMatrixWorld(true);
  };
  const apply = (next: ModelInstance, runtime: Record<string, ModelNodeAppearance> = {}) => {
    const depth = (object: Object3D) => { let count = 0; for (let item = object.parent; item; item = item.parent) count++; return count; };
    const ordered = (values: Record<string, ModelNodeAppearance>) => Object.entries(values).map(([id, value]) => ({ target: resolve(id), value })).sort((a, b) => depth(a.target) - depth(b.target));
    const transforms = Object.entries(next.objectTransforms).map(([id, value]) => ({ target: resolve(id), value }));
    const appearances = ordered(next.objectAppearances), runtimeAppearances = ordered(legacyNames ? Object.fromEntries(Object.entries(runtime).filter(([name]) => byName.has(name))) : runtime);
    // Resolve every target before touching a previously valid rendered instance.
    root.name = next.name;
    const nextTransformSignature = JSON.stringify([next.transform, next.objectTransforms]);
    const nextAppearanceSignature = JSON.stringify([next.appearance, next.objectAppearances, runtime]);
    if (nextTransformSignature !== transformSignature) {
      transformSignature = undefined;
      transform(root, next.transform);
      originals.forEach((original, object) => transform(object, original));
      for (const { target, value } of transforms) transform(target, value);
      transformSignature = nextTransformSignature;
    }
    if (nextAppearanceSignature !== appearanceSignature) {
      appearanceSignature = undefined; restoreAppearances();
      if (next.appearance) appearance(model.scene, next.appearance);
      for (const { target, value } of appearances) appearance(target, value);
      for (const { target, value } of runtimeAppearances) appearance(target, value);
      appearanceSignature = nextAppearanceSignature;
    }
    latestDefinition = next; latestRuntime = runtime;
    root.visible = next.visible; root.updateMatrixWorld(true);
  };
  const targetsForObject = (object: Object3D): ObjectTarget[] => {
    const targets: ObjectTarget[] = [];
    for (let current: Object3D | null = object; current && current !== root; current = current.parent) {
      const id = byObject.get(current); if (id) targets.push({ instanceId: definition.id, objectId: id });
    }
    return targets;
  };
  const targetFor = (object: Object3D): ObjectTarget | null => targetsForObject(object)[0] ?? null;
  const tree = buildModelSceneTree(model.scene);
  const nodeIndices = new Map([...model.nodesByIndex].map(([index, object]) => [object, index]));
  const locators = new Map<Object3D, { nodeIndex: number; attachment?: ModelObject["attachment"]; primitiveIndex?: number }>();
  nodeIndices.forEach((nodeIndex, object) => locators.set(object, { nodeIndex }));
  for (const [locator, object] of model.objectsByLocator ?? []) if (!locators.has(object)) {
    const [nodeIndex, attachment, primitiveIndex] = JSON.parse(locator) as [number, ModelObject["attachment"] | null, number | null];
    locators.set(object, { nodeIndex, ...(attachment ? { attachment } : {}), ...(primitiveIndex !== null ? { primitiveIndex } : {}) });
  }
  const annotate = (nodes: typeof tree.roots) => nodes.forEach((node) => {
    const object = paths.get(node.path)!;
    node.objectId = byObject.get(object) ?? null; node.instanceId = definition.id; Object.assign(node, locators.get(object)); annotate(node.children);
  });
  annotate(tree.roots);
  const motionObject = (objectId: string | null) => {
    const target = objectId === null ? root : byId.get(objectId);
    if (!target) throw new Error("动画目标对象不存在。"); return target;
  };
  const motionMaterials = (target: Object3D, write = false) => {
    const result: Material[] = [];
    target.traverse((object) => {
      const owner = object as MaterialOwner, source = originals.get(object)?.material;
      if (!source) return;
      if (write && !clones.has(owner)) { const values = (Array.isArray(owner.material) ? owner.material : [owner.material!]).map((material) => material.clone()); clones.set(owner,values); owner.material = Array.isArray(source) ? values : values[0]; }
      const materials = Array.isArray(owner.material) ? owner.material : [owner.material!];
      materials.forEach((material,index) => { const original = Array.isArray(source) ? source[index] : source; motionMaterialBases.set(material,{ transparent: original.transparent,depthWrite: original.depthWrite }); });
      result.push(...materials);
    });
    return result;
  };
  const readMotion = (objectId: string | null, property: MotionProperty): MotionValue => {
    const target = motionObject(objectId);
    if (property === "position" || property === "scale") return target[property].toArray();
    if (property === "rotation") return [target.rotation.x,target.rotation.y,target.rotation.z].map(MathUtils.radToDeg) as MotionVector;
    if (property === "visible") return target.visible;
    const material = motionMaterials(target)[0] as Material & { color?: { getHexString: () => string } } | undefined;
    if (!material || (property === "color" && !material.color)) throw new Error("动画目标不包含可编辑的材质。");
    return property === "color" ? `#${material.color!.getHexString()}` : material.opacity;
  };
  const writeMotion = (objectId: string | null, property: MotionProperty, value: MotionValue) => {
    const target = motionObject(objectId);
    if (property === "position" || property === "scale") target[property].fromArray(value as MotionVector);
    else if (property === "rotation") target.rotation.set(...(value as MotionVector).map(MathUtils.degToRad) as MotionVector);
    else if (property === "visible") target.visible = value as boolean;
    else for (const material of motionMaterials(target,true)) {
      if (property === "color") (material as Material & { color?: { set: (value: string) => void } }).color?.set(value as string);
      else {
        const base = motionMaterialBases.get(material)!;
        const transparent = (value as number) < 1 || base.transparent, depthWrite = (value as number) < 1 ? false : base.depthWrite;
        if (material.transparent !== transparent || material.depthWrite !== depthWrite) material.needsUpdate = true;
        material.opacity = value as number; material.transparent = transparent; material.depthWrite = depthWrite;
      }
    }
    // Device data remains the highest visual layer for bound objects.
    if (["color", "opacity", "visible"].includes(property)) for (const [id, appearanceValue] of Object.entries(latestRuntime)) appearance(resolve(id),appearanceValue);
    root.updateMatrixWorld(true);
  };
  const restoreConfiguration = () => { transformSignature = undefined; appearanceSignature = undefined; apply(latestDefinition,latestRuntime); restorePose(); };
  return { root, apply, restorePose, restoreConfiguration, readMotion, writeMotion, bounds: () => new Box3().setFromObject(root), targetFor, targetsForObject,
    materialColors: () => {
      const colors = new Set<string>();
      root.traverse((object) => { const material = (object as MaterialOwner).material;
        for (const value of material ? Array.isArray(material) ? material : [material] : []) {
          const color = (value as Material & { color?: { getHexString: () => string } }).color; if (color) colors.add(`#${color.getHexString()}`);
        }
      }); return [...colors];
    },
    inspectObject: (objectId: string | null) => {
      const object = objectId === null ? root : byId.get(objectId); if (!object) return null;
      const colors = new Set<string>();
      object.traverse((item) => {
        const material = (item as MaterialOwner).material;
        for (const value of material ? Array.isArray(material) ? material : [material] : []) {
          const color = (value as Material & { color?: { getHexString: () => string } }).color; if (color) colors.add(`#${color.getHexString()}`);
        }
      });
      const bounds = new Box3().setFromObject(object);
      return { name: object.name, colors: [...colors], center: bounds.isEmpty() ? null : bounds.getCenter(new Vector3()).toArray() };
    },
    resolveTarget: (target: ObjectTarget) => target.objectId === null ? root : byId.get(target.objectId) ?? null,
    pathFor: (target: ObjectTarget) => target.objectId ? objectPaths.get(byId.get(target.objectId)!) ?? null : null,
    objectAtPath: (path: string) => paths.get(path) ?? null,
    pathForObject: (object: Object3D) => objectPaths.get(object) ?? null,
    targetAtPath: (path: string) => paths.has(path) ? targetFor(paths.get(path)!) : null,
    snapshot: { ...tree, assetId: definition.modelAssetId },
    dispose: () => { restoreAppearances(); root.removeFromParent(); },
  };
}
export type ModelInstanceController = ReturnType<typeof createModelInstance>;
