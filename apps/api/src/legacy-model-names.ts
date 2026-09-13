import { Texture,PropertyBinding,type Object3D,type BufferGeometry,type Material,type Skeleton } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { modelObjectLocator } from "../../../shared/model-inspection";
import type { LegacyModelNames } from "../../../shared/runtime-project";

/** Use the same pinned loader as the viewport. Texture pixels are unnecessary for
 * object identity; replacing texture I/O keeps this inspection DOM/network-free. */
export async function inspectLegacyModelNames(bytes:Uint8Array):Promise<LegacyModelNames> {
  const textures:Texture[] = [];
  const loader = new GLTFLoader().register((parser) => {
    const getDependency = parser.getDependency.bind(parser),cache = new Map<number,Texture>();
    parser.getDependency = (type:string,index:number) => {
      if (type === "texture") {
        let texture = cache.get(index); if (!texture) { texture = new Texture(); cache.set(index,texture); textures.push(texture); }
        return Promise.resolve(texture);
      }
      if (type === "buffer") {
        const uri = parser.json.buffers[index].uri;
        if (uri !== undefined) {
          if (typeof uri !== "string" || !uri.startsWith("data:")) return Promise.reject(new Error("Legacy model inspection requires embedded buffers."));
          return fetch(uri).then((response) => response.arrayBuffer());
        }
      }
      return getDependency(type,index);
    };
    return { name:"NEWPOWER_HEADLESS_NAMES" };
  });
  const gltf = await loader.parseAsync(Uint8Array.from(bytes).buffer,"");
  try {
    const loadedMeshes = new Set<number>();
    for (const association of gltf.parser.associations.values()) if (association.meshes !== undefined) loadedMeshes.add(association.meshes);
    const meshBases = new Map<string,number[]>();
    gltf.parser.json.meshes?.forEach((mesh:{ name?:string },index:number) => { if (!loadedMeshes.has(index)) return; const base = PropertyBinding.sanitizeNodeName(mesh.name || `mesh_${index}`); (meshBases.get(base) ?? (meshBases.set(base,[]),meshBases.get(base)!)).push(index); });
    const competingMeshes = new Set([...meshBases.values()].filter((indices) => indices.length > 1).flat());
    const uncertainNames = new Set<string>();
    const names:Record<string,string[]> = Object.create(null),stack:Array<{ object:Object3D;nodeIndex?:number }> = [{ object:gltf.scene }];
    while (stack.length) {
      const { object,nodeIndex:inherited } = stack.pop()!;
      const association = gltf.parser.associations.get(object) as { nodes?:number;meshes?:number;primitives?:number } | undefined;
      const nodeIndex = association?.nodes ?? inherited;
      let locator:string|null = null;
      if (association?.nodes !== undefined) locator = modelObjectLocator({ nodeIndex:association.nodes });
      else if (nodeIndex !== undefined) {
        if (association?.primitives !== undefined) locator = modelObjectLocator({ nodeIndex,primitiveIndex:association.primitives });
        else if (association?.meshes !== undefined) locator = modelObjectLocator({ nodeIndex,attachment:"mesh" });
        else if ("isCamera" in object && object.isCamera) locator = modelObjectLocator({ nodeIndex,attachment:"camera" });
        else if ("isLight" in object && object.isLight) locator = modelObjectLocator({ nodeIndex,attachment:"light" });
      }
      if (object.name && locator) {
        (names[object.name] ??= []).push(locator);
        const meshIndex = association?.meshes ?? (nodeIndex === undefined ? undefined : gltf.parser.json.nodes[nodeIndex]?.mesh);
        // Explicit node names are reserved before dependencies; names assigned to
        // mesh objects after asynchronous material loads are not stable across
        // different meshes sharing one sanitized name.
        const explicitNodeName = association?.nodes !== undefined && gltf.parser.json.nodes[association.nodes]?.name;
        if (!explicitNodeName && meshIndex !== undefined && competingMeshes.has(meshIndex)) uncertainNames.add(object.name);
      }
      object.children.forEach((child) => stack.push({ object:child,nodeIndex }));
    }
    return { names,unstableNames:[...uncertainNames] };
  } finally {
    const geometries = new Set<BufferGeometry>(),materials = new Set<Material>(),skeletons = new Set<Skeleton>();
    for (const scene of gltf.scenes) scene.traverse((object) => {
      const render = object as Object3D & { geometry?:BufferGeometry;material?:Material|Material[];skeleton?:Skeleton };
      if (render.geometry) geometries.add(render.geometry); if (render.skeleton) skeletons.add(render.skeleton);
      if (render.material) for (const material of Array.isArray(render.material) ? render.material : [render.material]) materials.add(material);
    });
    skeletons.forEach((value) => value.dispose()); geometries.forEach((value) => value.dispose()); materials.forEach((value) => value.dispose()); textures.forEach((value) => value.dispose());
  }
}
