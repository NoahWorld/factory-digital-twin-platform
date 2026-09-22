import { useEffect, useRef, useState } from "react";
import { STANDALONE_3D_LIMITS, standaloneScenePath, type StandaloneSceneDocument } from "../../../../shared/standalone-3d";
import { errorMessage, request } from "../api";
import { CanvasSurface } from "../canvas/CanvasSurface";
import { Model3DNode } from "../canvas/Model3DNode";
import { projectCanvasPath } from "../canvas/routes";
import { standaloneRendererNode } from "../canvas/standalone-renderer-node";
import type { CanvasDocument, CanvasNode, CanvasResponse } from "../canvas/types";
import { captureProjectContent } from "./capture";
import "./covers.css";

export type CoverProject = {
  id: string; name: string; projectType: "2d" | "3d";
  projectRole: "owner" | "editor" | "viewer" | null;
  coverUrl: string | null; coverStatus: "pending" | "ready";
  documentRevision: number; coverSourceRevision: number | null; coverRevision: number;
};
type CaptureDocument = { type: "2d"; canvas: CanvasDocument; revision: number }
  | { type: "3d"; fluids: import("../../../../shared/fluids").FluidDefinition[]; node: CanvasNode; revision: number };
const ignore = () => undefined;
const taskKey = (project: CoverProject) => `${project.id}:${project.documentRevision}:${project.coverRevision}`;

function CoverCapture({ project, onComplete, onError }: {
  project: CoverProject;
  onComplete: (project: CoverProject) => void;
  onError: (project: CoverProject, error: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState<CaptureDocument | null>(null);
  const callbacks = useRef({ onComplete, onError });
  callbacks.current = { onComplete, onError };
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => {
      if (active) {
        controller.abort(new Error("项目截图超时，请打开项目检查模型资源后重试。"));
        callbacks.current.onError(project, "项目截图超时，请打开项目检查模型资源后重试。");
      }
    }, 90_000);
    const fail = (reason: unknown) => {
      if (!active) return;
      clearTimeout(timer);
      console.error("Project cover capture failed.", { projectId: project.id, sourceRevision: project.documentRevision, reason });
      callbacks.current.onError(project, errorMessage(reason));
    };
    void (async () => {
      if (project.projectType === "3d") {
        const result = await request<{ scene: StandaloneSceneDocument }>(standaloneScenePath(project.id), { signal: controller.signal });
        if (active) setContent({ type: "3d", fluids: result.scene.fluids ?? [], node: standaloneRendererNode(result.scene), revision: result.scene.revision });
      } else {
        const result = await request<CanvasResponse>(projectCanvasPath(project.id), { signal: controller.signal });
        if (active) setContent({ type: "2d", canvas: result.canvas, revision: result.canvas.revision });
      }
    })().catch(fail);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [project.id, project.documentRevision, project.projectType]);

  useEffect(() => {
    if (!content || !host.current) return;
    const controller = new AbortController();
    let active = true;
    const element = host.current;
    const timer = setTimeout(() => controller.abort(new Error("项目截图处理超时。")), 85_000);
    void (async () => {
      const blob = await captureProjectContent(element, content.type, controller.signal);
      const result = await request<{ project: CoverProject }>(`/api/v1/projects/${encodeURIComponent(project.id)}/cover?sourceRevision=${content.revision}&expectedCoverRevision=${project.coverRevision}`, {
        method: "PUT", headers: { "content-type": "image/png" }, body: blob, signal: controller.signal,
      });
      if (active) callbacks.current.onComplete(result.project);
    })().catch((reason) => {
      if (!active) return;
      console.error("Project cover capture/upload failed.", { projectId: project.id, sourceRevision: content.revision, reason });
      callbacks.current.onError(project, errorMessage(reason));
    }).finally(() => clearTimeout(timer));
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [content, project.id, project.coverRevision]);

  return <div aria-hidden="true" inert className={`project-cover-capture is-${project.projectType}`}>
    <div className="project-cover-capture-content" ref={host}>
      {content?.type === "2d" ? <CanvasSurface document={content.canvas} editable={false} runtimeControlsEnabled={false}
        selectedNodeId={null} selectedModelSceneNodePath={null} onCreateNode={ignore}
        onModelSceneNodeSelect={ignore} onNodeChange={ignore} onSelectNode={ignore} /> : null}
      {content?.type === "3d" ? <Model3DNode node={content.node} fluids={content.fluids} projectId={project.id}
        editable={false} cameraControlsEnabled={false} runtimeControlsEnabled={false}
        maximumModelInstances={STANDALONE_3D_LIMITS.maximumInstances} selectionStyle="none"
        selectedSceneNodePath={null} onSceneNodeSelect={ignore} /> : null}
    </div>
  </div>;
}

/** One disposable renderer at a time; project cards remain ordinary cached images. */
export default function ProjectCoverQueue({ projects, isAdmin, onComplete }: {
  projects: CoverProject[]; isAdmin: boolean; onComplete: (project: CoverProject) => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const eligible = projects.filter((project) => project.coverStatus === "pending"
    && (isAdmin || project.projectRole === "owner" || project.projectRole === "editor"));
  const current = eligible.find((project) => !errors[taskKey(project)]);
  const failed = eligible.filter((project) => errors[taskKey(project)]);
  const retry = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      // Refresh both revisions before retrying: another editor may have saved the scene.
      const latest = await request<{ projects: CoverProject[] }>("/api/v1/projects");
      latest.projects.forEach(onComplete);
      setErrors({});
    } catch (reason) {
      console.error("Project cover retry refresh failed.", reason);
      setRetryError(errorMessage(reason));
    } finally { setRetrying(false); }
  };
  return <>
    {current ? <>
      <div className="project-cover-progress" role="status"><span className="model-loading-spinner" />
        正在生成项目实景封面：{current.name}<small>剩余 {eligible.length - failed.length} 个 · 不影响打开项目</small>
      </div>
      <CoverCapture key={taskKey(current)} project={current} onComplete={onComplete}
        onError={(project, error) => setErrors((previous) => ({ ...previous, [taskKey(project)]: error }))} />
    </> : null}
    {failed.length ? <div className="project-cover-errors" role="alert">
      <strong>{failed.length} 个项目封面未生成</strong>
      {failed.map((project) => <p key={project.id}>{project.name}：{errors[taskKey(project)]}</p>)}
      {retryError ? <p>{retryError}</p> : null}
      <button className="secondary-button compact-button" type="button" disabled={retrying} onClick={() => void retry()}>{retrying ? "正在读取最新项目…" : "重试封面截图"}</button>
    </div> : null}
  </>;
}
