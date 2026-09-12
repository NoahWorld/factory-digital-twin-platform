import type { ModelInspection } from "./model-inspection";

export type ModelAsset = {
  id: string; projectId: string; originalFilename: string;
  format: "glb" | "gltf"; contentType: string; byteSize: number; sha256: string;
  inspection: ModelInspection; createdAt: string;
  familyId: string; versionNumber: number; previousVersionId: string | null;
};
