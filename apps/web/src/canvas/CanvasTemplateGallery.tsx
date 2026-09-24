import { useEffect, useId, useRef, useState } from "react";
import { ToolbarIcon } from "../components/ToolbarIcon";
import { canvasTemplates, getCanvasTemplate, type CanvasTemplateId } from "./templates";
import { CanvasTemplatePreview } from "./CanvasTemplatePreview";

type CanvasTemplateGalleryProps = {
  actionLabel?: string;
  className?: string;
  editable: boolean;
  onApply: (templateId: CanvasTemplateId) => void;
  visibleTemplateIds?: readonly CanvasTemplateId[];
};

export function CanvasTemplateGallery({ actionLabel = "使用此模板", className = "", editable, onApply, visibleTemplateIds }: CanvasTemplateGalleryProps) {
  const [previewId, setPreviewId] = useState<CanvasTemplateId | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const visibleIdSet = visibleTemplateIds ? new Set(visibleTemplateIds) : null;
  const visibleTemplates = visibleIdSet ? canvasTemplates.filter(template => visibleIdSet.has(template.id)) : canvasTemplates;
  const preview = previewId ? getCanvasTemplate(previewId) : null;

  useEffect(() => {
    if (!previewId || !dialog.current) return;
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      trigger.current?.focus({ preventScroll: true });
    };
  }, [previewId]);

  const openPreview = (id: CanvasTemplateId, button: HTMLButtonElement) => {
    trigger.current = button;
    setPreviewId(id);
  };

  return <>
    <div className={`template-gallery${className ? ` ${className}` : ""}`}>
      {visibleTemplates.map(template => <article className={`template-card is-${template.theme}`} key={template.id}>
        <button className="template-card-visual" type="button" onClick={event => openPreview(template.id, event.currentTarget)} aria-label={`放大查看${template.showcase.title}`}>
          <CanvasTemplatePreview className="template-card-preview" templateId={template.id} />
          <span className="template-preview-hint"><ToolbarIcon name="preview" />查看完整案例</span>
        </button>
        <div className="template-card-copy">
          <div className="template-card-heading-row"><span>{template.code} · {template.category}</span></div>
          <h3>{template.showcase.title}</h3>
          <p>{template.description}</p>
          <ul aria-label="模板业务范围">{template.tags.map(tag => <li key={tag}>{tag}</li>)}</ul>
        </div>
        <footer className="template-card-actions">
          <button className="secondary-button" type="button" onClick={event => openPreview(template.id, event.currentTarget)}><ToolbarIcon name="preview" />查看案例</button>
          <button className="primary-button" disabled={!editable} onClick={() => onApply(template.id)} type="button"><ToolbarIcon name="template" />{actionLabel}</button>
        </footer>
      </article>)}
    </div>
    {preview && <dialog className="template-detail-dialog" ref={dialog} aria-labelledby={titleId} onCancel={() => setPreviewId(null)} onClose={() => setPreviewId(null)}>
      <header><div><span>{preview.code} / {preview.category}</span><h2 id={titleId}>{preview.showcase.title}</h2></div><button className="secondary-button" type="button" autoFocus onClick={() => setPreviewId(null)} aria-label="关闭案例预览">关闭 ×</button></header>
      <CanvasTemplatePreview templateId={preview.id} />
      <footer><div><strong>{preview.showcase.deliveryForm}</strong><p>1920 × 1080 · {preview.showcase.dataLabel} · 创建后可编辑所有组件</p></div><button className="primary-button" type="button" disabled={!editable} onClick={() => { setPreviewId(null); onApply(preview.id); }}><ToolbarIcon name="template" />{actionLabel}</button></footer>
    </dialog>}
  </>;
}
