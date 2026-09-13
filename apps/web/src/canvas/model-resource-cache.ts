import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { inspectMeshoptBytes } from "../../../../shared/gltf-meshopt";
import { AnimationClip, PropertyBinding, type BufferGeometry, type Material, type Object3D, type Skeleton, type Texture } from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { ResourcePool } from "../../../../shared/resource-pool";
import { modelObjectLocator } from "../../../../shared/model-inspection";

type RenderObject = Object3D & { geometry?: BufferGeometry; material?: Material | Material[]; skeleton?: Skeleton };

export function disposeObjectResources(roots: Object3D[]) {
  const geometries = new Set<BufferGeometry>(); const materials = new Set<Material>();
  const textures = new Set<Texture>(); const images = new Set<{ close: () => void }>();
  const skeletons = new Set<Skeleton>();
  for (const root of roots) root.traverse((object) => {
    const item = object as RenderObject;
    if (item.geometry) geometries.add(item.geometry);
    if (item.skeleton) skeletons.add(item.skeleton);
    for (const material of item.material ? Array.isArray(item.material) ? item.material : [item.material] : []) materials.add(material);
  });
  const inspected = new Set<object>();
  const collectTextures = (value: unknown) => {
    if (!value || typeof value !== "object" || inspected.has(value)) return;
    inspected.add(value);
    if ((value as Texture).isTexture) {
      const texture = value as Texture; textures.add(texture);
      const data = texture.source?.data;
      for (const image of Array.isArray(data) ? data : [data]) if (image && typeof image.close === "function") images.add(image);
    } else if (Array.isArray(value)) value.forEach(collectTextures);
    else if (Object.getPrototypeOf(value) === Object.prototype) Object.values(value).forEach(collectTextures);
  };
  materials.forEach((material) => Object.values(material).forEach(collectTextures));
  skeletons.forEach((skeleton) => skeleton.dispose());
  geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose());
  textures.forEach((texture) => texture.dispose()); images.forEach((image) => image.close());
}

const modelPool = new ResourcePool<GLTF>(async (url, signal) => {
  const response = await fetch(url, { signal, credentials: "same-origin" });
  if (!response.ok) throw new Error(`模型资源请求失败（HTTP ${response.status}）`);
  const bytes = await response.arrayBuffer();
  signal.throwIfAborted();
  inspectMeshoptBytes(new Uint8Array(bytes));
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes, "");
}, (gltf) => disposeObjectResources(gltf.scenes));

export function acquireModelResource(url: string) {
  const lease = modelPool.acquire(url);
  let instance: Object3D | null = null;
  let released = false;
  return {
    ready: lease.ready.then((gltf) => {
      if (released) throw new DOMException("Model instance released", "AbortError");
      instance = clone(gltf.scene);
      const nodesByIndex = new Map<number, Object3D>();
      const objectsByLocator = new Map<string, Object3D>();
      const cloneBySource = new Map<Object3D, Object3D>();
      const stack: Array<{ source: Object3D; target: Object3D; nodeIndex?: number }> = [{ source: gltf.scene, target: instance }];
      while (stack.length) {
        const { source, target, nodeIndex: inheritedIndex } = stack.pop()!;
        cloneBySource.set(source, target);
        // Three r185 records primitives at runtime; its separate types omit that field.
        const association = gltf.parser.associations.get(source) as { nodes?: number; meshes?: number; primitives?: number } | undefined;
        const nodeIndex = association?.nodes ?? inheritedIndex;
        if (association?.nodes !== undefined) { nodesByIndex.set(association.nodes, target); objectsByLocator.set(modelObjectLocator({ nodeIndex: association.nodes }), target); }
        if (nodeIndex !== undefined) {
          if (association?.primitives !== undefined) objectsByLocator.set(modelObjectLocator({ nodeIndex, primitiveIndex: association.primitives }), target);
          else if (association?.meshes !== undefined && association.nodes === undefined) objectsByLocator.set(modelObjectLocator({ nodeIndex, attachment: "mesh" }), target);
          if (association?.nodes === undefined && "isCamera" in source && source.isCamera) objectsByLocator.set(modelObjectLocator({ nodeIndex, attachment: "camera" }), target);
          if (association?.nodes === undefined && "isLight" in source && source.isLight) objectsByLocator.set(modelObjectLocator({ nodeIndex, attachment: "light" }), target);
        }
        source.children.forEach((child, index) => stack.push({ source: child, target: target.children[index], nodeIndex }));
      }
      return { scene: instance, animations: gltf.animations, nodesByIndex, objectsByLocator,
        animationClip: (index: number) => {
          if (released) throw new Error("模型实例已释放。");
          const source = gltf.animations[index];
          if (!source) throw new Error("模型动画不存在。");
          const tracks = source.tracks.map((track) => {
            const binding = PropertyBinding.parseTrackName(track.name);
            const original = PropertyBinding.findNode(gltf.scene, binding.nodeName);
            const target = original ? cloneBySource.get(original as Object3D) : undefined;
            if (!target || binding.objectName) throw new Error(`动画目标无法映射到当前实例：${track.name}`);
            // clone() preserves GLTFLoader's CUBICSPLINE createInterpolant.
            const copy = track.clone();
            copy.name = `${target.uuid}.${binding.propertyName}${binding.propertyIndex === undefined ? "" : `[${binding.propertyIndex}]`}`;
            return copy;
          });
          return new AnimationClip(source.name, source.duration, tracks, source.blendMode);
        },
      };
    }),
    release: () => {
      if (released) return;
      released = true;
      // SkeletonUtils creates instance-owned skeletons; geometry/material/texture belong to the pool.
      const skeletons = new Set<Skeleton>();
      instance?.traverse((object) => { const skeleton = (object as RenderObject).skeleton; if (skeleton) skeletons.add(skeleton); });
      skeletons.forEach((skeleton) => skeleton.dispose());
      instance?.removeFromParent(); instance = null;
      lease.release();
    },
  };
}

/** Read-only diagnostics used by the viewport and lifecycle acceptance. */
export const modelResourceDiagnostics = () => modelPool.snapshot();
