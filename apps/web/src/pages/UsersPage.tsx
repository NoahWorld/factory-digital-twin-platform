import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Select } from "../components/Select";
import { useNotifications } from "../components/NotificationProvider";
import { errorMessage, request } from "../api";
import "./UsersPage.css";

type Module = "2d" | "3d";
type Role = "platform_admin" | "delivery_manager" | "viewer";
type ManagedUser = {
  id: string; email: string; loginName: string | null; displayName: string;
  role: Role; modules: Module[]; active: boolean;
};
const roleName: Record<Role, string> = {
  platform_admin: "平台管理员", delivery_manager: "交付负责人", viewer: "只读用户",
};

export function UsersPage({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  // undefined closes the editor; null opens a new, empty account.
  const [editorUser, setEditorUser] = useState<ManagedUser | null>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"active" | "deleted" | "all">("active");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const createButton = useRef<HTMLButtonElement>(null);

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

  const activeCount = users.filter((user) => user.active).length;
  const counts = { active: activeCount, deleted: users.length - activeCount, all: users.length };
  const visibleUsers = users.filter((user) => {
    if (filter === "active" && !user.active) return false;
    if (filter === "deleted" && user.active) return false;
    const needle = query.trim().toLowerCase();
    return !needle || [user.displayName, user.loginName, user.email]
      .some((value) => value?.toLowerCase().includes(needle));
  });

  return <section aria-label="用户管理" className="workspace-content users-content" id="users">
    <div className="users-toolbar">
      <div className="users-search">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>
        <input aria-label="搜索用户" onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名、账号或邮箱" type="search" value={query} />
      </div>
      <div className="users-filters" role="group" aria-label="账号状态">
        {(["active", "deleted", "all"] as const).map((value) => <button
          aria-pressed={filter === value} className={filter === value ? "is-active" : ""}
          key={value} onClick={() => setFilter(value)} type="button"
        >{value === "active" ? "启用" : value === "deleted" ? "已删除" : "全部"}<span>{loading || loadError ? "—" : counts[value]}</span></button>)}
      </div>
      <button className="secondary-button users-refresh" disabled={loading} onClick={() => void loadUsers()} type="button">刷新</button>
      <button ref={createButton} className="primary-button users-create-button" onClick={() => setEditorUser(null)} type="button">
        <span aria-hidden="true">＋</span>新建用户
      </button>
    </div>

    {loading ? <div className="users-empty" role="status"><p>正在读取账号…</p></div> : loadError ?
      <div className="users-empty error-state" role="alert"><h2>账号加载失败</h2><p>{loadError}</p><button className="secondary-button" onClick={() => void loadUsers()} type="button">重试</button></div> :
      visibleUsers.length === 0 ? <div className="users-empty"><h2>没有符合条件的用户</h2><p>{query ? "试试其他姓名、账号或邮箱。" : filter === "deleted" ? "暂时没有已删除的账号。" : "可以切换筛选条件，或新建一个用户。"}</p></div> :
      <div className="users-grid" aria-label="用户列表">{visibleUsers.map((user) => <button
        className={`user-card${user.active ? "" : " is-deleted"}`} key={user.id} type="button"
        aria-label={`设置用户 ${user.displayName}`} aria-haspopup="dialog" onClick={() => setEditorUser(user)}
      >
        <span className="user-card-header">
          <span className="user-card-avatar" data-role={user.role} aria-hidden="true">{Array.from(user.displayName.trim())[0]}</span>
          <span className="user-card-identity">
            <span className="user-card-name"><strong title={user.displayName}>{user.displayName}</strong>{user.id === currentUserId ? <span className="user-current">我</span> : null}</span>
            <span className="user-card-login" title={user.loginName ?? user.email}>{user.loginName ?? user.email}</span>
          </span>
        </span>
        <span className="user-card-email" title={user.email}>{user.email}</span>
        <span className="user-card-meta">
          <span className="user-role" data-role={user.role}>{roleName[user.role]}</span>
          <span className={`user-status${user.active ? " is-active" : ""}`}>{user.active ? "启用" : "已删除"}</span>
        </span>
        <span className="user-card-footer">
          <span className="user-modules" aria-label="可访问模块">{user.modules.length ? user.modules.map((module) => <span key={module}>{module === "2d" ? "2D 看板" : "3D 场景"}</span>) : <span className="is-empty">未授权模块</span>}</span>
          <span className="user-card-settings">设置 <span aria-hidden="true">↗</span></span>
        </span>
      </button>)}</div>}

    {editorUser !== undefined ? <UserSettingsDialog user={editorUser} currentUserId={currentUserId}
      onClose={() => setEditorUser(undefined)} fallbackFocus={() => createButton.current?.focus()}
      onSaved={(user, created) => {
        setUsers((current) => created ? [...current, user] : current.map((item) => item.id === user.id ? user : item));
        if (created) { setQuery(""); setFilter("active"); }
        setEditorUser(undefined);
      }} /> : null}
  </section>;
}

function UserSettingsDialog({ user, currentUserId, onClose, onSaved, fallbackFocus }: {
  user: ManagedUser | null; currentUserId: string; onClose: () => void;
  onSaved: (user: ManagedUser, created?: boolean) => void; fallbackFocus: () => void;
}) {
  const notify = useNotifications();
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(user);
  const [detailLoading, setDetailLoading] = useState(Boolean(user));
  const [detailError, setDetailError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [email, setEmail] = useState("");
  const [loginName, setLoginName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [modules, setModules] = useState<Module[]>([]);
  const busy = saving || deleting;
  const ready = !detailLoading && !detailError;

  useLayoutEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      // Wait until the list update removes a deleted/filtered card before restoring focus.
      queueMicrotask(() => {
        if (element.open) return;
        if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
        else fallbackFocus();
      });
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    const load = async () => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const result = await request<{ user: ManagedUser }>(`/api/v1/users/${encodeURIComponent(user.id)}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setSelected(result.user);
        setEmail(result.user.email);
        setLoginName(result.user.loginName ?? "");
        setDisplayName(result.user.displayName);
        setRole(result.user.role);
        setModules(result.user.modules);
      } catch (reason) {
        // Closing the dialog intentionally cancels its read; real failures stay visible.
        if (!controller.signal.aborted) setDetailError(errorMessage(reason));
      } finally {
        if (!controller.signal.aborted) setDetailLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [user, retry]);

  const setModule = (module: Module, enabled: boolean) => {
    setModules((current) => enabled
      ? (["2d", "3d"] as const).filter((candidate) => candidate === module || current.includes(candidate))
      : current.filter((candidate) => candidate !== module));
  };

  const saveUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !ready) return;
    setSaving(true);
    try {
      const payload = { email, loginName, displayName, role,
        modules: role === "platform_admin" ? ["2d", "3d"] : modules,
        ...(password ? { password } : {}) };
      if (selected) {
        const result = await request<{ user: ManagedUser }>(`/api/v1/users/${encodeURIComponent(selected.id)}`, {
          method: "PUT", body: JSON.stringify(payload),
        });
        notify.success(`已保存“${result.user.displayName}”的资料和权限。${password ? "原有会话已撤销。" : ""}`);
        onSaved(result.user);
        if (selected.id === currentUserId) window.location.reload();
      } else {
        const result = await request<{ user: {
          id: string; email: string; loginName: string | null; displayName: string;
          roles: Role[]; modules: Module[];
        } }>("/api/v1/users", { method: "POST", body: JSON.stringify(payload) });
        if (result.user.roles.length !== 1) throw new Error("新账号的全局角色数量异常。");
        const created: ManagedUser = { ...result.user, role: result.user.roles[0], active: true };
        notify.success(`已创建账号“${created.displayName}”。`);
        onSaved(created, true);
      }
    } catch (reason) {
      notify.error(reason);
    } finally {
      setSaving(false);
    }
  };

  const deleteUser = async () => {
    if (!selected || selected.id === currentUserId || busy) return;
    setDeleting(true);
    try {
      await request<void>(`/api/v1/users/${encodeURIComponent(selected.id)}`, { method: "DELETE" });
      notify.success(`已删除“${selected.displayName}”的登录权限，关联记录仍保留。`);
      onSaved({ ...selected, active: false });
    } catch (reason) {
      notify.error(reason);
    } finally {
      setDeleting(false);
    }
  };

  const restoreUser = async () => {
    if (!selected || busy) return;
    setDeleting(true);
    try {
      const result = await request<{ user: ManagedUser }>(`/api/v1/users/${encodeURIComponent(selected.id)}/restore`, { method: "POST" });
      notify.success(`已恢复“${result.user.displayName}”的登录权限。`);
      onSaved(result.user);
    } catch (reason) {
      notify.error(reason);
    } finally {
      setDeleting(false);
    }
  };

  return <dialog ref={dialog} className="users-dialog" aria-labelledby="users-editor-title" aria-describedby="users-editor-description"
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="users-dialog-header">
      <div><h2 id="users-editor-title">{selected ? "用户设置" : "新建用户"}</h2><p id="users-editor-description">{selected ? selected.displayName : "创建账号，分配角色与模块权限。"}</p></div>
      <button className="users-dialog-close" aria-label="关闭用户设置" disabled={busy} onClick={onClose} type="button">×</button>
    </header>
    <div className="users-dialog-body" aria-busy={detailLoading}>
      {detailLoading ? <p className="users-loading" role="status">正在读取账号详情…</p> : detailError ?
        <div className="users-detail-error" role="alert"><p>{detailError}</p><button className="secondary-button" onClick={() => setRetry((value) => value + 1)} type="button">重试</button></div> : null}
      {ready && selected && !selected.active ? <div className="users-deleted-detail">
        <span className="user-status">已删除</span><h3>此账号已停用</h3>
        <p>{selected.loginName ?? selected.email} 已无法登录，项目与历史记录仍保留。恢复后可继续编辑资料与权限。</p>
      </div> : null}
      {ready && (!selected || selected.active) ? <>
        <form id="users-settings-form" className="users-create-form" onSubmit={(event) => void saveUser(event)}>
          <section className="users-form-section" aria-labelledby="users-basic-title">
            <h3 id="users-basic-title">基本资料</h3>
            <div className="users-fields">
              <label><span>显示名称</span><input autoComplete="name" disabled={busy} maxLength={80} minLength={2} onChange={(event) => setDisplayName(event.target.value)} required value={displayName} placeholder="输入用户名称" /></label>
              <label><span>登录账号</span><input autoComplete="username" disabled={busy} maxLength={64} minLength={3} onChange={(event) => setLoginName(event.target.value)} pattern="[a-z][a-z0-9._-]*" required value={loginName} placeholder="小写字母开头" /><small>3–64 位，可含数字、点、下划线和短横线</small></label>
              <label><span>邮箱</span><input autoComplete="email" disabled={busy} maxLength={254} onChange={(event) => setEmail(event.target.value)} required type="email" value={email} placeholder="name@example.com" /></label>
              <label><span>{selected ? "重设密码" : "初始密码"}</span><input autoComplete="new-password" disabled={busy} maxLength={256} minLength={12} onChange={(event) => setPassword(event.target.value)} required={!selected} type="password" value={password} placeholder={selected ? "留空则不修改" : "至少 12 个字符"} /><small>{selected ? "修改需至少 12 个字符，将撤销原有会话" : "请设置至少 12 个字符的密码"}</small></label>
            </div>
          </section>
          <section className="users-form-section" aria-labelledby="users-access-title">
            <h3 id="users-access-title">角色与权限</h3>
            <label><span>全局角色</span><Select disabled={busy || selected?.id === currentUserId} onValueChange={(value) => { const next = value as Role; setRole(next); if (next === "platform_admin") setModules(["2d", "3d"]); }} value={role}>
              <option value="viewer">只读用户</option><option value="delivery_manager">交付负责人</option><option value="platform_admin">平台管理员</option>
            </Select></label>
            {selected?.id === currentUserId ? <p className="users-field-note">当前账号的管理员角色不可修改。</p> : null}
            <fieldset className="users-create-modules" disabled={busy || role === "platform_admin"}>
              <legend>可访问模块</legend>
              {(["2d", "3d"] as const).map((module) => <label key={module}>
                <input checked={modules.includes(module)} onChange={(event) => setModule(module, event.target.checked)} type="checkbox" />
                <span>{module === "2d" ? "2D 看板" : "3D 场景"}</span>
              </label>)}
            </fieldset>
            <p className="users-field-note">{role === "platform_admin" ? "平台管理员固定拥有两个模块及全局项目权限。" : modules.length ? "项目内的操作权限由项目成员角色决定。" : "尚未授权模块，此账号将无法访问 2D 或 3D 项目。"}</p>
          </section>
        </form>
        {selected ? <section className="users-danger-zone" aria-label="删除账号">
          <div><h3>删除账号</h3><p>{selected.id === currentUserId ? "当前账号不能删除自己。" : "立即停用并撤销会话，保留项目记录，可恢复。"}</p></div>
          {selected.id !== currentUserId ? confirmDelete ? <div className="users-delete-confirm">
            <button className="danger-button" disabled={busy} onClick={() => void deleteUser()} type="button">{deleting ? "正在删除…" : `确认删除 ${selected.displayName}`}</button>
            <button className="secondary-button" disabled={busy} onClick={() => setConfirmDelete(false)} type="button">取消删除</button>
          </div> : <button className="users-delete-button" disabled={busy} onClick={() => setConfirmDelete(true)} type="button">删除账号</button> : null}
        </section> : null}
      </> : null}
    </div>
    <footer className="users-dialog-footer">
      <button className="secondary-button" disabled={busy} onClick={onClose} type="button">取消</button>
      {ready ? selected && !selected.active ? <button className="primary-button" disabled={busy} onClick={() => void restoreUser()} type="button">{deleting ? "正在恢复…" : "恢复账号"}</button> :
        <button className="primary-button" disabled={busy || confirmDelete} form="users-settings-form" type="submit">{saving ? "正在保存…" : selected ? "保存修改" : "创建账号"}</button> : null}
    </footer>
  </dialog>;
}
