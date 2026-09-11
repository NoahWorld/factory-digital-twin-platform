import { apiUrl } from "../api";
import type { ResourceUsage } from "./resource-usage";

export type MediaAsset = {
  id: string;
  projectId: string;
  originalFilename: string;
  mediaType: "video" | "audio";
  format: "mp4" | "webm" | "mp3" | "wav" | "ogg" | "m4a" | "aac";
  contentType: string;
  byteSize: number;
  sha256: string;
  source: "upload";
  usage: ResourceUsage;
  createdAt: string;
};

export type MediaAssetListResponse = {
  mediaAssets: MediaAsset[];
  requestId: string;
};

export type MediaAssetUploadResponse = {
  mediaAsset: MediaAsset;
  requestId: string;
};

export type MediaAssetDeletionResponse = {
  deletedMediaAssetId: string;
  usage: ResourceUsage;
  warning: string | null;
  requestId: string;
};

export const mediaAssetsPath = (projectId: string): string =>
  `/api/v1/projects/${encodeURIComponent(projectId)}/media-assets`;

export const mediaAssetPath = (projectId: string, assetId: string): string =>
  `${mediaAssetsPath(projectId)}/${encodeURIComponent(assetId)}`;

export const mediaAssetContentUrl = (projectId: string, assetId: string): string =>
  apiUrl(`${mediaAssetPath(projectId, assetId)}/content`);
