import { useState } from "react";
import type { FluidKind } from "../../../../shared/fluids";
import type { DecorationKind } from "../../../../shared/scene-decorations";
import { ModelAssetThumbnail } from "../canvas/ModelAssetThumbnail";
import { formatFileSize, type ModelAsset } from "../canvas/model-assets";
import { decorationLibraryItems, fluidLibraryItems, modelAssetCategory, modelLibraryCategories, type ModelLibraryCategory } from "./model-library";
import "./scene-model-library.css";

type Props = {
  models: ModelAsset[];
  disabled: boolean;
  decorationsDisabled: boolean;
  fluidsDisabled: boolean;
  extrasSupported: boolean;
  modelName: (asset: ModelAsset) => string;
  onPreview: (asset: ModelAsset) => void;
  onAddModel: (asset: ModelAsset) => void;
  onAddDecoration: (kind: DecorationKind) => void;
  onAddFluid: (kind: FluidKind) => void;
};

export function SceneModelLibrary({ models, disabled, decorationsDisabled, fluidsDisabled, extrasSupported, modelName, onPreview, onAddModel, onAddDecoration, onAddFluid }: Props) {
  const [category, setCategory] = useState<ModelLibraryCategory>("all");
  const count = (id: ModelLibraryCategory) => models.filter((asset) => id === "all" || modelAssetCategory(asset) === id).length
    + decorationLibraryItems.filter((item) => id === "all" || item.category === id).length
    + (id === "all" || id === "fluids" ? fluidLibraryItems.length : 0);
  const groupOrder: ModelLibraryCategory[] = ["industrial", "plants", "water", "fluids", "military", "uploaded", "background"];
  const groups = modelLibraryCategories.filter((item) => item.id !== "all" && (category === "all" || item.id === category)).sort((a, b) => groupOrder.indexOf(a.id) - groupOrder.indexOf(b.id));
  return <>
    <div className="standalone-library-categories" role="group" aria-label="模型分类">
      {modelLibraryCategories.map((item) => <button key={item.id} type="button" aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>
        {item.label}<span>{count(item.id)}</span>
      </button>)}
    </div>
    <p className="standalone-panel-copy">选择分类查找模型，点击 ＋ 加入场景。模型缩略图可点击预览。</p>
    {!extrasSupported ? <p className="standalone-panel-copy" role="status">当前服务暂不支持添加植物、水景和军事模型。</p> : null}
    {groups.map((group) => {
      const resources = models.filter((asset) => modelAssetCategory(asset) === group.id);
      const decorations = decorationLibraryItems.filter((item) => item.category === group.id);
      const fluids = group.id === "fluids" ? fluidLibraryItems : [];
      const total = resources.length + decorations.length + fluids.length;
      if (category === "all" && total === 0) return null;
      return <section className="standalone-library-group" aria-label={group.label} key={group.id}>
        <h3>{group.label}<span>{total}</span></h3>
        <div className="standalone-model-list">
          {fluids.map((item) => <article key={item.kind} data-fluid-kind={item.kind}>
            <span className="standalone-procedural-icon is-fluid" aria-hidden="true">{item.icon}</span>
            <div><strong>{item.name}</strong><span>{item.description}</span></div>
            <button aria-label={`加入场景 ${item.name}`} className="icon-button" disabled={fluidsDisabled} onClick={() => onAddFluid(item.kind)} title="加入场景并绘制路径" type="button">＋</button>
          </article>)}
          {decorations.map((item) => <article key={item.kind} data-decoration-kind={item.kind}>
            <span className={`standalone-procedural-icon is-${item.category}`} aria-hidden="true">{item.icon}</span>
            <div><strong>{item.name}</strong><span>{item.description}</span></div>
            <button aria-label={`加入场景 ${item.name}`} className="icon-button" disabled={disabled || decorationsDisabled || !extrasSupported} onClick={() => onAddDecoration(item.kind)} title="加入场景" type="button">＋</button>
          </article>)}
          {resources.map((asset) => <article key={asset.id} data-model-asset-id={asset.id}>
            <ModelAssetThumbnail asset={asset} name={modelName(asset)} onPreview={() => onPreview(asset)} />
            <div><strong title={modelName(asset)}>{modelName(asset)}</strong><span>{formatFileSize(asset.byteSize)}</span></div>
            <button aria-label={`加入场景 ${modelName(asset)}`} className="icon-button" disabled={disabled} onClick={() => onAddModel(asset)} title="加入场景" type="button">＋</button>
          </article>)}
        </div>
        {total === 0 ? <p className="standalone-library-empty">暂无{group.label}。{group.id === "uploaded" ? "点击上方“上传模型”添加。" : group.id === "background" ? "可在资源库中创建场景底座。" : ""}</p> : null}
      </section>;
    })}
  </>;
}
