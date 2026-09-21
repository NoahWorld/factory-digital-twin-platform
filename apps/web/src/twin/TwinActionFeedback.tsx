import { useEffect, useId, useRef } from "react";
import type { TwinActionMessage } from "./useTwinActions";

/** Keep this inside the fullscreen stage: a body portal would disappear in fullscreen. */
export function TwinActionFeedback({ messages, error, onDismissMessage, onDismissError }: {
  messages: readonly TwinActionMessage[];
  error: string | null;
  onDismissMessage: () => void;
  onDismissError: () => void;
}) {
  const titleId = useId();
  const contentId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const visible = Boolean(error || messages.length);
  const message = messages[0];
  const dismiss = error ? onDismissError : onDismissMessage;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!visible || !dialog) return;
    const previousFocus = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [visible]);
  if (!visible) return null;
  return (
    <dialog aria-describedby={contentId} aria-label={!error && !message.title ? "交互消息" : undefined} aria-labelledby={error || message.title ? titleId : undefined} className={`twin-action-feedback${error ? " is-error" : ""}`} onCancel={(event) => { event.preventDefault(); dismiss(); }} ref={dialogRef}>
      <header><h2 id={titleId}>{error ? "交互执行失败" : message.title}</h2><button aria-label="关闭消息" className="dialog-close" onClick={dismiss} type="button">×</button></header>
      <p className="twin-action-feedback-content" id={contentId} role={error ? "alert" : undefined}>{error ?? message.text}</p>
      <footer><button className="primary-button" onClick={dismiss} type="button">{!error && messages.length > 1 ? `下一条（剩余 ${messages.length - 1} 条）` : "关闭"}</button></footer>
    </dialog>
  );
}
