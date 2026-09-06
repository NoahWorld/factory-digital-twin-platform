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
            <div className="template-card-heading-row">
              <span>{template.code} · {template.category}</span>
              <b>{template.showcase.badge}</b>
            </div>
            <h3>{template.showcase.title}</h3>
            <p>{template.description}</p>
            <dl className="template-case-meta">
              <div>
                <dt>机构</dt>
                <dd>{template.showcase.organization}</dd>
              </div>
              <div>
                <dt>现场</dt>
                <dd>{template.showcase.location} · {template.showcase.site}</dd>
              </div>
              <div>
                <dt>形态</dt>
                <dd>{template.showcase.deliveryForm}</dd>
              </div>
            </dl>
            <small>{template.componentSummary} · {template.showcase.dataLabel}</small>
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
