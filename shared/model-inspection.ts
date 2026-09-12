export type ModelObject = { objectId: string; nodeIndex: number; name: string; parentObjectId: string | null; sourceId: string | null; mesh: boolean };
export type ModelInspectionDetails = {
  reportVersion: 2;
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
