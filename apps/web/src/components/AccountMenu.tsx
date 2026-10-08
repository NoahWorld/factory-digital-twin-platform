import { useEffect, useId, useRef, useState } from "react";

type AccountMenuProps = {
  displayName: string;
  roleLabel: string;
  loggingOut: boolean;
  onLogout: () => void;
};

export function AccountMenu({ displayName, roleLabel, loggingOut, onLogout }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const logout = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    logout.current?.focus();
    const closeOutside = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("focusin", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="account-menu" ref={root}>
      <button
        aria-controls={open ? `${id}-menu` : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`账号菜单：${displayName}`}
        className="account-menu-trigger"
        id={`${id}-trigger`}
        onClick={() => setOpen(value => !value)}
        onKeyDown={event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            logout.current?.focus();
          }
        }}
        ref={trigger}
        title={displayName}
        type="button"
      >
        <span className="user-avatar" aria-hidden="true">{displayName.trim().slice(0, 1)}</span>
        <svg aria-hidden="true" className="account-menu-chevron" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" /></svg>
      </button>
      {open ? (
        <div className="account-menu-popup">
          <div className="account-menu-identity">
            <strong>{displayName}</strong>
            <span>{roleLabel}</span>
          </div>
          <div aria-labelledby={`${id}-trigger`} id={`${id}-menu`} role="menu">
            <button
              aria-disabled={loggingOut}
              className="account-menu-logout"
              onClick={() => { if (!loggingOut) onLogout(); }}
              onKeyDown={event => {
                if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) event.preventDefault();
              }}
              ref={logout}
              role="menuitem"
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 4H5v16h5M9 12h12m-4-4 4 4-4 4" /></svg>
              {loggingOut ? "退出中…" : "退出登录"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
