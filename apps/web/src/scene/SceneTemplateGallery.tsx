import { useState } from "react";
import { findBuiltinModel } from "../../../../shared/builtin-models";
import { sceneTemplates, type SceneTemplateId } from "./scene-templates";
import "./scene-templates.css";

function TemplateModelImage({ modelId }: { modelId: string }) {
  const model = findBuiltinModel(modelId);
  const [failed, setFailed] = useState(false);
  if (!model) throw new Error(`场景模板引用了未知模型：${modelId}`);
  return <figure>
    {failed ? <span role="status">缩略图加载失败</span> : <img alt={model.name} src={model.thumbnailPath} loading="lazy" decoding="async" draggable={false} onError={() => {
      console.error("Scene template model thumbnail failed", { modelId, path: model.thumbnailPath });
      setFailed(true);
    }} />}
    <figcaption>{model.name}</figcaption>
  </figure>;
}

export function SceneTemplateGallery({ editable, onApply, actionLabel = "使用此模板" }: {
  editable: boolean;
  onApply: (templateId: SceneTemplateId) => void;
  actionLabel?: string;
}) {
  return <div className="scene-template-gallery">
    {sceneTemplates.map((template) => <article className="scene-template-card" key={template.id}>
      <div className="scene-template-models">
        <span className="scene-template-preview-label">模板包含的模型</span>
        <div>{template.previewModelIds.map((modelId) => <TemplateModelImage key={modelId} modelId={modelId} />)}</div>
      </div>
      <div className="scene-template-copy">
        <div className="scene-template-meta"><span>3D 场景 · {template.category}</span><span>虚构演示</span></div>
        <h3>{template.name}</h3>
        <p>{template.description}</p>
        <p className="scene-template-stats">{template.instances.length} 个实例 · {new Set(template.instances.map((instance) => instance.modelAssetId)).size} 类模型 · 预设动画</p>
      </div>
      <button className="secondary-button" disabled={!editable} onClick={() => onApply(template.id)} type="button">{actionLabel}</button>
    </article>)}
  </div>;
}
