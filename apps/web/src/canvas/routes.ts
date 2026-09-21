import type { CanvasTemplateId } from "./templates";
import { standaloneSceneRoutePath } from "../../../../shared/standalone-3d";
import type { SceneTemplateId } from "../scene/scene-templates";

export const projectCanvasPath = (projectId: string): string =>
  `/api/v1/projects/${encodeURIComponent(projectId)}/canvas`;

export const canvasRoutePath = (
  projectId: string,
  suffix: "canvas" | "preview",
): string =>
  `#/projects/${encodeURIComponent(projectId)}/${suffix}`;

export const projectTemplateCanvasPath = (
  projectId: string,
  templateId: CanvasTemplateId,
): string =>
  `${canvasRoutePath(projectId, "canvas")}?template=${encodeURIComponent(templateId)}`;

export const projectTemplateScenePath = (projectId: string, templateId: SceneTemplateId): string =>
  `${standaloneSceneRoutePath(projectId, "edit")}?template=${encodeURIComponent(templateId)}`;

export const modelEditorRoutePath = (
  projectId: string,
  nodeId: string,
): string =>
  `#/projects/${encodeURIComponent(projectId)}/3d-editor/${encodeURIComponent(nodeId)}`;
