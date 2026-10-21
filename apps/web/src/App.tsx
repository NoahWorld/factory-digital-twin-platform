import { loadIotProjects } from "./iot/projects";
import { FormEvent, lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { standaloneSceneRoutePath, type ProjectType } from "../../../shared/standalone-3d";
import { apiUrl, ApiRequestError, errorMessage, request } from "./api";
import { useNotifications } from "./components/NotificationProvider";
import { reportError } from "./api";
import { canvasRoutePath, projectListRoutePath, projectTemplateCanvasPath, projectTemplateScenePath } from "./canvas/routes";
import { getSceneTemplate, isSceneTemplateId, type SceneTemplateId, type ProjectTemplate } from "./scene/scene-templates";
import {
  getCanvasTemplate,
  isCanvasTemplateId,
  type CanvasTemplateId,
} from "./canvas/templates";
import { CanvasPage } from "./pages/CanvasPage";
import { ResourcesPage } from "./pages/ResourcesPage";
import { PublicationRunPage } from "./publications";
import { TemplatesPage } from "./pages/TemplatesPage";
import { PRODUCT_NAME } from "./product-config";
import { ProductLogo } from "./components/ProductLogo";
import { ThemeToggle } from "./theme/ThemeToggle";
import type { CoverProject } from "./covers/ProjectCoverQueue";

import { IOT_HOME_PATH, IOT_LOGIN_PATH } from "./iot/config";
import { loadIotIdentity, type IotUser } from "./iot/identity";
import { IOT_SESSION_EVENT, IOT_TOKEN_KEY, readIotToken } from "./iot/session";
import { ResourceImage } from "./iot/ResourceMedia";

const ProjectCoverQueue = lazy(() => import("./covers/ProjectCoverQueue"));

const Model3DEditorPage = lazy(() => import("./pages/Model3DEditorPage"));
const Standalone3DProjectPage = lazy(() => import("./pages/Standalone3DProjectPage"));

type Project = CoverProject & {
  id: string;
  name: string;
  status: "draft" | "published" | "archived";
  createdAt: string;
  updatedAt: string;
  projectRole: "owner" | "editor" | "viewer" | null;
  coverUrl: string | null;
  projectType: ProjectType;
};


type ProjectResponse = {
  project: Project;
  requestId: string;
};

type DeleteProjectResponse = {
  deletedProjectId: string;
  deletedImageObjectCount: number;
  deletedMediaObjectCount: number;
  deletedModelObjectCount: number;
  warning: string | null;
  requestId: string;
};

const projectStatusText: Record<Project["status"], string> = {
  draft: "草稿",
  published: "已发布",
  archived: "已归档",
};

const projectRoleText: Record<NonNullable<Project["projectRole"]>, string> = {
  owner: "项目负责人",
  editor: "可编辑",
  viewer: "只读",
};

const formatDate = (value: string): string =>
  new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    hour12: false,
  }).format(new Date(value));

type FormNoticeProps = {
  error: string | null;
};

function FormNotice({ error }: FormNoticeProps) {
  return error ? <p className="form-error">{error}</p> : null;
}

type ActionIconProps = {
  name: "add" | "delete" | "edit" | "share" | "view";
};

