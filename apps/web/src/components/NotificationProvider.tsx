import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { errorMessage } from "../errors";

type NotificationKind = "success" | "info" | "warning" | "error";
type NotificationOptions = { key?: string };
type Notification = { id: number; kind: NotificationKind; message: string; revision: number; key?: string };
let nextId = 0;
let snapshot: Notification[] = [];
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const getSnapshot = () => snapshot;

function show(kind: NotificationKind, message: string, options?: NotificationOptions): void {
  const existing = snapshot.find((item) => options?.key ? item.key === options.key : item.kind === kind && item.message === message);
  snapshot = existing
    ? snapshot.map((item) => item === existing ? { ...item, kind, message, revision: item.revision + 1 } : item)
    : [...snapshot, { id: ++nextId, kind, message, revision: 0, key: options?.key }];
  emit();
}

/** Explicit action notifications. Request/transport code must not enqueue notifications. */
export const notifications = {
  success: (message: string, options?: NotificationOptions) => show("success", message, options),
  info: (message: string, options?: NotificationOptions) => show("info", message, options),
  warning: (message: string, options?: NotificationOptions) => show("warning", message, options),
  error: (reason: unknown, options?: NotificationOptions) => show("error", errorMessage(reason), options),
  dismiss: (id: number) => { snapshot = snapshot.filter((item) => item.id !== id); emit(); },
};
const NotificationContext = createContext<typeof notifications | null>(null);

export function useNotifications(): typeof notifications {
  const context = useContext(NotificationContext);
  if (!context) throw new Error("useNotifications requires NotificationProvider.");
  return context;
}

const symbols: Record<NotificationKind, string> = { success: "✓", info: "i", warning: "!", error: "!" };

function notificationTarget(): Element | null {
  if (typeof document === "undefined") return null;
  // Native modal dialogs make the rest of the document inert, regardless of z-index.
  const focusedDialog = document.activeElement?.closest("dialog:modal");
  const dialogs = document.querySelectorAll("dialog:modal");
  return focusedDialog ?? dialogs.item(dialogs.length - 1) ?? document.fullscreenElement ?? document.body;
}

function NotificationItem({ notification }: { notification: Notification }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (hovered || focused) return;
    const timeout = window.setTimeout(() => notifications.dismiss(notification.id),
      notification.kind === "error" || notification.kind === "warning" ? 8000 : 4000);
    return () => window.clearTimeout(timeout);
  }, [notification.id, notification.kind, notification.revision, hovered, focused]);
  return (
    <div className="notification" data-kind={notification.kind}
      role={notification.kind === "error" ? "alert" : "status"} aria-atomic="true"
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
      <span className="notification-icon" aria-hidden="true">{symbols[notification.kind]}</span>
      <p className="notification-message">{notification.message}</p>
      <button className="notification-close" type="button" aria-label="关闭通知"
        onClick={() => notifications.dismiss(notification.id)}>×</button>
    </div>
  );
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const items = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [portalTarget, setPortalTarget] = useState<Element | null>(notificationTarget);
  useEffect(() => {
    const update = () => setPortalTarget(notificationTarget());
    const observer = new MutationObserver(update);
    observer.observe(document.body, { attributes: true, attributeFilter: ["open"], childList: true, subtree: true });
    document.addEventListener("fullscreenchange", update);
    update();
    return () => {
      observer.disconnect();
      document.removeEventListener("fullscreenchange", update);
    };
  }, []);
  return (
    <NotificationContext.Provider value={notifications}>
      {children}
      {portalTarget && createPortal(
        <section className="notification-region" aria-label="通知">
          {items.map((item) => <NotificationItem key={item.id} notification={item} />)}
        </section>, portalTarget)}
    </NotificationContext.Provider>
  );
}
