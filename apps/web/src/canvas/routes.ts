import type { CanvasTemplateId } from "./templates";

export const projectCanvasPath = (projectId: string, pageId?: string): string =>
  `/api/v1/projects/${encodeURIComponent(projectId)}/canvas${pageId ? `?page=${encodeURIComponent(pageId)}` : ""}`;

export const canvasRoutePath = (
  projectId: string,
  suffix: "canvas" | "preview",
  pageId?: string,
): string =>
  `#/projects/${encodeURIComponent(projectId)}/${suffix}${pageId ? `?page=${encodeURIComponent(pageId)}` : ""}`;

export const projectTemplateCanvasPath = (
  projectId: string,
  templateId: CanvasTemplateId,
): string =>
  `${canvasRoutePath(projectId, "canvas")}?template=${encodeURIComponent(templateId)}`;

export const modelEditorRoutePath = (
  projectId: string,
  nodeId: string,
  pageId?: string,
): string =>
  `#/projects/${encodeURIComponent(projectId)}/3d-editor/${encodeURIComponent(nodeId)}${pageId ? `?page=${encodeURIComponent(pageId)}` : ""}`;