function ActionIcon({ name }: ActionIconProps) {
  if (name === "add") {
    return (
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  }

  if (name === "edit") {
    return (
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <path d="m4 20 4.4-1 10-10a2.4 2.4 0 0 0-3.4-3.4l-10 10L4 20Z" />
        <path d="m13.8 6.8 3.4 3.4" />
      </svg>
    );
  }

  if (name === "delete") {
    return (
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" />
      </svg>
    );
  }

  if (name === "share") {
    return (
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <path d="M9 12h6m-4-4 2-2a4 4 0 0 1 5.7 5.7l-2 2M13 16l-2 2a4 4 0 0 1-5.7-5.7l2-2" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

type CreateProjectDialogProps = {
  allowedModules: ProjectType[];
  initialProjectType: ProjectType;
  onClose: () => void;
  onCreated: (project: Project, template: ProjectTemplate | null) => void;
  templateId: ProjectTemplate | null;
};

function CreateProjectDialog({
  allowedModules,
  initialProjectType,
  onClose,
  onCreated,
  templateId,
}: CreateProjectDialogProps) {
  const template = templateId ? templateId.projectType === "2d" ? getCanvasTemplate(templateId.id) : getSceneTemplate(templateId.id) : null;
  const [name, setName] = useState(() => template ? `${template.name}项目` : "");
  const [projectType, setProjectType] = useState<ProjectType>(initialProjectType);
  const notify = useNotifications();
  const [submitting, setSubmitting] = useState(false);
  const [creationError, setCreationError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setCreationError(null);

    try {
      const result = await request<ProjectResponse>("/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({ name, projectType: templateId?.projectType ?? projectType }),
      });
      notify.success("项目已创建。");
      onCreated(result.project, templateId);
    } catch (reason) {
      setCreationError(errorMessage(reason));
      notify.error(reason);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div aria-modal="true" className="dialog-backdrop" role="dialog">
      <form className="dialog-card" onSubmit={submit}>
        <button aria-label="关闭" className="dialog-close" disabled={submitting} onClick={onClose} type="button">
          ×
        </button>
        <h2>{template ? "使用模板创建项目" : "创建空白项目"}</h2>
        <p>
          {template
            ? `将创建一个新 ${templateId?.projectType === "3d" ? "3D 场景" : "2D 看板"}项目，并载入“${template.name}”模板。确认效果后请显式保存，封面会根据已保存内容生成。`
            : "新项目默认处于草稿状态，创建人自动成为项目负责人。"}
        </p>
        {!template ? (
          <fieldset className="project-type-picker">
            <legend>项目类型</legend>
            {allowedModules.includes("2d") ? <label className={projectType === "2d" ? "is-selected" : ""}>
              <input checked={projectType === "2d"} disabled={submitting} name="projectType" onChange={() => setProjectType("2d")} type="radio" />
              <strong>2D 看板</strong>
              <span>沿用现有画布，可组合 2D 组件与单个 3D 组件。</span>
            </label> : null}
            {allowedModules.includes("3d") ? <label className={projectType === "3d" ? "is-selected" : ""}>
              <input checked={projectType === "3d"} disabled={submitting} name="projectType" onChange={() => setProjectType("3d")} type="radio" />
              <strong>3D 场景</strong>
              <span>独立三维空间，支持多模型搭建、漫游与业务资产联动。</span>
            </label> : null}
          </fieldset>
        ) : null}
        <label>
          <span>项目名称</span>
          <input
            autoFocus
            disabled={submitting}
            maxLength={100}
            minLength={2}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：苏州二厂数字孪生"
            required
            value={name}
          />
        </label>
        {creationError ? <p className="error-message" role="alert">{creationError}</p> : null}
        {submitting ? <p role="status">正在创建项目…</p> : null}
        <div className="dialog-actions">
          <button className="secondary-button" disabled={submitting} onClick={onClose} type="button">
            取消
          </button>
          <button className="primary-button" disabled={submitting} type="submit">
            {submitting ? "正在创建…" : template ? "创建并进入编辑器" : "创建草稿项目"}
          </button>
        </div>
      </form>
    </div>
  );
}

type RenameProjectDialogProps = {
  onClose: () => void;
  onRenamed: (project: Project) => void;
  project: Project;
};

function RenameProjectDialog({
  onClose,
  onRenamed,
  project,
}: RenameProjectDialogProps) {
  const [name, setName] = useState(project.name);
  const notify = useNotifications();
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);

    try {
      const result = await request<ProjectResponse>(
        `/api/v1/projects/${encodeURIComponent(project.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ name }),
        },
      );
      onRenamed(result.project);
    } catch (reason) {
      notify.error(reason);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div aria-modal="true" className="dialog-backdrop" role="dialog">
      <form className="dialog-card" onSubmit={submit}>
        <button aria-label="关闭" className="dialog-close" disabled={submitting} onClick={onClose} type="button">×</button>
        <p className="eyebrow">Rename project</p>
        <h2>修改项目名称</h2>
        <p>名称修改后会立即同步到项目列表和画布标题。</p>
        <label>
          <span>项目名称</span>
          <input
            autoFocus
            disabled={submitting}
            maxLength={100}
            minLength={2}
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
        </label>
        <div className="dialog-actions">
          <button className="secondary-button" disabled={submitting} onClick={onClose} type="button">取消</button>
          <button className="primary-button" disabled={submitting || name.trim() === project.name} type="submit">
            {submitting ? "正在保存…" : "保存名称"}
          </button>
        </div>
      </form>
    </div>
  );
}

type DeleteProjectDialogProps = {
  onClose: () => void;
  onDeleted: (projectId: string, warning: string | null) => void;
  project: Project;
};

function DeleteProjectDialog({
  onClose,
  onDeleted,
  project,
}: DeleteProjectDialogProps) {
  const notify = useNotifications();
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);

    try {
      const result = await request<DeleteProjectResponse>(
        `/api/v1/projects/${encodeURIComponent(project.id)}`,
        { method: "DELETE" },
      );
      onDeleted(result.deletedProjectId, result.warning);
    } catch (reason) {
      notify.error(reason);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div aria-modal="true" className="dialog-backdrop" role="dialog">
      <form className="dialog-card delete-project-dialog" onSubmit={submit}>
        <button aria-label="关闭" className="dialog-close" disabled={submitting} onClick={onClose} type="button">×</button>
        <p className="eyebrow">Delete project</p>
        <h2>删除“{project.name}”？</h2>
        <p>项目场景、模型元数据、资产和数据源都会被永久删除，此操作不可撤销。</p>
        <div className="dialog-actions">
          <button className="secondary-button" disabled={submitting} onClick={onClose} type="button">取消</button>
          <button className="danger-button" disabled={submitting} type="submit">
            {submitting ? "正在删除…" : "永久删除项目"}
          </button>
        </div>
      </form>
    </div>
  );
}

function AccessDenied({ module }: { module: string }) {
  return <main className="canvas-page-state error-state">
    <p className="eyebrow">Access denied</p>
    <h1>没有{module}访问权限</h1>
    <p>请联系 IoT 管理员为账号分配相应模块权限。</p>
    <a className="secondary-button" href="#/projects">返回项目</a>
  </main>;
}

type WorkspaceRoute =
  | { kind: "projects"; projectType?: ProjectType }
  | { kind: "templates" }
  | { kind: "resources"; tool?: "scene-foundation" }
  | { kind: "publication-run"; projectId: string; versionId?: string }
  | { kind: "canvas"; projectId: string; mode: "edit" | "preview"; templateId?: CanvasTemplateId; initialAssetId?: string }
  | { kind: "standalone-scene"; projectId: string; mode: "edit" | "preview"; templateId?: SceneTemplateId }
  | { kind: "model-editor"; projectId: string; nodeId: string }
  | { kind: "invalid"; message: string };

const currentWorkspaceRoute = (): WorkspaceRoute => {
  const projectListMatch = window.location.hash.match(/^#\/projects(?:\?([^#]*))?$/);
  if (projectListMatch) {
    const projectType = new URLSearchParams(projectListMatch[1] ?? "").get("type");
    if (projectType !== null && projectType !== "2d" && projectType !== "3d") {
      return { kind: "invalid", message: "项目类型无效，请选择 2D 看板或 3D 场景。" };
    }
    return { kind: "projects", projectType: projectType ?? undefined };
  }
  if (window.location.hash === "#/templates") {
    return { kind: "templates" };
  }
  const resourcesMatch = window.location.hash.match(/^#\/resources(?:\?([^#]*))?$/);
  if (resourcesMatch) {
    const tool = new URLSearchParams(resourcesMatch[1] ?? "").get("tool");
    if (tool !== null && tool !== "scene-foundation") {
      return { kind: "invalid", message: "资源库功能地址无效，请从主导航重新进入。" };
    }
    return { kind: "resources", tool: tool ?? undefined };
  }
  const publicationMatch = window.location.hash.match(/^#\/projects\/([^/]+)\/publications\/(?:([^/]+)\/)?run$/);
  if (publicationMatch) {
    return { kind: "publication-run", projectId: decodeURIComponent(publicationMatch[1]),
      versionId: publicationMatch[2] ? decodeURIComponent(publicationMatch[2]) : undefined };
  }
  if (window.location.hash === "#/users" || window.location.hash.startsWith("#/share/")) {
    return { kind: "invalid", message: "此入口已停用，请从 IoT 进入数字孪生项目。" };
  }
  const standaloneSceneMatch = window.location.hash.match(/^#\/projects\/([^/]+)\/(scene|scene-preview)(?:\?([^#]*))?$/);
  if (standaloneSceneMatch) {
    const templateValue = new URLSearchParams(standaloneSceneMatch[3] ?? "").get("template");
    if (templateValue && !isSceneTemplateId(templateValue)) return { kind: "invalid", message: `未知的 3D 场景模板：${templateValue}` };
    if (templateValue && standaloneSceneMatch[2] === "scene-preview") return { kind: "invalid", message: "预览模式不能套用场景模板。" };
    return {
      kind: "standalone-scene",
      projectId: decodeURIComponent(standaloneSceneMatch[1]),
      mode: standaloneSceneMatch[2] === "scene-preview" ? "preview" : "edit",
      templateId: templateValue && isSceneTemplateId(templateValue) ? templateValue : undefined,
    };
  }
  const modelEditorMatch = window.location.hash.match(/^#\/projects\/([^/]+)\/3d-editor\/([^/]+)$/);
  if (modelEditorMatch) {
    return {
      kind: "model-editor",
      projectId: decodeURIComponent(modelEditorMatch[1]),
      nodeId: decodeURIComponent(modelEditorMatch[2]),
    };
  }
  const canvasMatch = window.location.hash.match(/^#\/projects\/([^/]+)\/(canvas|preview)(?:\?([^#]*))?$/);
  if (!canvasMatch) return { kind: "projects" };
  const query = new URLSearchParams(canvasMatch[3] ?? "");
  const templateValue = query.get("template") ?? undefined;
  let templateId: CanvasTemplateId | undefined;
  if (templateValue) {
    if (!isCanvasTemplateId(templateValue)) {
      return { kind: "invalid", message: `未知的大屏模板：${templateValue}` };
    }
    templateId = templateValue;
  }
  return {
    kind: "canvas",
    projectId: decodeURIComponent(canvasMatch[1]),
    mode: canvasMatch[2] === "preview" ? "preview" : "edit",
    templateId,
    initialAssetId: query.get("asset") ?? undefined,
  };
};

const routeProjectType = (route: WorkspaceRoute): ProjectType | undefined =>
  route.kind === "projects" ? route.projectType
    : route.kind === "standalone-scene" ? "3d"
      : route.kind === "canvas" || route.kind === "model-editor" ? "2d" : undefined;

function Workspace({ user }: { user: IotUser }) {
  const notify = useNotifications();
  const [route, setRoute] = useState<WorkspaceRoute>(currentWorkspaceRoute);
  const [projects, setProjects] = useState<Project[]>([]);
  const [preferredProjectType, setPreferredProjectType] = useState<ProjectType>(() =>
    routeProjectType(route) ?? "3d");
  const projectTypeFilter = route.kind === "projects" ? route.projectType ?? preferredProjectType : preferredProjectType;
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [createProjectTemplateId, setCreateProjectTemplateId] = useState<ProjectTemplate | null>(null);
  const [renamingProject, setRenamingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);

  useEffect(() => {
    const updateRoute = () => setRoute(currentWorkspaceRoute());
    window.addEventListener("hashchange", updateRoute);
    return () => window.removeEventListener("hashchange", updateRoute);
  }, []);

  useEffect(() => {
    const projectType = routeProjectType(route);
    if (projectType && user.modules.includes(projectType)) setPreferredProjectType(projectType);
  }, [route, user.modules]);

  useEffect(() => {
    if (!user.modules.length || (route.kind !== "projects" && route.kind !== "resources")) return;
    if (route.kind === "resources" && !user.capabilities.canAccessResources) return;
    let active = true;
    let inFlight = false;
    const controller = new AbortController();
    const loadProjects = (initial = false) => {
      if (!active || inFlight) return;
      inFlight = true;
      if (initial) setLoadingProjects(true);
      setProjectError(null);
      void loadIotProjects<Project>(controller.signal)
      .then((result) => {
        if (active) {
          setProjects(result.projects);
        }
      })
      .catch((reason) => {
        if (active) {
          setProjectError(errorMessage(reason));
        }
      })
      .finally(() => {
        inFlight = false;
        if (active) {
          setLoadingProjects(false);
        }
      });
    };
    const refreshVisibleProjects = () => {
      if (document.visibilityState === "visible") loadProjects();
    };
    loadProjects(true);
    window.addEventListener("focus", refreshVisibleProjects);
    document.addEventListener("visibilitychange", refreshVisibleProjects);

    return () => {
      active = false;
      controller.abort();
      window.removeEventListener("focus", refreshVisibleProjects);
      document.removeEventListener("visibilitychange", refreshVisibleProjects);
    };
  }, [route.kind, user]);

  const createProject = (project: Project, templateId: ProjectTemplate | null) => {
    setProjects((current) => [project, ...current]);
    setPreferredProjectType(project.projectType);
    setShowCreateProject(false);
    setCreateProjectTemplateId(null);
    if (templateId) {
      window.location.hash = (templateId.projectType === "2d" ? projectTemplateCanvasPath(project.id, templateId.id) : projectTemplateScenePath(project.id, templateId.id)).slice(1);
    } else if (project.projectType === "3d") {
      window.location.hash = standaloneSceneRoutePath(project.id, "edit").slice(1);
    } else {
      window.location.hash = projectListRoutePath(project.projectType).slice(1);
    }
  };

  const openBlankProjectDialog = () => {
    setCreateProjectTemplateId(null);
    setShowCreateProject(true);
  };

  const openTemplateProjectDialog = (templateId: ProjectTemplate) => {
    if (!user.capabilities.canCreateProject || !user.modules.includes(templateId.projectType)) return;
    setCreateProjectTemplateId(templateId);
    setShowCreateProject(true);
  };

  const renamedProject = (project: Project) => {
    setProjects((current) => [
      project,
      ...current.filter((candidate) => candidate.id !== project.id),
    ]);
    setRenamingProject(null);
    notify.success("项目名称已保存。");
  };

  const deletedProject = (projectId: string, warning: string | null) => {
    setProjects((current) => current.filter((project) => project.id !== projectId));
    setDeletingProject(null);
    if (warning) {
      reportError(new ApiRequestError("storage_cleanup_pending", undefined, warning));
      notify.warning("项目已删除，部分文件清理未完成，请联系管理员。");
    } else notify.success("项目已永久删除。");
  };

  const projectCounts = {
    "2d": projects.filter((project) => project.projectType === "2d").length,
    "3d": projects.filter((project) => project.projectType === "3d").length,
  } satisfies Record<ProjectType, number>;
  const visibleProjects = projects.filter(
    (project) => project.projectType === projectTypeFilter,
  );
  const switchProjectType = (projectType: ProjectType) => {
    setPreferredProjectType(projectType);
    window.location.hash = projectListRoutePath(projectType).slice(1);
  };
  const switchProjectTypeWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    const nextType = event.key === "ArrowLeft" || event.key === "Home"
      ? "2d"
      : event.key === "ArrowRight" || event.key === "End"
        ? "3d"
        : null;
    if (!nextType || !user.modules.includes(nextType)) return;
    event.preventDefault();
    switchProjectType(nextType);
    document.getElementById(`project-type-tab-${nextType}`)?.focus();
  };

  if (route.kind === "projects" && route.projectType && !user.modules.includes(route.projectType)) {
    return <AccessDenied module={route.projectType === "3d" ? "3D 场景" : "2D 看板"} />;
  }

  if (route.kind === "canvas") {
    if (!user.modules.includes("2d")) return <AccessDenied module="2D 看板" />;
    return (
      <CanvasPage
        initialAssetId={route.initialAssetId}
        initialTemplateId={route.templateId}
        key={`${route.projectId}:${route.mode}:${route.templateId ?? "saved"}:${route.initialAssetId ?? "no-asset"}`}
        mode={route.mode}
        projectId={route.projectId}
      />
    );
  }

  if (route.kind === "publication-run") {
    if (!user.modules.length) return <AccessDenied module="项目发布版本" />;
    return <PublicationRunPage key={`${route.projectId}:${route.versionId ?? "active"}`}
      projectId={route.projectId} versionId={route.versionId} />;
  }

  if (route.kind === "standalone-scene") {
    if (!user.modules.includes("3d")) return <AccessDenied module="3D 场景" />;
    return (
      <Suspense fallback={<main className="canvas-page-state"><p className="eyebrow">3D workspace</p><h1>正在准备独立 3D 编辑器…</h1></main>}>
        <Standalone3DProjectPage initialTemplateId={route.templateId} key={`${route.projectId}:${route.mode}:${route.templateId ?? "saved"}`} mode={route.mode} projectId={route.projectId} />
      </Suspense>
    );
  }

  if (route.kind === "model-editor") {
    if (!user.modules.includes("2d")) return <AccessDenied module="2D 看板" />;
    return (
      <Suspense fallback={<main className="canvas-page-state"><p className="eyebrow">3D editor</p><h1>正在准备 3D 编辑器…</h1></main>}>
        <Model3DEditorPage nodeId={route.nodeId} projectId={route.projectId} />
      </Suspense>
    );
  }

  if (route.kind === "invalid") {
    return (
      <main className="canvas-page-state error-state">
        <p className="eyebrow">Route error</p>
        <h1>页面地址无效</h1>
        <p>{route.message}</p>
        <a className="secondary-button" href="#/templates">返回模板中心</a>
      </main>
    );
  }


  return (
    <main className="workspace-shell">
      <header className="topbar">
        <div className="topbar-main">
          <a aria-label="返回 IoT" className="brand" href={IOT_HOME_PATH} target="_top">
            <ProductLogo />
            <span className="brand-name"><strong>{PRODUCT_NAME}</strong><small>交付工作台</small></span>
          </a>
          <nav aria-label="主导航" className="topbar-nav">
            <a aria-current={route.kind === "projects" ? "page" : undefined} href={projectListRoutePath(preferredProjectType)}>项目</a>
            {user.modules.length > 0 ? <a aria-current={route.kind === "templates" ? "page" : undefined} href="#/templates">模板</a> : null}
            {user.capabilities.canAccessResources ? <a aria-current={route.kind === "resources" ? "page" : undefined} href="#/resources">静态资源</a> : null}
          </nav>
        </div>
        <div className="user-menu">
          <ThemeToggle />
          <span className="iot-identity">{user.displayName} · IoT 账号</span>
          <a className="secondary-button compact-button" href={IOT_HOME_PATH} target="_top">返回 IoT</a>
        </div>
      </header>

      {route.kind === "templates" && user.modules.length === 0 ? (
        <AccessDenied module="项目模板" />
      ) : route.kind === "resources" && !user.capabilities.canAccessResources ? (
        <AccessDenied module="资源库" />
      ) : route.kind === "templates" ? (
        <TemplatesPage
          canCreateProject={user.capabilities.canCreateProject}
          allowedModules={user.modules}
          onCreateFromTemplate={openTemplateProjectDialog}
        />
      ) : route.kind === "resources" ? (
        <ResourcesPage
          loadingProjects={loadingProjects}
          projectError={projectError}
          projects={projects}
          openSceneFoundation={route.tool === "scene-foundation"}
          onCloseSceneFoundation={() => {
            const currentRoute = currentWorkspaceRoute();
            if (currentRoute.kind === "resources" && currentRoute.tool === "scene-foundation") {
              window.history.replaceState(null, "", "#/resources");
              setRoute({ kind: "resources" });
            }
          }}
        />
      ) : (
      <section aria-label="项目" className="workspace-content" id="projects">
        <div className="project-type-tabs-shell">
          <div aria-label="项目类型" className="project-type-tabs" role="tablist">
            {user.modules.includes("2d") ? <button
              aria-controls="project-list-panel"
              aria-selected={projectTypeFilter === "2d"}
              className={projectTypeFilter === "2d" ? "is-active" : ""}
              id="project-type-tab-2d"
              onKeyDown={switchProjectTypeWithKeyboard}
              onClick={() => switchProjectType("2d")}
              role="tab"
              tabIndex={projectTypeFilter === "2d" ? 0 : -1}
              type="button"
            >
              <span>2D 看板</span>
              <small>{projectCounts["2d"]}</small>
            </button> : null}
            {user.modules.includes("3d") ? <button
              aria-controls="project-list-panel"
              aria-selected={projectTypeFilter === "3d"}
              className={projectTypeFilter === "3d" ? "is-active" : ""}
              id="project-type-tab-3d"
              onKeyDown={switchProjectTypeWithKeyboard}
              onClick={() => switchProjectType("3d")}
              role="tab"
              tabIndex={projectTypeFilter === "3d" ? 0 : -1}
              type="button"
            >
              <span>3D 场景</span>
              <small>{projectCounts["3d"]}</small>
            </button> : null}
          </div>
          {user.capabilities.canCreateProject ? (
            <button
              aria-label="新建项目"
              className="primary-button icon-button project-create-button"
              onClick={openBlankProjectDialog}
              title="新建项目"
              type="button"
            >
              <ActionIcon name="add" />
            </button>
          ) : null}
        </div>



        {!loadingProjects && !projectError ? <Suspense fallback={null}>
          <ProjectCoverQueue projects={projects}
            onComplete={(updated) => setProjects((current) => current.map((project) => project.id === updated.id ? { ...project, ...updated } : project))} />
        </Suspense> : null}

        {projectError ? (
          <section
            aria-labelledby={`project-type-tab-${projectTypeFilter}`}
            className="state-card error-state"
            id="project-list-panel"
            role="tabpanel"
          >
            <h2>项目列表加载失败</h2>
            <p>{projectError}</p>
          </section>
        ) : null}

        {loadingProjects ? (
          <section
            aria-labelledby={`project-type-tab-${projectTypeFilter}`}
            className="state-card"
            id="project-list-panel"
            role="tabpanel"
          >
            <p className="eyebrow">Loading</p>
            <h2>正在加载项目…</h2>
          </section>
        ) : null}

        {!loadingProjects && !projectError && projects.length === 0 ? (
          <section
            aria-labelledby={`project-type-tab-${projectTypeFilter}`}
            className="empty-projects"
            id="project-list-panel"
            role="tabpanel"
          >
            <div className="empty-icon">◇</div>
            <h2>还没有项目</h2>
            <p>从一个客户工厂开始，后续将为它配置模型、资产、数据和运行看板。</p>
            {user.capabilities.canCreateProject ? (
              <button
                aria-label="创建第一个项目"
                className="primary-button icon-button"
                onClick={openBlankProjectDialog}
                title="创建第一个项目"
                type="button"
              >
                <ActionIcon name="add" />
              </button>
            ) : (
              <p className="permission-note">当前账号不能创建项目，请联系 IoT 管理员分配角色或模块权限。</p>
            )}
          </section>
        ) : null}

        {!loadingProjects && !projectError && projects.length > 0 && visibleProjects.length === 0 ? (
          <section
            aria-labelledby={`project-type-tab-${projectTypeFilter}`}
            className="empty-projects empty-projects-filtered"
            id="project-list-panel"
            role="tabpanel"
          >
            <div className={`empty-icon is-${projectTypeFilter}`}>{projectTypeFilter.toUpperCase()}</div>
            <h2>还没有{projectTypeFilter === "2d" ? " 2D 看板" : " 3D 场景"}</h2>
            <p>
              {projectTypeFilter === "2d"
                ? "创建看板项目，用画布组织指标、设备状态和三维联动组件。"
                : "创建场景项目，用真实模型搭建独立三维空间与设备联动。"}
            </p>
          </section>
        ) : null}

        {!loadingProjects && !projectError && visibleProjects.length > 0 ? (
          <section
            aria-labelledby={`project-type-tab-${projectTypeFilter}`}
            className="project-grid"
            id="project-list-panel"
            role="tabpanel"
          >
            {visibleProjects.map((project) => {
              const canRename = project.projectRole === "owner"
                || project.projectRole === "editor";
              const canDelete = project.projectRole === "owner";
              const editPath = project.projectType === "3d"
                ? standaloneSceneRoutePath(project.id, "edit")
                : canvasRoutePath(project.id, "canvas");
              const previewPath = project.projectType === "3d"
                ? standaloneSceneRoutePath(project.id, "preview")
                : canvasRoutePath(project.id, "preview");
              return (
                <article className={`project-card project-card-${project.projectType}`} key={project.id}>
                  <a
                    aria-label={`打开 ${project.name} 的${project.projectType === "3d" ? "独立 3D 场景" : "2D 画布"}`}
                    className="project-card-cover"
                    href={editPath}
                  >
                    {project.coverUrl ? (
                      <ResourceImage alt={`${project.name} 项目封面`} src={apiUrl(project.coverUrl)} />
                    ) : (
                      <span className="project-card-cover-empty">
                        <i aria-hidden="true">{project.projectType === "3d" ? "⬡" : "◇"}</i>
                        <strong>尚未生成项目截图</strong>
                      </span>
                    )}
                  </a>
                  <div className="project-card-body">
                    <div className="project-card-header">
                      <span className={`status-tag status-${project.status}`}>
                        {projectStatusText[project.status]}
                      </span>
                      <span className={`project-type-tag is-${project.projectType}`}>{project.projectType.toUpperCase()}</span>
                      {project.projectRole ? <span>{projectRoleText[project.projectRole]}</span> : null}
                    </div>
                    <h2 title={project.name}>{project.name}</h2>
                    <footer>
                      <span>更新于 {formatDate(project.updatedAt)}</span>
                      <div className="project-card-actions">
                        {canRename ? (
                          <button
                            aria-label={`修改 ${project.name} 的名称`}
                            className="icon-button project-action"
                            onClick={() => setRenamingProject(project)}
                            title="修改名称"
                            type="button"
                          >
                            <ActionIcon name="edit" />
                          </button>
                        ) : null}
                        {canDelete ? (
                          <button
                            aria-label={`删除 ${project.name}`}
                            className="icon-button project-action project-delete-action"
                            onClick={() => setDeletingProject(project)}
                            title="删除项目"
                            type="button"
                          >
                            <ActionIcon name="delete" />
                          </button>
                        ) : null}
                        <a
                          aria-label={`直接预览 ${project.name}`}
                          className="icon-button project-action"
                          href={previewPath}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="在新页签中预览"
                        >
                          <ActionIcon name="view" />
                        </a>
                      </div>
                    </footer>
                  </div>
                </article>
              );
            })}
          </section>
        ) : null}
      </section>
      )}

      <footer className="workspace-footer">
        <div className="workspace-footer-brand">
          <ProductLogo className="workspace-footer-logo" />
          <div><strong>{PRODUCT_NAME}</strong><span>数字孪生 · 交付工作台</span></div>
        </div>
        <span className="workspace-footer-caption">2D 看板<span aria-hidden="true"> / </span>3D 场景</span>
      </footer>

      {showCreateProject ? (
        <CreateProjectDialog
          allowedModules={user.modules}
          initialProjectType={createProjectTemplateId?.projectType ?? projectTypeFilter}
          onClose={() => setShowCreateProject(false)}
          onCreated={createProject}
          templateId={createProjectTemplateId}
        />
      ) : null}
      {renamingProject ? (
        <RenameProjectDialog
          onClose={() => setRenamingProject(null)}
          onRenamed={renamedProject}
          project={renamingProject}
        />
      ) : null}
      {deletingProject ? (
        <DeleteProjectDialog
          onClose={() => setDeletingProject(null)}
          onDeleted={deletedProject}
          project={deletingProject}
        />
      ) : null}

    </main>
  );
}

export function App() {
  const [user, setUser] = useState<IotUser | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const [sessionFailure, setSessionFailure] = useState<"missing" | "expired" | null>(null);
  const [retry, setRetry] = useState(0);
  const identityVersion = useRef(0);
  const sessionToken = useRef<string | null>(null);

  useEffect(() => {
    let controller: AbortController | null = null;
    let active = true;
    const verify = () => {
      controller?.abort();
      controller = new AbortController();
      const version = ++identityVersion.current;
      const token = readIotToken();
      const changedAccount = token !== sessionToken.current;
      sessionToken.current = token;
      setInitializationError(null);
      if (!token) {
        setSessionFailure("missing");
        setUser(null);
        setInitializing(false);
        return;
      }
      // Background checks must not discard unsaved scene edits on window focus.
      if (changedAccount) { setUser(null); setInitializing(true); }
      void loadIotIdentity(controller.signal).then(identity => {
        if (active && version === identityVersion.current) {
          setSessionFailure(null);
          setUser(previous => JSON.stringify(previous) === JSON.stringify(identity) ? previous : identity);
        }
      }).catch(reason => {
        if (!active || version !== identityVersion.current) return;
        if (reason instanceof ApiRequestError && reason.code === "unauthenticated") {
          setSessionFailure(readIotToken() ? "expired" : "missing");
          setUser(null);
        }
        else setInitializationError(errorMessage(reason));
      }).finally(() => {
        if (active && version === identityVersion.current) setInitializing(false);
      });
    };
    const expired = () => {
      ++identityVersion.current;
      controller?.abort();
      setSessionFailure("expired");
      setUser(null);
      setInitializing(false);
      setInitializationError(null);
    };
    const changed = (event: StorageEvent) => { if (event.key === IOT_TOKEN_KEY || event.key === null) verify(); };
    const visible = () => { if (document.visibilityState === "visible") verify(); };
    verify();
    window.addEventListener(IOT_SESSION_EVENT, expired);
    window.addEventListener("storage", changed);
    window.addEventListener("focus", verify);
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      controller?.abort();
      window.removeEventListener(IOT_SESSION_EVENT, expired);
      window.removeEventListener("storage", changed);
      window.removeEventListener("focus", verify);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [retry]);

  if (initializing) return <main className="loading-shell"><h1>正在验证 IoT 会话…</h1></main>;
  if (initializationError && !user) return <main className="loading-shell">
    <h1>无法读取 IoT 授权</h1><p role="alert">{initializationError}</p>
    <button className="primary-button" type="button" onClick={() => setRetry(value => value + 1)}>重新连接</button>
    <a className="secondary-button" href={IOT_HOME_PATH} target="_top">返回 IoT</a>
  </main>;
  if (!user) return <main className="loading-shell">
    <h1>{sessionFailure === "expired" ? "IoT 登录已失效" : "当前浏览器未登录 IoT"}</h1>
    <p>{sessionFailure === "expired"
      ? "IoT 拒绝了当前登录状态，请重新登录后再进入数字孪生。"
      : "当前页面没有读到 IoT 登录状态。请在同一浏览器、同一地址登录后重新验证。"}</p>
    <p>当前访问地址：{window.location.origin}</p>
    <p>不同浏览器或浏览器用户的登录状态不共享。</p>
    <a className="primary-button" href={IOT_LOGIN_PATH} target="_top">前往 IoT 登录</a>
    <button className="secondary-button" type="button" onClick={() => setRetry(value => value + 1)}>已登录，重新验证</button>
  </main>;
  return <>
    {initializationError ? <div className="iot-session-error" role="alert">
      <strong>IoT 授权验证失败，当前草稿已保留。</strong><span>{initializationError}</span>
      <button type="button" onClick={() => setRetry(value => value + 1)}>重新验证</button>
    </div> : null}
    <div inert={Boolean(initializationError)}>
      <Workspace key={JSON.stringify([user.id, user.modules, user.capabilities])} user={user} />
    </div>
  </>;
}
