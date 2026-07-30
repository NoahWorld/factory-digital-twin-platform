import { apiUrl } from "../api";

export type ImageAsset = {
  id: string;
  projectId: string;
  originalFilename: string;
  format: "png" | "jpeg" | "webp";
  contentType: string;
  byteSize: number;
  sha256: string;
  createdAt: string;
};

export const imageAssetsPath = (projectId: string): string =>
  `/api/v1/projects/${encodeURIComponent(projectId)}/image-assets`;

export const imageAssetContentUrl = (projectId: string, assetId: string): string =>
  apiUrl(`${imageAssetsPath(projectId)}/${encodeURIComponent(assetId)}/content`);
