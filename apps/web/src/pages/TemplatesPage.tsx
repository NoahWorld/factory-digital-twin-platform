import { useEffect, useMemo, useState } from "react";
import { CanvasTemplateGallery } from "../canvas/CanvasTemplateGallery";
import { projectTemplateCanvasPath } from "../canvas/routes";
import type { CanvasTemplateId } from "../canvas/templates";

export type TemplateTargetProject = {
  id: string;
  name: string;
  projectRole: "owner" | "editor" | "viewer" | null;
};

type TemplatesPageProps = {
  loadingProjects: boolean;
  projectError: string | null;
  projects: TemplateTargetProject[];
};

export function TemplatesPage({
  loadingProjects,
  projectError,
  projects,
}: TemplatesPageProps) {
  const editableProjects = useMemo(
    () => projects.filter((project) => project.projectRole === "owner" || project.projectRole === "editor"),
    [projects],
  );
  const [selectedProjectId, setSelectedProjectId] = useState("");

  useEffect(() => {
    if (editableProjects.some((project) => project.id === selectedProjectId)) return;
    setSelectedProjectId(editableProjects[0]?.id ?? "");
  }, [editableProjects, selectedProjectId]);

  const useTemplate = (templateId: CanvasTemplateId) => {
    if (!selectedProjectId) return;
    window.location.hash = projectTemplateCanvasPath(selectedProjectId, templateId).slice(1);
  };

  return (
    <section className="workspace-content templates-content" id="templates">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Dashboard templates</p>
          <h1>大屏模板</h1>
          <p>选择行业大屏骨架，在已有项目画布中预览、调整并保存。</p>
        </div>
      </div>

      <div className="template-page-toolbar">
        <div>
          <strong>选择目标项目</strong>
          <span>模板会替换目标项目的本地画布布局，但不会自动保存。</span>
        </div>
        <label>
          <span>目标项目</span>
          <select
            aria-label="目标项目"
            disabled={loadingProjects || editableProjects.length === 0}
            onChange={(event) => setSelectedProjectId(event.target.value)}
            value={selectedProjectId}
          >
            {loadingProjects ? <option value="">正在加载项目…</option> : null}
            {!loadingProjects && editableProjects.length === 0 ? <option value="">没有可编辑项目</option> : null}
            {editableProjects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </label>
      </div>

      {projectError ? (
        <section className="state-card error-state template-project-error" role="alert">
          <h2>项目列表加载失败</h2>
          <p>{projectError}</p>
        </section>
      ) : null}

      <div className="template-dialog-notice template-page-notice">
        <strong>模板数据均为示例</strong>
        <span>进入画布后可编辑所有组件；确认效果后再点击“保存画布”。装备保障模板会复用项目中首个 3D 模型资源。</span>
      </div>

      <CanvasTemplateGallery
        actionLabel="在画布中使用"
        className="template-page-gallery"
        editable={Boolean(selectedProjectId) && !projectError}
        onApply={useTemplate}
      />
    </section>
  );
}
