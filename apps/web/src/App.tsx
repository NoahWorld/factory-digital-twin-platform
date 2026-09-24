import { FormEvent, lazy, Suspense, useEffect, useState, type KeyboardEvent } from "react";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "../../../shared/auth-constraints";
import { standaloneSceneRoutePath, type ProjectType } from "../../../shared/standalone-3d";
import { apiUrl, ApiRequestError, errorMessage, publicShareToken, request } from "./api";
import { LoginShowcase } from "./auth/LoginShowcase";
import { canvasRoutePath, projectTemplateCanvasPath, projectTemplateScenePath } from "./canvas/routes";
import { getSceneTemplate, isSceneTemplateId, type SceneTemplateId, type ProjectTemplate } from "./scene/scene-templates";
import {
  getCanvasTemplate,
  isCanvasTemplateId,
  type CanvasTemplateId,
} from "./canvas/templates";
import { CanvasPage } from "./pages/CanvasPage";
import { ResourcesPage } from "./pages/ResourcesPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { UsersPage } from "./pages/UsersPage";
import { PRODUCT_NAME } from "./product-config";
import { ThemeToggle } from "./theme/ThemeToggle";
import type { CoverProject } from "./covers/ProjectCoverQueue";

const ProjectCoverQueue = lazy(() => import("./covers/ProjectCoverQueue"));

const Model3DEditorPage = lazy(() => import("./pages/Model3DEditorPage"));
const IndustrialLandingPage = lazy(() => import("./pages/IndustrialLandingPage"));
const Standalone3DProjectPage = lazy(() => import("./pages/Standalone3DProjectPage"));

function isProductLandingRoute(): boolean {
  const hash = window.location.hash;
  return hash === "" || hash === "#/" || hash === "#/industrial";
}

type Capability = {
  canCreateProject: boolean;
  canManageUsers: boolean;
  canAccess2D: boolean;
  canAccess3D: boolean;
};

type CurrentUser = {
  id: string;
  email: string;
  loginName: string | null;
  displayName: string;
  roles: string[];
  modules: ProjectType[];
  capabilities: Capability;
};

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

type BootstrapStatusResponse = {
  setupRequired: boolean;
  requestId: string;
};

type UserResponse = {
  user: CurrentUser;
  requestId: string;
};

type ProjectsResponse = {
  projects: Project[];
  requestId: string;
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

type PublicationResponse = {
  published: boolean;
  project: Project;
  shareToken?: string;
  publishedAt?: string;
  publishedRevision?: number;
  scopeCount?: number;
  revokedCount?: number;
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

type LoginFormProps = {
  onSuccess: (user: CurrentUser) => void;
};

function LoginForm({ onSuccess }: LoginFormProps) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const result = await request<UserResponse>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ identifier, password }),
      });
      setPassword("");
      onSuccess(result.user);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>
        <span>账号</span>
        <input
          autoComplete="username"
          disabled={submitting}
          maxLength={254}
          onChange={(event) => setIdentifier(event.target.value)}
          required
          type="text"
          value={identifier}
        />
      </label>
      <label>
        <span>密码</span>
        <input
          autoComplete="current-password"
          disabled={submitting}
          maxLength={MAX_PASSWORD_LENGTH}
          minLength={MIN_PASSWORD_LENGTH}
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>
      <FormNotice error={error} />
      <button className="primary-button" disabled={submitting} type="submit">
        {submitting ? "正在登录…" : "登录平台"}
      </button>
    </form>
  );
}

type BootstrapFormProps = {
  onSuccess: (user: CurrentUser) => void;
};

