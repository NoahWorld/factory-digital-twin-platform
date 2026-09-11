import { useEffect, useMemo, useState } from "react";
import { errorMessage, request } from "../api";
import { componentLabels, parseScene3DProps, type CanvasNode } from "./types";

type ProjectSummary = {
  id: string;
  name: string;
  projectType: "2d" | "3d";
};

type ProjectsResponse = {
  projects: ProjectSummary[];
  requestId: string;
};

export function Scene3DInspector({
  editable,
  node,
  onNodeChange,
  onValidationChange,
}: {
  editable: boolean;
  node: CanvasNode;
  onNodeChange: (node: CanvasNode) => void;
  onValidationChange: (message: string | null) => void;
}) {
  const parsed = parseScene3DProps(node.props);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const sceneProjects = useMemo(
    () => projects.filter((project) => project.projectType === "3d"),
    [projects],
  );
  const validationMessage = !parsed.ok
    ? parsed.message
    : loadError
      ? `3D 项目列表加载失败：${loadError}`
      : !parsed.value.sceneProjectId
        ? "请选择一个独立 3D 场景"
        : !loading && !sceneProjects.some((project) => project.id === parsed.value.sceneProjectId)
          ? "当前账号无法访问所选 3D 场景"
          : null;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    void request<ProjectsResponse>("/api/v1/projects")
      .then((result) => {
        if (active) setProjects(result.projects);
      })
      .catch((reason) => {
        if (active) setLoadError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    onValidationChange(validationMessage);
    return () => onValidationChange(null);
  }, [onValidationChange, validationMessage]);

  if (!parsed.ok) {
    return <aside className="component-inspector is-empty"><div className="inspector-invalid"><strong>3D 场景配置无效</strong><p>{parsed.message}</p></div></aside>;
  }

  return (
    <aside className="component-inspector">
      <header className="inspector-heading">
        <span className="eyebrow">COMPOSABLE 3D SCENE</span>
        <h2>{componentLabels[node.type]}</h2>
        <p>组件 ID：{node.id.slice(0, 8)}</p>
      </header>
      <section className="inspector-section">
        <div className="inspector-section-title"><strong>场景来源</strong><span>保存项目引用</span></div>
        <label>
          <span>独立 3D 项目</span>
          <select
            disabled={!editable || loading}
            onChange={(event) => onNodeChange({
              ...node,
              props: { ...parsed.value, sceneProjectId: event.target.value || null },
            })}
            value={parsed.value.sceneProjectId ?? ""}
          >
            <option value="">{loading ? "正在加载…" : "请选择 3D 场景"}</option>
            {sceneProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        {loadError ? <p className="inspector-inline-error" role="alert">{loadError}</p> : null}
        {!loading && !loadError && sceneProjects.length === 0 ? <p className="inspector-help">当前账号还没有可引用的独立 3D 项目。</p> : null}
        <p className="inspector-help">画布只保存项目 ID。模型、灯光、镜头和设备绑定继续由原 3D 场景统一维护。</p>
      </section>
      <section className="inspector-section">
        <div className="inspector-section-title"><strong>运行交互</strong><span>预览态</span></div>
        <label className="inspector-check-row">
          <input
            checked={parsed.value.interactionEnabled}
            disabled={!editable}
            onChange={(event) => onNodeChange({
              ...node,
              props: { ...parsed.value, interactionEnabled: event.target.checked },
            })}
            type="checkbox"
          />
          <span>允许旋转镜头并点击设备</span>
        </label>
        <p className="inspector-help">编辑画布时拖动整个组件；预览时模型点击会选中业务设备并更新“设备数据”组件。</p>
      </section>
    </aside>
  );
}
