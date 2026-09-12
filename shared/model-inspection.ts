export type ModelObject = { objectId: string; nodeIndex: number; primitiveIndex?: number; attachment?: "mesh" | "camera" | "light"; name: string; nameIsGenerated?: boolean; parentObjectId: string | null; sourceId: string | null; nodeSourceId?: string | null; primitiveSourceId?: string | null; mesh: boolean; inDefaultScene?: boolean };
export type ModelAnimation = { clipId: string; animationIndex: number; name: string; sourceId: string | null; startTime: number; duration: number; inDefaultScene: boolean;
  channels: Array<{ objectId: string; path: "translation" | "rotation" | "scale" | "weights"; interpolation: "LINEAR" | "STEP" | "CUBICSPLINE" }> };
export const modelObjectLocator = (object: Pick<ModelObject, "nodeIndex" | "primitiveIndex" | "attachment">) => JSON.stringify([object.nodeIndex, object.attachment ?? null, object.primitiveIndex ?? null]);
// Assigned within an immutable file version. These IDs are opaque references;
// changing versions requires source identity or an explicit repair map.
export const modelSubObjectId = (assetId: string, nodeIndex: number, kind: string) => `${assetId}:${nodeIndex}:${kind}`;
export function modelObjectSourceKey(object: ModelObject): string | null {
  if (object.primitiveIndex !== undefined) return object.nodeSourceId && object.primitiveSourceId ? JSON.stringify(["primitive", object.nodeSourceId, object.primitiveSourceId]) : null;
  if (object.attachment) return object.nodeSourceId ? JSON.stringify(["attachment", object.nodeSourceId, object.attachment]) : null;
  return object.sourceId ? JSON.stringify(["node", object.sourceId]) : null;
}
export type ModelInspectionDetails = {
  reportVersion: 2;
  objectManifestVersion: 2;
  animationManifestVersion: 1;
  clips: ModelAnimation[];
  triangleCount: number;
  sceneTriangleCount: number;
  vertexCount: number;
  bounds: { min: number[]; max: number[]; scope: "default-scene-rest-pose" } | null;
  textures: Array<{ name: string; mimeType: string; width: number | null; height: number | null; byteSize: number }>;
  coordinateUnit: "metre-by-gltf-spec";
  objects: ModelObject[];
  warnings: string[];
};

export type ModelInspection = Partial<ModelInspectionDetails> & {
  format: "glb" | "gltf";
  gltfVersion: string;
  sceneCount: number;
  nodeCount: number;
  meshCount: number;
  materialCount: number;
  textureCount: number;
  imageCount: number;
  animationCount: number;
  namedNodeCount: number;
  duplicateNodeNames: string[];
  externalResourceCount: number;
};
