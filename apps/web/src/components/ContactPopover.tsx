import { useEffect, useId, useRef, useState } from "react";
import "./ContactPopover.css";

const qrCodeUrl = `${import.meta.env.BASE_URL}branding/contact-qr.jpg`;

export function ContactPopover() {
  const [mode, setMode] = useState<"hover" | "click" | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const open = mode !== null;

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setMode(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMode(null);
      // Hover never moves focus away from the user's current control.
      if (root.current?.contains(document.activeElement)) trigger.current?.focus();
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
    <div
      className="contact-popover"
      onPointerEnter={event => { if (event.pointerType === "mouse") setMode(value => value ?? "hover"); }}
      onPointerLeave={() => setMode(value => value === "hover" ? null : value)}
      ref={root}
    >
      <button
        aria-controls={`${id}-panel`}
        aria-expanded={open}
        className="contact-popover-trigger"
        onClick={() => setMode(value => value === "click" ? null : "click")}
        ref={trigger}
        type="button"
      >
        <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H8l-5 3v-7.5a7.5 7.5 0 0 1 7.5-7.5h2a7.5 7.5 0 0 1 7.5 4.5Z" />
          <path d="M8 4a8 8 0 0 1 13 3M8 12h7m-7 3h4" />
        </svg>
        联系我们
      </button>
      <div className="contact-popover-panel" hidden={!open} id={`${id}-panel`} role="region" aria-label="联系二维码">
        <div className="contact-popover-card">
          <strong>联系我们</strong>
          <p>扫码联系，了解更多产品信息</p>
          <img
            alt="联系我们二维码"
            height={344}
            onError={() => {
              console.error("Contact QR image failed to load", { src: qrCodeUrl });
              setImageFailed(true);
            }}
            src={qrCodeUrl}
            width={344}
          />
          {imageFailed ? <p className="contact-popover-error" role="alert">二维码加载失败，请刷新后重试。</p> : null}
        </div>
      </div>
    </div>
  );
}
