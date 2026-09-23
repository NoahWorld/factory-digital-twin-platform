import { useEffect, useState, type FormEvent } from "react";
import { Select } from "../components/Select";
import { errorMessage, request } from "../api";
import "./UsersPage.css";

type Module = "2d" | "3d";
type Role = "platform_admin" | "delivery_manager" | "viewer";
type ManagedUser = {
  id: string;
  email: string;
  loginName: string | null;
  displayName: string;
  role: Role;
  modules: Module[];
  active: boolean;
};

const roleName: Record<Role, string> = {
  platform_admin: "平台管理员",
  delivery_manager: "交付负责人",
  viewer: "只读用户",
};

export function UsersPage({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [selected, setSelected] = useState<ManagedUser | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"active" | "deleted" | "all">("active");
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState("");
  const [loginName, setLoginName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [modules, setModules] = useState<Module[]>([]);

  const loadUsers = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await request<{ users: ManagedUser[] }>("/api/v1/users");
      setUsers(result.users);
    } catch (reason) {
      setLoadError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadUsers(); }, []);

  const startCreate = () => {
    setSelected(null);
    setEmail("");
    setLoginName("");
    setDisplayName("");
    setPassword("");
    setRole("viewer");
    setModules([]);
    setConfirmDelete(false);
    setActionError(null);
    setNotice(null);
  };

  const selectUser = async (user: ManagedUser) => {
    setDetailLoading(true);
    setActionError(null);
    setNotice(null);
    setConfirmDelete(false);
    try {
      const result = await request<{ user: ManagedUser }>(`/api/v1/users/${encodeURIComponent(user.id)}`);
      setSelected(result.user);
      setEmail(result.user.email);
      setLoginName(result.user.loginName ?? "");
      setDisplayName(result.user.displayName);
      setPassword("");
      setRole(result.user.role);
      setModules(result.user.modules);
      setUsers((current) => current.map((item) => item.id === user.id ? result.user : item));
    } catch (reason) {
      setActionError(`读取“${user.displayName}”失败：${errorMessage(reason)}`);
    } finally {
      setDetailLoading(false);
    }
  };

  const setModule = (module: Module, enabled: boolean) => {
    setModules((current) => enabled
      ? (["2d", "3d"] as const).filter((candidate) => candidate === module || current.includes(candidate))
      : current.filter((candidate) => candidate !== module));
  };

  const createUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreating(true);
    setActionError(null);
    setNotice(null);
    try {
      const payload = { email, loginName, displayName, role,
        modules: role === "platform_admin" ? ["2d", "3d"] : modules,
        ...(password ? { password } : {}) };
      if (selected) {
        const result = await request<{ user: ManagedUser }>(`/api/v1/users/${encodeURIComponent(selected.id)}`, {
          method: "PUT", body: JSON.stringify(payload),
        });
        setUsers((current) => current.map((item) => item.id === result.user.id ? result.user : item));
        setSelected(result.user);
        setEmail(result.user.email);
        setLoginName(result.user.loginName ?? "");
        setDisplayName(result.user.displayName);
        setRole(result.user.role);
        setModules(result.user.modules);
        setPassword("");
        if (selected.id === currentUserId) {
          window.location.reload();
          return;
        }
        setNotice(`已保存“${result.user.displayName}”的资料和权限。${password ? "原有会话已撤销。" : ""}`);
      } else {
        const result = await request<{ user: {
          id: string; email: string; loginName: string | null; displayName: string;
          roles: Role[]; modules: Module[];
        } }>("/api/v1/users", {
          method: "POST", body: JSON.stringify(payload),
        });
        if (result.user.roles.length !== 1) throw new Error("新账号的全局角色数量异常。");
        const created: ManagedUser = { ...result.user, role: result.user.roles[0], active: true };
        setUsers((current) => [...current, created]);
        setSelected(created);
        setEmail(created.email);
        setLoginName(created.loginName ?? "");
        setDisplayName(created.displayName);
        setRole(created.role);
        setModules(created.modules);
        setPassword("");
        setNotice(`已创建账号“${created.displayName}”。`);
      }
    } catch (reason) {
      setActionError(`${selected ? "保存" : "创建"}账号失败：${errorMessage(reason)}`);
    } finally {
      setCreating(false);
    }
  };

  const updateModule = async (user: ManagedUser, module: Module) => {
    const nextModules = (["2d", "3d"] as const).filter((candidate) =>
      candidate === module ? !user.modules.includes(candidate) : user.modules.includes(candidate));
    setBusyUserId(user.id);
    setActionError(null);
    setNotice(null);
    try {
      const result = await request<{ userId: string; modules: Module[] }>(
        `/api/v1/users/${encodeURIComponent(user.id)}/modules`,
        { method: "PATCH", body: JSON.stringify({ modules: nextModules }) },
      );
      setUsers((current) => current.map((candidate) => candidate.id === result.userId
        ? { ...candidate, modules: result.modules } : candidate));
      if (selected?.id === result.userId) {
        setSelected({ ...selected, modules: result.modules });
        setModules(result.modules);
      }
      setNotice(`已更新“${user.displayName}”的模块权限。`);
    } catch (reason) {
      setActionError(`更新“${user.displayName}”失败：${errorMessage(reason)}`);
    } finally {
      setBusyUserId(null);
    }
  };

  const deleteUser = async () => {
    if (!selected || selected.id === currentUserId) return;
    setDeleting(true);
    setActionError(null);
    setNotice(null);
    try {
      await request<void>(`/api/v1/users/${encodeURIComponent(selected.id)}`, { method: "DELETE" });
      const deleted = { ...selected, active: false };
      setUsers((current) => current.map((item) => item.id === selected.id ? deleted : item));
      setSelected(deleted);
      setConfirmDelete(false);
      setNotice(`已删除“${selected.displayName}”的登录权限，关联记录仍保留。`);
    } catch (reason) {
      setActionError(`删除“${selected.displayName}”失败：${errorMessage(reason)}`);
    } finally {
      setDeleting(false);
    }
  };

  const restoreUser = async () => {
    if (!selected) return;
    setDeleting(true);
    setActionError(null);
    setNotice(null);
    try {
      const result = await request<{ user: ManagedUser }>(
        `/api/v1/users/${encodeURIComponent(selected.id)}/restore`, { method: "POST" },
      );
      setUsers((current) => current.map((item) => item.id === result.user.id ? result.user : item));
      setSelected(result.user);
      setNotice(`已恢复“${result.user.displayName}”的登录权限。`);
    } catch (reason) {
      setActionError(`恢复“${selected.displayName}”失败：${errorMessage(reason)}`);
    } finally {
      setDeleting(false);
    }
  };

  const activeCount = users.filter((user) => user.active).length;
  const deletedCount = users.length - activeCount;
  const visibleUsers = users.filter((user) => {
    if (filter === "active" && !user.active) return false;
    if (filter === "deleted" && user.active) return false;
    const needle = query.trim().toLowerCase();
    return !needle || [user.displayName, user.loginName, user.email]
      .some((value) => value?.toLowerCase().includes(needle));
  });
  const busy = creating || deleting || detailLoading || busyUserId !== null;

  return <section className="workspace-content users-content" id="users">
    <div className="page-heading users-page-heading">
      <div>
        <p className="eyebrow">Access control</p>
        <h1>用户管理</h1>
        <p>创建账号、编辑资料与角色、授予 2D／3D 权限，并管理账号登录状态。</p>
      </div>
      <button className="primary-button" disabled={busy} onClick={startCreate} type="button">新建用户</button>
    </div>

    {actionError ? <p className="form-error" role="alert">{actionError}</p> : null}
    {notice ? <p className="users-notice" role="status">{notice}</p> : null}

    <div className="users-layout">
      <section className="users-panel" aria-labelledby="users-list-title">
        <div className="users-panel-heading">
          <div><h2 id="users-list-title">账号列表</h2><p>{activeCount} 个启用 · {deletedCount} 个已删除</p></div>
          <button className="secondary-button" disabled={loading} onClick={() => void loadUsers()} type="button">刷新</button>
        </div>
        <div className="users-toolbar">
          <input aria-label="搜索用户" onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名、账号或邮箱" type="search" value={query} />
          <div className="users-filters" role="group" aria-label="账号状态">
            {(["active", "deleted", "all"] as const).map((value) => <button
              aria-pressed={filter === value} className={filter === value ? "is-active" : ""}
              key={value} onClick={() => setFilter(value)} type="button"
            >{value === "active" ? "启用" : value === "deleted" ? "已删除" : "全部"}</button>)}
          </div>
          <p className="users-toolbar-note">列表中的模块开关立即生效；右侧修改需点击保存。</p>
        </div>
        {loading ? <p className="users-loading">正在读取账号…</p> : null}
        {loadError ? <div className="state-card error-state"><h2>账号加载失败</h2><p>{loadError}</p><button className="secondary-button" onClick={() => void loadUsers()} type="button">重试</button></div> : null}
        {!loading && !loadError && visibleUsers.length === 0 ? <p className="users-loading">没有符合条件的账号。</p> : null}
        {!loading && !loadError ? <div className="users-list">{visibleUsers.map((user) => <article className={`users-row${selected?.id === user.id ? " is-selected" : ""}`} key={user.id}>
          <div className="users-identity">
            <strong>{user.displayName}{user.id === currentUserId ? <small>（当前账号）</small> : null}</strong>
            <span>{user.loginName ?? user.email} · {roleName[user.role]}{user.active ? "" : " · 已删除"}</span>
            {user.loginName ? <small>{user.email}</small> : null}
          </div>
          <div className="users-row-actions">
            <div className="users-grants" aria-label={`${user.displayName}的模块权限`}>
              {(["2d", "3d"] as const).map((module) => <label key={module}>
                <input
                  checked={user.modules.includes(module)}
                  disabled={busy || user.role === "platform_admin" || !user.active}
                  onChange={() => void updateModule(user, module)}
                  type="checkbox"
                />
                <span>{module.toUpperCase()}</span>
              </label>)}
              {user.role === "platform_admin" ? <small>管理员固定拥有两个模块</small> : null}
            </div>
            <button className="secondary-button" disabled={busy} onClick={() => void selectUser(user)} type="button">管理</button>
          </div>
        </article>)}</div> : null}
      </section>

      <section className="users-panel users-editor" aria-labelledby="users-create-title">
        <div className="users-panel-heading"><div><h2 id="users-create-title">{selected ? selected.active ? "编辑用户" : "已删除账号" : "创建账号"}</h2>
          <p>{selected ? selected.active ? `正在管理 ${selected.displayName}` : "账号已停用，历史记录保留。" : "新账号需明确选择模块；不勾选时无法访问项目。"}</p></div></div>
        {detailLoading ? <p className="users-loading">正在读取账号详情…</p> : null}
        {!detailLoading && selected && !selected.active ? <div className="users-deleted-detail">
          <p><strong>{selected.displayName}</strong>（{selected.loginName ?? selected.email}）已无法登录，已有会话已撤销。</p>
          <button className="primary-button" disabled={deleting} onClick={() => void restoreUser()} type="button">{deleting ? "正在恢复…" : "恢复账号"}</button>
        </div> : null}
        {!detailLoading && (!selected || selected.active) ? <form className="users-create-form" onSubmit={(event) => void createUser(event)}>
          <label><span>显示名称</span><input autoComplete="name" disabled={busy} maxLength={80} minLength={2} onChange={(event) => setDisplayName(event.target.value)} required value={displayName} /></label>
          <label><span>登录账号</span><input autoComplete="username" disabled={busy} maxLength={64} minLength={3} onChange={(event) => setLoginName(event.target.value)} pattern="[a-z][a-z0-9._-]*" required value={loginName} /></label>
          <label><span>邮箱</span><input autoComplete="email" disabled={busy} maxLength={254} onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></label>
          <label><span>{selected ? "重设密码（留空则不修改）" : "初始密码"}</span><input autoComplete="new-password" disabled={busy} maxLength={256} minLength={12} onChange={(event) => setPassword(event.target.value)} required={!selected} type="password" value={password} /></label>
          <label><span>全局角色</span><Select disabled={busy || selected?.id === currentUserId} onValueChange={(value) => { const next = value as Role; setRole(next); if (next === "platform_admin") setModules(["2d", "3d"]); }} value={role}>
            <option value="viewer">只读用户</option>
            <option value="delivery_manager">交付负责人</option>
            <option value="platform_admin">平台管理员</option>
          </Select></label>
          <fieldset className="users-create-modules" disabled={busy || role === "platform_admin"}>
            <legend>可访问模块</legend>
            {(["2d", "3d"] as const).map((module) => <label key={module}>
              <input checked={modules.includes(module)} onChange={(event) => setModule(module, event.target.checked)} type="checkbox" />
              <span>{module === "2d" ? "2D 看板" : "3D 场景"}</span>
            </label>)}
            <small>{role === "platform_admin" ? "平台管理员固定拥有两个模块及全局项目权限。" : "模块授权控制可进入的项目类型；项目成员角色继续决定项目内操作。"}</small>
          </fieldset>
          <button className="primary-button" disabled={busy} type="submit">{creating ? "正在保存…" : selected ? "保存修改" : "创建账号"}</button>
        </form> : null}
        {selected?.active && !detailLoading ? <div className="users-danger-zone">
          <h3>删除账号</h3>
          <p>删除后立即阻止登录并撤销会话，保留项目与审计记录；可从“已删除”列表恢复。</p>
          {selected.id === currentUserId ? <p className="users-protected-note">当前账号不能删除自己。</p>
            : confirmDelete ? <div className="users-delete-confirm">
              <button className="danger-button" disabled={deleting} onClick={() => void deleteUser()} type="button">{deleting ? "正在删除…" : `确认删除 ${selected.displayName}`}</button>
              <button className="secondary-button" disabled={deleting} onClick={() => setConfirmDelete(false)} type="button">取消</button>
            </div> : <button className="danger-button" disabled={busy} onClick={() => setConfirmDelete(true)} type="button">删除账号</button>}
        </div> : null}
      </section>
    </div>
  </section>;
}
