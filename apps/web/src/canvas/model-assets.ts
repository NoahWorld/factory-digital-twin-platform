import { apiUrl } from "../api";

export type ModelInspection = {
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

export type ModelAsset = {
  id: string;
  projectId: string;
  originalFilename: string;
  format: "glb" | "gltf";
  contentType: string;
  byteSize: number;
  sha256: string;
  inspection: ModelInspection;
  createdAt: string;
};

export type ModelAssetListResponse = {
  modelAssets: ModelAsset[];
  requestId: string;
};

export type ModelAssetUploadResponse = {
  modelAsset: ModelAsset;
  requestId: string;
};

export const modelAssetsPath = (projectId: string): string =>
  `/api/v1/projects/${encodeURIComponent(projectId)}/model-assets`;

export const modelAssetContentUrl = (projectId: string, assetId: string): string =>
  apiUrl(`${modelAssetsPath(projectId)}/${encodeURIComponent(assetId)}/content`);

export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
