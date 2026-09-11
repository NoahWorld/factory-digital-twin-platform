import type { BufferGeometry, Material, Object3D, Texture, WebGLRenderer } from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { MeshBVH } from "three-mesh-bvh";
import { buildModelSceneTree } from "../canvas/model-scene";
import { modelAssetContentUrl } from "../canvas/model-assets";

export const disposeModelResources = (root: Object3D) => {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  root.traverse((object) => {
    const owner = object as Object3D & { geometry?: BufferGeometry; material?: Material | Material[] };
    if (owner.geometry) geometries.add(owner.geometry);
    if (owner.material) (Array.isArray(owner.material) ? owner.material : [owner.material]).forEach((m) => materials.add(m));
  });
  for (const material of materials) {
    Object.values(material).forEach((value: unknown) => {
      if (value && typeof value === "object" && "isTexture" in value && value.isTexture) textures.add(value as Texture);
    });
    material.dispose();
  }
  for (const texture of textures) {
    if (typeof ImageBitmap !== "undefined" && texture.image instanceof ImageBitmap) texture.image.close();
    texture.dispose();
  }
  for (const geometry of geometries) { geometry.boundsTree = undefined; geometry.dispose(); }
};

/** Decoder assets are bundled locally; private factory deployments never need a CDN. */
export function createModelLoader(renderer: WebGLRenderer) {
  const root = `${import.meta.env.BASE_URL}decoders/`;
  const ktx2 = new KTX2Loader().setTranscoderPath(`${root}basis/`).setWorkerLimit(2).detectSupport(renderer);
  const draco = new DRACOLoader().setDecoderPath(`${root}draco/`).setWorkerLimit(2);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2).setDRACOLoader(draco);
  return { loader, dispose: () => { ktx2.dispose(); draco.dispose(); } };
}

export function createSceneModelLoader(projectId: string, renderer: WebGLRenderer) {
  const decoders = createModelLoader(renderer);
  let closing = false;
  let active = 0;
  return {
    // Let in-flight decoding finish so its result can be disposed; terminating workers
    // mid-task can strand loader promises and their partially constructed resources.
    dispose: () => { closing = true; if (active === 0) decoders.dispose(); },
    async load(assetId: string, signal: AbortSignal): Promise<GLTF> {
      if (closing) throw new Error("模型解码器已关闭");
      active++;
      const startedAt = performance.now();
      let gltf: GLTF | undefined;
      try {
        const response = await fetch(modelAssetContentUrl(projectId, assetId), { signal, credentials: "same-origin" });
        if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
        const buffer = await response.arrayBuffer();
        signal.throwIfAborted();
        // Uploaded glTF is self-contained by contract; external URI models are rejected by the API.
        gltf = await decoders.loader.parseAsync(buffer, "");
        signal.throwIfAborted();
        buildModelSceneTree(gltf.scene);
        const staticGeometries = new Set<BufferGeometry>();
        const dynamicGeometries = new Set<BufferGeometry>();
        gltf.scene.traverse((object) => {
          const mesh = object as Object3D & { isMesh?: boolean; isSkinnedMesh?: boolean; geometry?: BufferGeometry };
          if (!mesh.isMesh || !mesh.geometry) return;
          if (mesh.isSkinnedMesh || Object.keys(mesh.geometry.morphAttributes).length > 0) dynamicGeometries.add(mesh.geometry);
          else staticGeometries.add(mesh.geometry);
        });
        for (const geometry of staticGeometries) {
          if (!dynamicGeometries.has(geometry) && geometry.attributes.position && !geometry.boundsTree) {
            geometry.boundsTree = new MeshBVH(geometry, { indirect: true });
          }
        }
        console.info("scene.resource.loaded", { projectId, assetId, bytes: buffer.byteLength, durationMs: performance.now() - startedAt });
        return gltf;
      } catch (reason) {
        if (gltf) disposeModelResources(gltf.scene);
        if (signal.aborted) throw signal.reason;
        console.error("scene.resource.failed", { projectId, assetId, durationMs: performance.now() - startedAt, reason });
        throw new Error(`模型资源 ${assetId} 加载失败：${reason instanceof Error ? reason.message : String(reason)}`, { cause: reason });
      } finally {
        active--;
        if (closing && active === 0) decoders.dispose();
      }
    },
  };
}
