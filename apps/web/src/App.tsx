import { FormEvent, useEffect, useState } from "react";

type Capability = {
  canCreateProject: boolean;
  canManageUsers: boolean;
};

type CurrentUser = {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  capabilities: Capability;
};

type Project = {
  id: string;
  name: string;
  status: "draft" | "published" | "archived";
  createdAt: string;
  updatedAt: string;
  projectRole: "owner" | "editor" | "viewer" | null;
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

type ApiFailure = {
  error?: string;
  message?: string;
  requestId?: string;
};

class ApiRequestError extends Error {
  constructor(
    readonly code: string,
    readonly requestId: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload: unknown = contentType.includes("application/json")
    ? await response.json()
    : null;

  if (!response.ok) {
    const failure = payload as ApiFailure | null;
    throw new ApiRequestError(
      failure?.error ?? "request_failed",
      failure?.requestId,
      failure?.message ?? `API request failed with HTTP ${response.status}.`,
    );
  }

  return payload as T;
}

const errorMessage = (reason: unknown): string =>
  reason instanceof Error ? reason.message : String(reason);

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

type LoginFormProps = {
  onSuccess: (user: CurrentUser) => void;
};

function LoginForm({ onSuccess }: LoginFormProps) {
  const [email, setEmail] = useState("");
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
        body: JSON.stringify({ email, password }),
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
        <span>邮箱</span>
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
        <span>密码</span>
        <input
          autoComplete="current-password"
          disabled={submitting}
          minLength={12}
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
          minLength={12}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="至少 12 位"
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
          minLength={12}
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
      <section className="auth-intro">
        <p className="eyebrow">Factory Digital Twin</p>
        <h1>工厂数字孪生<br />交付平台</h1>
        <p>
          面向交付人员的 2D + 3D 项目配置台。访问项目、资产和客户数据前，必须完成身份验证。
        </p>
        <div className="security-note">
          <span>权限边界</span>
          <p>平台管理员、交付负责人和项目成员拥有不同的访问范围。</p>
        </div>
      </section>
      <section className="auth-card">
        <p className="eyebrow">{setupRequired ? "First setup" : "Sign in"}</p>
        <h2>{setupRequired ? "初始化平台管理员" : "登录"}</h2>
        <p className="auth-copy">
          {setupRequired
            ? "仅在还没有任何用户时可执行。初始化令牌不会被保存到浏览器。"
            : "请使用已获授权的交付账号登录。"}
        </p>
        {setupRequired ? <BootstrapForm onSuccess={onSuccess} /> : <LoginForm onSuccess={onSuccess} />}
      </section>
    </main>
  );
}

type CreateProjectDialogProps = {
  onClose: () => void;
  onCreated: (project: Project) => void;
};

function CreateProjectDialog({ onClose, onCreated }: CreateProjectDialogProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const result = await request<ProjectResponse>("/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      onCreated(result.project);
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
        <h2>创建项目</h2>
        <p>新项目默认处于草稿状态，创建人自动成为项目负责人。</p>
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
            {submitting ? "正在创建…" : "创建草稿项目"}
          </button>
        </div>
      </form>
    </div>
  );
}

type WorkspaceProps = {
  user: CurrentUser;
  onLogout: () => Promise<void>;
};

function Workspace({ user, onLogout }: WorkspaceProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let active = true;

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
  }, []);

  const logout = async () => {
    setLoggingOut(true);

    try {
      await onLogout();
    } finally {
      setLoggingOut(false);
    }
  };

  const createProject = (project: Project) => {
    setProjects((current) => [project, ...current]);
    setShowCreateProject(false);
  };

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark">◫</span>
          <span>
            <strong>Factory Twin</strong>
            <small>交付配置台</small>
          </span>
        </a>
        <nav aria-label="主导航">
          <a aria-current="page" href="#projects">项目</a>
          <span>模板</span>
          <span>资源库</span>
        </nav>
        <div className="user-menu">
          <div>
            <strong>{user.displayName}</strong>
            <span>{user.roles.includes("platform_admin") ? "平台管理员" : "交付账号"}</span>
          </div>
          <button className="text-button" disabled={loggingOut} onClick={() => void logout()} type="button">
            {loggingOut ? "退出中…" : "退出"}
          </button>
        </div>
      </header>

      <section className="workspace-content" id="projects">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Projects</p>
            <h1>项目</h1>
            <p>创建并管理客户的 2D + 3D 数字孪生交付项目。</p>
          </div>
          {user.capabilities.canCreateProject ? (
            <button className="primary-button" onClick={() => setShowCreateProject(true)} type="button">
              <span>＋</span> 新建项目
            </button>
          ) : null}
        </div>

        {projectError ? (
          <section className="state-card error-state">
            <h2>项目列表加载失败</h2>
            <p>{projectError}</p>
          </section>
        ) : null}

        {loadingProjects ? (
          <section className="state-card">
            <p className="eyebrow">Loading</p>
            <h2>正在加载项目…</h2>
          </section>
        ) : null}

        {!loadingProjects && !projectError && projects.length === 0 ? (
          <section className="empty-projects">
            <div className="empty-icon">◇</div>
            <h2>还没有项目</h2>
            <p>从一个客户工厂开始，后续将为它配置模型、资产、数据和运行看板。</p>
            {user.capabilities.canCreateProject ? (
              <button className="primary-button" onClick={() => setShowCreateProject(true)} type="button">
                创建第一个项目
              </button>
            ) : (
              <p className="permission-note">你当前只有查看权限，请联系平台管理员创建项目。</p>
            )}
          </section>
        ) : null}

        {!loadingProjects && !projectError && projects.length > 0 ? (
          <section aria-label="项目列表" className="project-grid">
            {projects.map((project) => (
              <article className="project-card" key={project.id}>
                <div className="project-card-header">
                  <span className={`status-tag status-${project.status}`}>
                    {projectStatusText[project.status]}
                  </span>
                  {project.projectRole ? <span>{projectRoleText[project.projectRole]}</span> : null}
                </div>
                <h2>{project.name}</h2>
                <p className="project-id">ID · {project.id}</p>
                <footer>
                  <span>更新于 {formatDate(project.updatedAt)}</span>
                  <span className="next-step">配置台将在下一阶段接入 →</span>
                </footer>
              </article>
            ))}
          </section>
        ) : null}
      </section>

      {showCreateProject ? (
        <CreateProjectDialog onClose={() => setShowCreateProject(false)} onCreated={createProject} />
      ) : null}
    </main>
  );
}

export function App() {
  const [initializing, setInitializing] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [initializationError, setInitializationError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

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
  }, []);

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
