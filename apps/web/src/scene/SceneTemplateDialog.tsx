import { useEffect, useRef, useState } from "react";
import { SceneTemplateGallery } from "./SceneTemplateGallery";
import { getSceneTemplate, type SceneTemplateId } from "./scene-templates";

export function SceneTemplateDialog({ editable, error, onApply, onClose }: {
  editable: boolean;
  error: string | null;
  onApply: (templateId: SceneTemplateId) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmationRef = useRef<HTMLHeadingElement>(null);
  const [selectedId, setSelectedId] = useState<SceneTemplateId | null>(null);
  useEffect(() => {
    if (selectedId) confirmationRef.current?.focus();
  }, [selectedId]);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  return <dialog aria-labelledby="scene-template-dialog-title" className="scene-template-dialog" ref={dialogRef} onCancel={onClose} onClick={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <div className="scene-template-dialog-content">
      <header className="template-dialog-header">
        <div><span className="eyebrow">Scene templates</span><h2 id="scene-template-dialog-title">选择 3D 场景模板</h2><p>套用模板只修改当前草稿，确认效果后再保存场景。</p></div>
        <button aria-label="关闭场景模板" className="icon-button" onClick={onClose} type="button">×</button>
      </header>
      <SceneTemplateGallery editable={editable} onApply={setSelectedId} actionLabel="选择模板" />
      {selectedId ? <section className="scene-template-confirm" aria-label="确认套用模板">
        <h3 ref={confirmationRef} tabIndex={-1}>套用“{getSceneTemplate(selectedId).name}”？</h3>
        <p>将替换当前草稿的全部模型、布局、灯光和动画设置，当前未保存修改会被替换。项目名称和 2D 项目关联保持不变；模板不绑定真实业务资产。</p>
        <div className="dialog-actions">
          <button className="secondary-button" onClick={() => setSelectedId(null)} type="button">取消</button>
          <button className="primary-button" disabled={!editable} onClick={() => onApply(selectedId)} type="button">确认替换草稿</button>
        </div>
      </section> : null}
      {error ? <p className="error-message" role="alert">{error}</p> : null}
    </div>
  </dialog>;
}
