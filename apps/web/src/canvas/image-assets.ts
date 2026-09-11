import { apiUrl } from "../api";
import type { ResourceUsage } from "./resource-usage";

export type ImageAsset = {
  id: string;
  projectId: string;
  originalFilename: string;
  format: "png" | "jpeg" | "webp";
  contentType: string;
  byteSize: number;
  sha256: string;
  source: "upload";
  usage: ResourceUsage;
  createdAt: string;
};

export type ImageAssetListResponse = {
  imageAssets: ImageAsset[];
  requestId: string;
};

export type ImageAssetUploadResponse = {
  imageAsset: ImageAsset;
  requestId: string;
};

export type ImageAssetDeletionResponse = {
  deletedImageAssetId: string;
  usage: ResourceUsage;
  warning: string | null;
  requestId: string;
};

export const imageAssetsPath = (projectId: string): string =>
  `/api/v1/projects/${encodeURIComponent(projectId)}/image-assets`;

export const imageAssetContentUrl = (projectId: string, assetId: string): string =>
  apiUrl(`${imageAssetsPath(projectId)}/${encodeURIComponent(assetId)}/content`);

export const imageAssetPath = (projectId: string, assetId: string): string =>
  `${imageAssetsPath(projectId)}/${encodeURIComponent(assetId)}`;
