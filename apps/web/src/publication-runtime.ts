import { createContext, useContext } from "react";
import { apiUrl } from "./api";
import type { CanvasDocument } from "./canvas/types";
import type { ProjectAsset } from "./canvas/assets";
import type { StandaloneSceneDocument } from "../../../shared/standalone-3d";

export const publicationsPath = (projectId: string): string =>
  `/api/v1/projects/${encodeURIComponent(projectId)}/publications`;

export const publicationRunRoute = (projectId: string, versionId?: string): string =>
  `#/projects/${encodeURIComponent(projectId)}/publications/${versionId ? `${encodeURIComponent(versionId)}/` : ""}run`;

const currentPublication = (): { rootProjectId: string; versionId: string } | null => {
  const match = window.location.hash.match(/^#\/projects\/([^/]+)\/publications\/([^/]+)\/run$/);
  return match ? { rootProjectId: decodeURIComponent(match[1]), versionId: decodeURIComponent(match[2]) } : null;
};

export const publicationResourceUrl = (resourceId: string): string | null => {
  const current = currentPublication();
  return current ? apiUrl(`${publicationsPath(current.rootProjectId)}/${encodeURIComponent(current.versionId)}/resources/${encodeURIComponent(resourceId)}/content`) : null;
};

export type SnapshotProject = {
  project: { id: string; name: string; projectType: "2d" | "3d" };
  document: CanvasDocument | StandaloneSceneDocument;
  assets: ProjectAsset[];
};

export type PublicationSnapshot = {
  schemaVersion: number;
  rootProjectId: string;
  projects: Record<string, SnapshotProject>;
  resources: Array<{ id: string; projectId: string; kind: string; byteSize: number; sha256: string }>;
};

export const PublicationContext = createContext<PublicationSnapshot | null>(null);
export const usePublicationSnapshot = (): PublicationSnapshot | null => useContext(PublicationContext);