function BootstrapForm({ onSuccess }: BootstrapFormProps) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("两次输入的密码不一致。");
      return;
    }

    setSubmitting(true);

    try {
      const result = await request<UserResponse>("/api/v1/auth/bootstrap", {
        method: "POST",
        headers: { "x-bootstrap-token": bootstrapToken },
        body: JSON.stringify({ displayName, email, password }),
      });
      setPassword("");
      setConfirmPassword("");
      setBootstrapToken("");
      onSuccess(result.user);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>
        <span>管理员姓名</span>
        <input
          autoComplete="name"
          disabled={submitting}
          maxLength={80}
          minLength={2}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="例如：张三"
          required
          value={displayName}
        />
      </label>
      <label>
        <span>管理员邮箱</span>
        <input
          autoComplete="email"
          disabled={submitting}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@company.com"
          required
          type="email"
          value={email}
        />
      </label>
      <label>
        <span>登录密码</span>
        <input
          autoComplete="new-password"
          disabled={submitting}
          maxLength={MAX_PASSWORD_LENGTH}
          minLength={MIN_PASSWORD_LENGTH}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={`至少 ${MIN_PASSWORD_LENGTH} 位`}
          required
          type="password"
          value={password}
        />
      </label>
      <label>
        <span>确认密码</span>
        <input
          autoComplete="new-password"
          disabled={submitting}
          maxLength={MAX_PASSWORD_LENGTH}
          minLength={MIN_PASSWORD_LENGTH}
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
          type="password"
          value={confirmPassword}
        />
      </label>
      <label>
        <span>初始化令牌</span>
        <input
          autoComplete="off"
          disabled={submitting}
          onChange={(event) => setBootstrapToken(event.target.value)}
          placeholder="来自 API 的 BOOTSTRAP_TOKEN"
          required
          type="password"
          value={bootstrapToken}
        />
      </label>
      <FormNotice error={error} />
      <button className="primary-button" disabled={submitting} type="submit">
        {submitting ? "正在初始化…" : "创建首个管理员"}
      </button>
    </form>
  );
}

type AuthPageProps = {
  setupRequired: boolean;
  onSuccess: (user: CurrentUser) => void;
};

