import { canvasTemplates, type CanvasTemplateId } from "./templates";

type TemplateDialogProps = {
  editable: boolean;
  onApply: (templateId: CanvasTemplateId) => void;
  onClose: () => void;
};

export function TemplateDialog({ editable, onApply, onClose }: TemplateDialogProps) {
  return (
    <div className="template-dialog-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-labelledby="template-dialog-title"
        aria-modal="true"
        className="template-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="template-dialog-header">
          <div>
            <span className="eyebrow">Dashboard templates</span>
            <h2 id="template-dialog-title">选择大屏模板</h2>
            <p>套用后会替换当前画布布局，但不会自动保存；确认效果后再点击“保存画布”。</p>
          </div>
          <button aria-label="关闭模板选择器" className="icon-button" onClick={onClose} type="button">×</button>
        </header>
        <div className="template-dialog-notice">
          <strong>模板数据均为示例</strong>
          <span>所有初始指标都会显示“示例数据”标识。装备保障模板会复用画布中首个 3D 模型资源。</span>
        </div>
        <div className="template-gallery">
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
                使用此模板
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
