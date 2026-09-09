import { findBuiltinModel } from "../../../../shared/builtin-models";
import { apiUrl } from "../api";
import type { ResourceUsage } from "./resource-usage";

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

export type SceneBackgroundGeneration = {
  algorithm: "textured-plane-v1";
  imageHeight: number;
  imageWidth: number;
  movement: "fixed" | "limited";
  planeHeightMeters: number;
  planeWidthMeters: number;
  quality: "lightweight" | "balanced" | "detail";
  sourceImageAssetId: string;
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
  source: "system" | "upload" | "scene-background";
  sourceImageAssetId: string | null;
  generation: SceneBackgroundGeneration | null;
  usage: ResourceUsage;
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

export type ModelAssetDeletionResponse = {
  deletedModelAssetId: string;
  usage: ResourceUsage;
  warning: string | null;
  requestId: string;
};

export const modelAssetsPath = (projectId: string): string =>
  `/api/v1/projects/${encodeURIComponent(projectId)}/model-assets`;

export const modelAssetContentUrl = (projectId: string, assetId: string): string =>
  findBuiltinModel(assetId)?.contentPath
    ?? apiUrl(`${modelAssetsPath(projectId)}/${encodeURIComponent(assetId)}/content`);

export const modelAssetPath = (projectId: string, assetId: string): string =>
  `${modelAssetsPath(projectId)}/${encodeURIComponent(assetId)}`;

export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
