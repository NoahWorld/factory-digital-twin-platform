import { canvasTemplates, type CanvasTemplateId } from "./templates";

type CanvasTemplateGalleryProps = {
  actionLabel?: string;
  className?: string;
  editable: boolean;
  onApply: (templateId: CanvasTemplateId) => void;
};

export function CanvasTemplateGallery({
  actionLabel = "使用此模板",
  className = "",
  editable,
  onApply,
}: CanvasTemplateGalleryProps) {
  return (
    <div className={`template-gallery${className ? ` ${className}` : ""}`}>
      {canvasTemplates.map((template) => (
        <article className={`template-card is-${template.theme}`} key={template.id}>
          <div aria-hidden="true" className="template-card-preview">
            <span className="template-preview-title" />
            <span className="template-preview-metric metric-one" />
            <span className="template-preview-metric metric-two" />
            <span className="template-preview-metric metric-three" />
            <span className="template-preview-panel panel-one" />
            <span className="template-preview-panel panel-two" />
            <span className="template-preview-panel panel-three" />
          </div>
          <div className="template-card-copy">
            <span>{template.category}</span>
            <h3>{template.name}</h3>
            <p>{template.description}</p>
            <small>{template.componentSummary}</small>
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
