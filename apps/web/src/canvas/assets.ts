export type ProjectAsset = {
  id: string;
  projectId: string;
  assetId: string;
  modelNode: string | null;
  name: string;
  assetType: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ProjectAssetListResponse = {
  assets: ProjectAsset[];
  requestId: string;
};

export type ProjectAssetResponse = {
  asset: ProjectAsset;
  requestId: string;
};

export const projectAssetsPath = (projectId: string): string =>
  `/api/v1/projects/${encodeURIComponent(projectId)}/assets`;

export const projectAssetPath = (
  projectId: string,
  assetRecordId: string,
): string =>
  `${projectAssetsPath(projectId)}/${encodeURIComponent(assetRecordId)}`;
