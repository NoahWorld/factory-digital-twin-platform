import { canvasTemplates, type CanvasTemplateId } from "./templates";
import { CanvasTemplatePreview } from "./CanvasTemplatePreview";

type CanvasTemplateGalleryProps = {
  actionLabel?: string;
  className?: string;
  editable: boolean;
  onApply: (templateId: CanvasTemplateId) => void;
  visibleTemplateIds?: readonly CanvasTemplateId[];
};

export function CanvasTemplateGallery({
  actionLabel = "使用此模板",
  className = "",
  editable,
  onApply,
  visibleTemplateIds,
}: CanvasTemplateGalleryProps) {
  const visibleIdSet = visibleTemplateIds ? new Set(visibleTemplateIds) : null;
  const visibleTemplates = visibleIdSet
    ? canvasTemplates.filter((template) => visibleIdSet.has(template.id))
    : canvasTemplates;

  return (
    <div className={`template-gallery${className ? ` ${className}` : ""}`}>
      {visibleTemplates.map((template) => (
        <article className={`template-card is-${template.theme}`} key={template.id}>
          <CanvasTemplatePreview className="template-card-preview" templateId={template.id} />
          <div className="template-card-copy">
            <span>{template.code} · {template.category}</span>
            <h3>{template.name}</h3>
            <p>{template.description}</p>
            <small>{template.componentSummary}</small>
            <ul aria-label="模板业务范围">
              {template.tags.map((tag) => <li key={tag}>{tag}</li>)}
            </ul>
          </div>
          <button
            className="secondary-button"
            disabled={!editable}
            onClick={() => onApply(template.id)}
            type="button"
          >
            {actionLabel}
          </button>
        </article>
      ))}
    </div>
  );
}
