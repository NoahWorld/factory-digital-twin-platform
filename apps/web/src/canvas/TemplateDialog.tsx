import { CanvasTemplateGallery } from "./CanvasTemplateGallery";
import type { CanvasTemplateId } from "./templates";

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
        <CanvasTemplateGallery editable={editable} onApply={onApply} />
      </section>
    </div>
  );
}
