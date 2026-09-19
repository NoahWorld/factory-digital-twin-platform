import {validateCompressionProvenance} from "../../../shared/model-compression";
import { inspectMeshoptDocument,inspectMeshoptBytes } from "../../../shared/gltf-meshopt";
import { WebIO, MathUtils, type mat4, type vec3, type vec4, type GLTF, type Mesh, type Node } from "@gltf-transform/core";
import { ALL_EXTENSIONS, type InstancedMesh } from "@gltf-transform/extensions";
import { AppError,type AppEnv } from "./auth";
import { modelSubObjectId, type ModelInspectionDetails, type ModelObject } from "../../../shared/model-inspection";
import { inspectModelAnimations } from "./model-animation-inspection";

/** Inspect embedded bytes only. readJSON/readBinary never fetch model URLs. */
export async function inspectModelDetails(bytes: Uint8Array, format: "glb" | "gltf", assetId: string = crypto.randomUUID(),codecs?:AppEnv["MODEL_CODECS"]): Promise<ModelInspectionDetails> {
  const warnings: string[] = [];
  const io = new WebIO().registerExtensions(ALL_EXTENSIONS).setLogger({ debug() {}, info() {}, warn(message) { warnings.push(message); }, error(message) { warnings.push(message); } });
  try {
    const json = format === "glb" ? await io.binaryToJSON(bytes) : { json: JSON.parse(new TextDecoder().decode(bytes)) as GLTF.IGLTF, resources: {} };
    const provenance = json.json.asset.extras?.newpowerCompression;
    const optimization = provenance === undefined ? undefined:validateCompressionProvenance(provenance);
    const compression = inspectMeshoptDocument(json.json,format === "glb");
    if(optimization && (!compression || optimization.compressedViews!==compression.views || optimization.decodedBytes!==compression.decodedBytes || optimization.preservedViews!==(json.json.bufferViews?.length ?? 0)-compression.views)) throw new Error("压缩来源记录与文件布局不符");
    if (compression) {
      inspectMeshoptBytes(bytes);
      if (!codecs?.meshopt?.supported) throw new AppError(503,"model_codec_unavailable","此宿主不提供Meshopt模型检查，请使用支持该能力的独立运行器。");
      await codecs.meshopt.ready;io.registerDependencies({ "meshopt.decoder":codecs.meshopt });
    }
    // Prevent sparse or compressed metadata from requesting unbounded decoded allocations.
    let decodedBytes = 0;
    for (const [index, accessor] of (json.json.accessors ?? []).entries()) {
      const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }[accessor.type];
      if (!Number.isSafeInteger(accessor.count) || accessor.count < 1 || !size) throw new Error(`accessors[${index}] 的数量或类型无效`);
      decodedBytes += accessor.count * size * 8;
    }
    if (decodedBytes > 256 * 1024 * 1024) throw new Error("访问器解码预算超过 256 MiB，请分拆模型资源");
    const nodes = json.json.nodes ?? [];
    const parents = new Map<number, number>();
    for (const [index, node] of nodes.entries()) for (const child of node.children ?? []) {
      if (!Number.isInteger(child) || child < 0 || child >= nodes.length || parents.has(child)) throw new Error(`nodes[${index}].children 包含缺失节点或多重父节点`);
      parents.set(child, index);
    }
    const checked = new Set<number>();
    for (let index = 0; index < nodes.length; index++) {
      const path = new Set<number>(); let current: number | undefined = index;
      while (current !== undefined && !checked.has(current)) {
        if (path.has(current)) throw new Error(`nodes[${index}] 的父子引用形成循环`);
        path.add(current); current = parents.get(current);
      }
      path.forEach((node) => checked.add(node));
    }
    const sourceIds = new Set<string>();
    const objectIds = nodes.map((node, index) => {
      const sourceId = node.extras?.newpowerObjectId;
      if (sourceId !== undefined && (typeof sourceId !== "string" || !sourceId.trim() || sourceId.length > 200 || sourceIds.has(sourceId))) throw new Error(`nodes[${index}].extras.newpowerObjectId 必须非空且唯一`);
      if (typeof sourceId === "string") sourceIds.add(sourceId);
      return { objectId: crypto.randomUUID(), sourceId: typeof sourceId === "string" ? sourceId : null };
    });
    const document = await io.readJSON(json);
    const root = document.getRoot();
    const meshTriangles = new Map<Mesh, number>();
    let triangleCount = 0, vertexCount = 0;
    for (const mesh of root.listMeshes()) {
      let triangles = 0;
      for (const primitive of mesh.listPrimitives()) {
        const positions = primitive.getAttribute("POSITION");
        if (!positions || positions.getType() !== "VEC3") throw new Error(`网格「${mesh.getName()}」缺少有效 POSITION`);
        vertexCount += positions.getCount();
        const count = primitive.getIndices()?.getCount() ?? positions.getCount();
        const mode = primitive.getMode();
        if (mode === 4) { if (count % 3) throw new Error(`网格「${mesh.getName()}」的三角形索引数量不是 3 的倍数`); triangles += count / 3; }
        else if (mode === 5 || mode === 6) triangles += Math.max(0, count - 2);
        const indexAccessor = primitive.getIndices();
        if (indexAccessor && (indexAccessor.getType() !== "SCALAR" || ![5121, 5123, 5125].includes(indexAccessor.getComponentType()) || indexAccessor.getNormalized())) throw new Error(`网格「${mesh.getName()}」的索引必须是未归一化的无符号整数 SCALAR`);
        const indices = indexAccessor?.getArray();
        if (indices) for (const index of indices) if (!Number.isInteger(index) || index < 0 || index >= positions.getCount()) throw new Error(`网格「${mesh.getName()}」的索引超出顶点范围`);
      }
      meshTriangles.set(mesh, triangles); triangleCount += triangles;
    }
    const scene = root.getDefaultScene() ?? root.listScenes()[0];
    let sceneTriangleCount = 0;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const visited = new Set<Node>();
    let vertexWork = 0;
    scene?.traverse((node) => {
      if (visited.has(node)) return; visited.add(node);
      const mesh = node.getMesh(); if (!mesh) return;
      const instancing = node.getExtension<InstancedMesh>("EXT_mesh_gpu_instancing");
      const attributes = instancing?.listAttributes() ?? [];
      const instanceCount = instancing ? attributes[0]?.getCount() ?? 0 : 1;
      if (instanceCount < 1 || attributes.some((attribute) => attribute.getCount() !== instanceCount)) throw new Error(`节点「${node.getName()}」的 GPU 实例属性数量不一致`);
      for (const semantic of ["TRANSLATION", "ROTATION", "SCALE"]) {
        const attribute = instancing?.getAttribute(semantic);
        if (attribute && attribute.getType() !== (semantic === "ROTATION" ? "VEC4" : "VEC3")) throw new Error(`节点「${node.getName()}」的 ${semantic} 实例属性维度无效`);
      }
      sceneTriangleCount += (meshTriangles.get(mesh) ?? 0) * instanceCount;
      vertexWork += mesh.listPrimitives().reduce((count, primitive) => count + (primitive.getIndices()?.getCount() ?? primitive.getAttribute("POSITION")!.getCount()), 0) * instanceCount;
      if (vertexWork > 20_000_000) throw new Error("场景展开检查超过 2000 万次顶点变换预算，请拆分场景或减少实例");
      if (node.getSkin()) warnings.push(`节点「${node.getName()}」含骨骼；边界不包含动画变形`);
      const matrix = node.getWorldMatrix();
      for (const primitive of mesh.listPrimitives()) {
        if (primitive.listTargets().length) warnings.push(`节点「${node.getName()}」含形态目标；边界不包含形态变形`);
        const positions = primitive.getAttribute("POSITION")!;
        const indices = primitive.getIndices(); const point: number[] = [];
        for (let instance = 0; instance < instanceCount; instance++) {
          const translation = instancing?.getAttribute("TRANSLATION")?.getElement(instance, [0, 0, 0]) as vec3 | undefined;
          const rotation = instancing?.getAttribute("ROTATION")?.getElement(instance, [0, 0, 0, 1]) as vec4 | undefined;
          const scale = instancing?.getAttribute("SCALE")?.getElement(instance, [1, 1, 1]) as vec3 | undefined;
          const local = instancing ? MathUtils.compose(translation ?? [0,0,0], rotation ?? [0,0,0,1], scale ?? [1,1,1], new Array(16).fill(0) as mat4) : null;
          for (let index = 0; index < (indices?.getCount() ?? positions.getCount()); index++) {
            positions.getElement(indices ? indices.getScalar(index) : index, point);
            const vertex = local ? [0,1,2].map((axis) => local[axis] * point[0] + local[4 + axis] * point[1] + local[8 + axis] * point[2] + local[12 + axis]) : point;
            for (let axis = 0; axis < 3; axis++) {
              const value = matrix[axis] * vertex[0] + matrix[4 + axis] * vertex[1] + matrix[8 + axis] * vertex[2] + matrix[12 + axis];
              if (!Number.isFinite(value)) throw new Error(`节点「${node.getName()}」的坐标或变换不是有限数值`);
              min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value);
            }
          }
        }
      }
    });
    const textures = root.listTextures().map((texture) => {
      const image = texture.getImage();
      if (!image?.byteLength) throw new Error(`纹理「${texture.getName()}」缺少图像数据`);
      const size = texture.getSize();
      if (!size || size.some((value) => !Number.isInteger(value) || value < 1)) throw new Error(`纹理「${texture.getName()}」的图像格式或尺寸无效`);
      return { name: texture.getName(), mimeType: texture.getMimeType(), width: size[0], height: size[1], byteSize: image.byteLength };
    });
    warnings.push("坐标按 glTF 米制约定解释；源文件导出比例仍需现场核对。");
    if (!scene) warnings.push("没有可运行的场景。");
    const decodedNodes = root.listNodes();
    const objects: ModelObject[] = nodes.map((node, index) => ({ ...objectIds[index], nodeIndex: index, name: node.name ?? "", mesh: node.mesh !== undefined, inDefaultScene: visited.has(decodedNodes[index]), parentObjectId: parents.has(index) ? objectIds[parents.get(index)!].objectId : null }));
    const joints = new Set(json.json.skins?.flatMap((skin) => skin.joints) ?? []);
    nodes.forEach((node, nodeIndex) => {
      const mesh = node.mesh === undefined ? undefined : json.json.meshes?.[node.mesh];
      const light = node.extensions?.KHR_lights_punctual;
      const container = joints.has(nodeIndex) || Number(!!mesh) + Number(node.camera !== undefined) + Number(!!light) > 1;
      const base = { nodeIndex, sourceId: null, nodeSourceId: objectIds[nodeIndex].sourceId, inDefaultScene: visited.has(decodedNodes[nodeIndex]) };
      const nodeId = objectIds[nodeIndex].objectId;
      let meshParentId: string = nodeId;
      if (mesh && container && mesh.primitives.length > 1) {
        meshParentId = modelSubObjectId(assetId, nodeIndex, "mesh");
        objects.push({ ...base, objectId: meshParentId, attachment: "mesh", name: mesh.name || `${node.name || "节点"} 网格`, nameIsGenerated: !mesh.name, parentObjectId: nodeId, mesh: true });
      }
      const primitiveSources = new Set<string>();
      if (mesh && (container || mesh.primitives.length > 1)) mesh.primitives.forEach((primitive, primitiveIndex) => {
        const sourceId = primitive.extras?.newpowerObjectId;
        if (sourceId !== undefined && (typeof sourceId !== "string" || !sourceId.trim() || sourceId.length > 200 || primitiveSources.has(sourceId))) throw new Error(`mesh ${node.mesh} 的子网格源标识必须非空且唯一`);
        if (typeof sourceId === "string") primitiveSources.add(sourceId);
        const materialName = primitive.material === undefined ? undefined : json.json.materials?.[primitive.material]?.name;
        const authored = typeof primitive.extras?.name === "string" ? primitive.extras.name : materialName;
        objects.push({ ...base, objectId: modelSubObjectId(assetId, nodeIndex, `primitive-${primitiveIndex}`), primitiveIndex, primitiveSourceId: typeof sourceId === "string" ? sourceId : null,
          name: `${node.name || `节点 ${nodeIndex}`} / ${authored || `子网格 ${primitiveIndex}`}`, nameIsGenerated: !node.name || !authored, parentObjectId: meshParentId, mesh: true });
      });
      if (container && node.camera !== undefined) objects.push({ ...base, objectId: modelSubObjectId(assetId, nodeIndex, "camera"), attachment: "camera", name: json.json.cameras?.[node.camera]?.name || `${node.name || "节点"} 相机`, nameIsGenerated: !json.json.cameras?.[node.camera]?.name, parentObjectId: nodeId, mesh: false });
      if (container && light) objects.push({ ...base, objectId: modelSubObjectId(assetId, nodeIndex, "light"), attachment: "light", name: `${node.name || "节点"} 灯光`, nameIsGenerated: true, parentObjectId: nodeId, mesh: false });
    });
    const clips = inspectModelAnimations(root,objects,visited,json.json);
    return { ...(optimization ? {optimization}:{}),...(compression ? { compression }:{}),reportVersion: 2, objectManifestVersion: 2, animationManifestVersion: 1, clips, triangleCount, sceneTriangleCount, vertexCount,
      bounds: min.every(Number.isFinite) ? { min, max, scope: "default-scene-rest-pose" } : null,
      textures, coordinateUnit: "metre-by-gltf-spec", warnings: [...new Set(warnings)],
      objects };
  } catch (reason) {
    if (reason instanceof AppError) throw reason;
    throw new AppError(400, "model_inspection_failed", `模型检查失败：${reason instanceof Error ? reason.message : String(reason)}`);
  }
}
