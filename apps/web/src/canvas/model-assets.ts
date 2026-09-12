import { apiUrl } from "../api";

export type { ModelInspection } from "../../../../shared/model-inspection";
import type { ModelInspection } from "../../../../shared/model-inspection";

export type { ModelAsset } from "../../../../shared/model-assets";
import type { ModelAsset } from "../../../../shared/model-assets";

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