function AuthPage({ setupRequired, onSuccess }: AuthPageProps) {
  return (
    <main className="auth-shell">
      <ThemeToggle className="auth-theme-controls" />
      <section className="auth-intro">
        <p className="eyebrow">Factory Digital Twin</p>
        <h1><span>工厂数字孪生</span><span>交付平台</span></h1>
        <p className="auth-description">
          面向交付人员的 2D + 3D 项目配置台。<br />
          统一配置场景、资产与数据。
        </p>
        <LoginShowcase />
        <a className="auth-product-link" href="#/">
          查看产品介绍 <span aria-hidden="true">→</span>
        </a>
      </section>
      <section className="auth-card">
        <p className="eyebrow">{setupRequired ? "First setup" : "Sign in"}</p>
        <h2>{setupRequired ? "初始化平台管理员" : "登录"}</h2>
        {setupRequired ? (
          <p className="auth-copy">
            仅在还没有任何用户时可执行。首个管理员账号固定为 admin，初始化令牌不会被保存到浏览器。
          </p>
        ) : null}
        {setupRequired ? <BootstrapForm onSuccess={onSuccess} /> : <LoginForm onSuccess={onSuccess} />}
      </section>
    </main>
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
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const result = await request<ProjectResponse>("/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({ name, projectType: templateId?.projectType ?? projectType }),
      });
      onCreated(result.project, templateId);
    } catch (reason) {
      setError(errorMessage(reason));
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
        <p className="eyebrow">New project</p>
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
        <FormNotice error={error} />
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
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

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
      setError(errorMessage(reason));
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
        <FormNotice error={error} />
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
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const result = await request<DeleteProjectResponse>(
        `/api/v1/projects/${encodeURIComponent(project.id)}`,
        { method: "DELETE" },
      );
      onDeleted(result.deletedProjectId, result.warning);
    } catch (reason) {
      setError(errorMessage(reason));
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
        <p>项目场景、模型元数据、资产、数据源和成员关系都会被永久删除，此操作不可撤销。</p>
        <FormNotice error={error} />
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

function PublicationDialog({ project, onClose, onChanged }: {
  project: Project;
  onClose: () => void;
  onChanged: (result: PublicationResponse) => void;
}) {
  const [publication, setPublication] = useState<PublicationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void request<PublicationResponse>(`/api/v1/projects/${encodeURIComponent(project.id)}/publication`)
      .then((result) => { if (active) setPublication(result); })
      .catch((reason) => { if (active) setError(errorMessage(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [project.id]);

  const shareUrl = publication?.shareToken
    ? `${window.location.origin}${window.location.pathname}#/share/${publication.shareToken}`
    : null;

  const changePublication = async (method: "POST" | "DELETE") => {
    setBusy(true);
    setError(null);
    try {
      const result = await request<PublicationResponse>(`/api/v1/projects/${encodeURIComponent(project.id)}/publication`, { method });
      setPublication(result);
      setConfirmRevoke(false);
      setCopied(false);
      onChanged(result);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setError(null);
    } catch (reason) {
      setError(`复制链接失败：${errorMessage(reason)}`);
    }
  };

  return (
    <div aria-modal="true" className="dialog-backdrop" role="dialog">
      <div className="dialog-card publication-dialog">
        <button aria-label="关闭" className="dialog-close" disabled={busy} onClick={onClose} type="button">×</button>
        <p className="eyebrow">项目发布</p>
        <h2>{project.name}</h2>
        {loading ? <p>正在读取发布状态…</p> : null}
        {!loading && publication?.published && shareUrl ? <>
          <p>任何获得此链接的人都可以免登录查看当前保存的项目。</p>
          <label className="publication-link-label" htmlFor="publication-share-link">公开链接</label>
          <input id="publication-share-link" className="publication-link-input" readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} />
          <div className="publication-link-actions">
            <button className="primary-button compact-button" disabled={busy} onClick={() => void copyLink()} type="button">{copied ? "已复制" : "复制链接"}</button>
            <a className="secondary-button compact-button" href={shareUrl} rel="noreferrer" target="_blank">打开链接</a>
          </div>
          <p className="publication-meta">发布于 {formatDate(publication.publishedAt ?? project.updatedAt)}</p>
          {confirmRevoke ? <div className="publication-confirm"><p>取消后，此链接立即失效。</p><button className="danger-button compact-button" disabled={busy} onClick={() => void changePublication("DELETE")} type="button">确认取消发布</button><button className="secondary-button compact-button" disabled={busy} onClick={() => setConfirmRevoke(false)} type="button">保留发布</button></div> : null}
          <div className="dialog-actions">
            <button className="secondary-button" disabled={busy} onClick={() => setConfirmRevoke(true)} type="button">取消发布</button>
            <button className="secondary-button" disabled={busy} onClick={() => void changePublication("POST")} type="button">重新发布</button>
          </div>
          <p className="publication-meta">重新发布会生成新链接，旧链接立即失效。</p>
        </> : null}
        {!loading && publication && !publication.published ? <>
          <p>发布后会生成免登录访问链接，链接持有者可以查看项目及其关联展示内容。</p>
          <div className="dialog-actions">
            <button className="secondary-button" disabled={busy} onClick={onClose} type="button">关闭</button>
            <button className="primary-button" disabled={busy} onClick={() => void changePublication("POST")} type="button">{busy ? "正在发布…" : "发布项目"}</button>
          </div>
        </> : null}
        <FormNotice error={error} />
      </div>
    </div>
  );
}

type WorkspaceProps = {
  user: CurrentUser;
  onLogout: () => Promise<void>;
};

function AccessDenied({ module }: { module: string }) {
  return <main className="canvas-page-state error-state">
    <p className="eyebrow">Access denied</p>
    <h1>没有{module}访问权限</h1>
    <p>请联系平台管理员为账号分配相应模块权限。</p>
    <a className="secondary-button" href="#/projects">返回项目</a>
  </main>;
}

type WorkspaceRoute =
  | { kind: "projects" }
  | { kind: "templates" }
  | { kind: "resources" }
  | { kind: "users" }
  | { kind: "canvas"; projectId: string; mode: "edit" | "preview"; templateId?: CanvasTemplateId; initialAssetId?: string }
  | { kind: "standalone-scene"; projectId: string; mode: "edit" | "preview"; templateId?: SceneTemplateId }
  | { kind: "model-editor"; projectId: string; nodeId: string }
  | { kind: "invalid"; message: string };

const currentWorkspaceRoute = (): WorkspaceRoute => {
  if (window.location.hash === "#/templates") {
    return { kind: "templates" };
  }
  if (window.location.hash === "#/resources") {
    return { kind: "resources" };
  }
  if (window.location.hash === "#/users") {
    return { kind: "users" };
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

function Workspace({ user, onLogout }: WorkspaceProps) {
  const [route, setRoute] = useState<WorkspaceRoute>(currentWorkspaceRoute);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectTypeFilter, setProjectTypeFilter] = useState<ProjectType>(() => user.modules.includes("2d") ? "2d" : "3d");
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [createProjectTemplateId, setCreateProjectTemplateId] = useState<ProjectTemplate | null>(null);
  const [renamingProject, setRenamingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [publishingProject, setPublishingProject] = useState<Project | null>(null);
  const [projectNotice, setProjectNotice] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    const updateRoute = () => setRoute(currentWorkspaceRoute());
    window.addEventListener("hashchange", updateRoute);
    return () => window.removeEventListener("hashchange", updateRoute);
  }, []);

  useEffect(() => {
    if (route.kind !== "projects" && route.kind !== "resources") return;
    let active = true;
    setLoadingProjects(true);
    setProjectError(null);

    void request<ProjectsResponse>("/api/v1/projects")
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
        if (active) {
          setLoadingProjects(false);
        }
      });

    return () => {
      active = false;
    };
  }, [route.kind]);

  const logout = async () => {
    setLoggingOut(true);

    try {
      await onLogout();
    } finally {
      setLoggingOut(false);
    }
  };

  const createProject = (project: Project, templateId: ProjectTemplate | null) => {
    setProjects((current) => [project, ...current]);
    setProjectTypeFilter(project.projectType);
    setShowCreateProject(false);
    setCreateProjectTemplateId(null);
    if (templateId) {
      window.location.hash = (templateId.projectType === "2d" ? projectTemplateCanvasPath(project.id, templateId.id) : projectTemplateScenePath(project.id, templateId.id)).slice(1);
    } else if (project.projectType === "3d") {
      window.location.hash = standaloneSceneRoutePath(project.id, "edit").slice(1);
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
    setProjectNotice(`项目已重命名为“${project.name}”。`);
  };

  const deletedProject = (projectId: string, warning: string | null) => {
    setProjects((current) => current.filter((project) => project.id !== projectId));
    setDeletingProject(null);
    setProjectNotice(
      warning
        ? `项目已删除，但对象存储清理需要处理：${warning}`
        : "项目已永久删除。",
    );
  };

  const changedPublication = (result: PublicationResponse) => {
    setProjects((current) => current.map((project) => project.id === result.project.id ? result.project : project));
    setProjectNotice(result.published ? "项目已发布，公开链接可以访问。" : "项目已取消发布，公开链接已失效。");
    if ((result.revokedCount ?? 0) > 1) {
      void request<ProjectsResponse>("/api/v1/projects")
        .then((response) => setProjects(response.projects))
        .catch((reason) => setProjectError(errorMessage(reason)));
    }
  };

  const projectCounts = {
    "2d": projects.filter((project) => project.projectType === "2d").length,
    "3d": projects.filter((project) => project.projectType === "3d").length,
  } satisfies Record<ProjectType, number>;
  const visibleProjects = projects.filter(
    (project) => project.projectType === projectTypeFilter,
  );
  const switchProjectTypeWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    const nextType = event.key === "ArrowLeft" || event.key === "Home"
      ? "2d"
      : event.key === "ArrowRight" || event.key === "End"
        ? "3d"
        : null;
    if (!nextType || !user.modules.includes(nextType)) return;
    event.preventDefault();
    setProjectTypeFilter(nextType);
    document.getElementById(`project-type-tab-${nextType}`)?.focus();
  };

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

  const isPlatformAdmin = user.roles.includes("platform_admin");

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <div className="topbar-main">
          <a className="brand" href="#/projects">
            <span className="brand-mark" aria-hidden="true">◫</span>
            <span className="brand-name"><strong>{PRODUCT_NAME}</strong><small>交付工作台</small></span>
          </a>
          <nav aria-label="主导航" className="topbar-nav">
            <a aria-current={route.kind === "projects" ? "page" : undefined} href="#/projects">项目</a>
            {user.modules.length > 0 ? <a aria-current={route.kind === "templates" ? "page" : undefined} href="#/templates">模板</a> : null}
            {user.modules.length > 0 ? <a aria-current={route.kind === "resources" ? "page" : undefined} href="#/resources">资源库</a> : null}
            {user.capabilities.canManageUsers ? <a aria-current={route.kind === "users" ? "page" : undefined} href="#/users">用户管理</a> : null}
          </nav>
        </div>
        <div className="user-menu">
          <ThemeToggle />
          <div className="user-identity">
            <span className="user-avatar" aria-hidden="true">{user.displayName.trim().slice(0, 1)}</span>
            <div className="user-identity-text">
              <strong>{user.displayName}</strong>
              <span>{user.roles.includes("platform_admin") ? "平台管理员" : "交付账号"}</span>
            </div>
          </div>
          <button className="secondary-button topbar-logout" disabled={loggingOut} onClick={() => void logout()} type="button">
            {loggingOut ? "退出中…" : "退出"}
          </button>
        </div>
      </header>

      {route.kind === "users" ? (
        user.capabilities.canManageUsers ? <UsersPage currentUserId={user.id} /> : <AccessDenied module="用户管理" />
      ) : route.kind === "templates" && user.modules.length === 0 ? (
        <AccessDenied module="项目模板" />
      ) : route.kind === "resources" && user.modules.length === 0 ? (
        <AccessDenied module="资源库" />
      ) : route.kind === "templates" ? (
        <TemplatesPage
          canCreateProject={user.capabilities.canCreateProject}
          allowedModules={user.modules}
          onCreateFromTemplate={openTemplateProjectDialog}
        />
      ) : route.kind === "resources" ? (
        <ResourcesPage
          isPlatformAdmin={isPlatformAdmin}
          loadingProjects={loadingProjects}
          projectError={projectError}
          projects={projects}
        />
      ) : user.modules.length === 0 ? (
        <section className="workspace-content" id="projects">
          <div className="page-heading"><div><p className="eyebrow">Projects</p><h1>项目</h1></div></div>
          <div className="state-card error-state"><h2>尚未获得模块权限</h2><p>请联系平台管理员授予 2D 看板或 3D 场景权限。</p></div>
        </section>
      ) : (
      <section className="workspace-content" id="projects">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Projects</p>
            <h1>项目</h1>
          </div>
          {user.capabilities.canCreateProject ? (
            <button
              aria-label="新建项目"
              className="primary-button icon-button"
              onClick={openBlankProjectDialog}
              title="新建项目"
              type="button"
            >
              <ActionIcon name="add" />
            </button>
          ) : null}
        </div>

        <div className="project-type-tabs-shell">
          <div className="project-type-tabs-copy">
            <strong>交付类型</strong>
          </div>
          <div aria-label="项目交付类型" className="project-type-tabs" role="tablist">
            {user.modules.includes("2d") ? <button
              aria-controls="project-list-panel"
              aria-selected={projectTypeFilter === "2d"}
              className={projectTypeFilter === "2d" ? "is-active" : ""}
              id="project-type-tab-2d"
              onKeyDown={switchProjectTypeWithKeyboard}
              onClick={() => setProjectTypeFilter("2d")}
              role="tab"
              tabIndex={projectTypeFilter === "2d" ? 0 : -1}
              type="button"
            >
              <span aria-hidden="true" className="project-type-tab-mark is-2d">2D</span>
              <span>看板项目</span>
              <small>{projectCounts["2d"]}</small>
            </button> : null}
            {user.modules.includes("3d") ? <button
              aria-controls="project-list-panel"
              aria-selected={projectTypeFilter === "3d"}
              className={projectTypeFilter === "3d" ? "is-active" : ""}
              id="project-type-tab-3d"
              onKeyDown={switchProjectTypeWithKeyboard}
              onClick={() => setProjectTypeFilter("3d")}
              role="tab"
              tabIndex={projectTypeFilter === "3d" ? 0 : -1}
              type="button"
            >
              <span aria-hidden="true" className="project-type-tab-mark is-3d">3D</span>
              <span>场景项目</span>
              <small>{projectCounts["3d"]}</small>
            </button> : null}
          </div>
        </div>

        {projectNotice ? (
          <div className="project-notice" role="status">
            <span>{projectNotice}</span>
            <button aria-label="关闭项目提示" onClick={() => setProjectNotice(null)} type="button">×</button>
          </div>
        ) : null}

        {!loadingProjects && !projectError ? <Suspense fallback={null}>
          <ProjectCoverQueue projects={projects} isAdmin={isPlatformAdmin}
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
              <p className="permission-note">当前账号不能创建项目，请联系平台管理员分配角色或模块权限。</p>
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
              const canRename = isPlatformAdmin
                || project.projectRole === "owner"
                || project.projectRole === "editor";
              const canDelete = isPlatformAdmin || project.projectRole === "owner";
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
                      <img alt={`${project.name} 项目封面`} src={apiUrl(project.coverUrl)} />
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
                    <h2>{project.name}</h2>
                    <footer>
                      <span>更新于 {formatDate(project.updatedAt)}</span>
                      <div className="project-card-actions">
                        {canRename && project.status !== "archived" ? (
                          <button
                            aria-label={`${project.status === "published" ? "管理" : "发布"} ${project.name} 的公开链接`}
                            className="icon-button project-action"
                            onClick={() => setPublishingProject(project)}
                            title={project.status === "published" ? "管理发布" : "发布项目"}
                            type="button"
                          >
                            <ActionIcon name="share" />
                          </button>
                        ) : null}
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
                          title="直接预览"
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
      {publishingProject ? (
        <PublicationDialog
          onChanged={changedPublication}
          onClose={() => setPublishingProject(null)}
          project={publishingProject}
        />
      ) : null}
    </main>
  );
}

function PublicProject({ token }: { token: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setProject(null);
    setError(null);
    void request<{ project: Project }>(`/api/v1/publications?share=${encodeURIComponent(token)}`)
      .then((result) => { if (active) setProject(result.project); })
      .catch((reason) => {
        if (active) setError(reason instanceof ApiRequestError && reason.code === "publication_not_found"
          ? "此公开链接不存在或已取消发布。" : errorMessage(reason));
      });
    return () => { active = false; };
  }, [token]);

  if (error) return <main className="canvas-page-state error-state"><h1>无法打开项目</h1><p>{error}</p></main>;
  if (!project) return <main className="canvas-page-state"><h1>正在打开项目…</h1></main>;
  if (project.projectType === "2d") return <CanvasPage key={token} mode="preview" projectId={project.id} publicView />;
  return <Suspense fallback={<main className="canvas-page-state"><h1>正在打开 3D 场景…</h1></main>}>
    <Standalone3DProjectPage key={token} mode="preview" projectId={project.id} publicView />
  </Suspense>;
}

export function App() {
  const [showProductLanding, setShowProductLanding] = useState(isProductLandingRoute);
  const [shareToken, setShareToken] = useState(publicShareToken);
  const [initializing, setInitializing] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [initializationError, setInitializationError] = useState<string | null>(null);

  useEffect(() => {
    const updatePublicRoute = () => {
      setShowProductLanding(isProductLandingRoute());
      setShareToken(publicShareToken());
    };

    window.addEventListener("hashchange", updatePublicRoute);
    return () => window.removeEventListener("hashchange", updatePublicRoute);
  }, []);

  useEffect(() => {
    if (showProductLanding || shareToken) {
      return;
    }

    let active = true;
    setInitializing(true);
    setInitializationError(null);

    void (async () => {
      try {
        const bootstrap = await request<BootstrapStatusResponse>("/api/v1/auth/bootstrap-status");

        if (!active) {
          return;
        }

        setSetupRequired(bootstrap.setupRequired);

        if (!bootstrap.setupRequired) {
          try {
            const currentUser = await request<UserResponse>("/api/v1/auth/me");

            if (active) {
              setUser(currentUser.user);
            }
          } catch (reason) {
            if (!(reason instanceof ApiRequestError) || reason.code !== "unauthenticated") {
              throw reason;
            }
          }
        }
      } catch (reason) {
        if (active) {
          setInitializationError(errorMessage(reason));
        }
      } finally {
        if (active) {
          setInitializing(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [showProductLanding, shareToken]);

  const authenticated = (nextUser: CurrentUser) => {
    setSetupRequired(false);
    setUser(nextUser);
  };

  const logout = async () => {
    try {
      await request<null>("/api/v1/auth/logout", { method: "POST" });
      setUser(null);
    } catch (reason) {
      throw new Error(`无法退出登录：${errorMessage(reason)}`);
    }
  };

  if (showProductLanding) {
    return (
      <Suspense fallback={<main className="loading-shell"><h1>正在打开产品介绍…</h1></main>}>
        <IndustrialLandingPage />
      </Suspense>
    );
  }

  if (shareToken) return <PublicProject token={shareToken} />;

  if (initializing) {
    return (
      <main className="loading-shell">
        <p className="eyebrow">Factory Digital Twin</p>
        <h1>正在验证访问状态…</h1>
      </main>
    );
  }

  if (initializationError) {
    return (
      <main className="loading-shell">
        <p className="eyebrow">Connection error</p>
        <h1>无法连接身份服务</h1>
        <p>{initializationError}</p>
      </main>
    );
  }

  if (!user) {
    return <AuthPage onSuccess={authenticated} setupRequired={setupRequired} />;
  }

  return <Workspace onLogout={logout} user={user} />;
}
