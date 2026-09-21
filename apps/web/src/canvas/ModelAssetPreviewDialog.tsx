import { useEffect, useMemo, useRef } from "react";
import { findBuiltinModel } from "../../../../shared/builtin-models";
import { Model3DNode } from "./Model3DNode";
import { formatFileSize, type ModelAsset } from "./model-assets";
import { createCanvasNode } from "./types";

const ignoreSelection = () => undefined;

/** Mounted only for the selected model; unmount releases the renderer and model. */
export function ModelAssetPreviewDialog({ asset, name, onClose, projectId }: {
  asset: ModelAsset;
  name: string;
  onClose: () => void;
  projectId: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const node = useMemo(() => {
    const base = createCanvasNode("model-3d", 0, 0, 1);
    return {
      ...base,
      width: 960,
      height: 540,
      resourceRefs: [asset.id],
      props: {
        ...base.props,
        ...findBuiltinModel(asset.id)?.defaults,
        ...(asset.source === "scene-background" ? { cameraView: "front", modelScale: 2.2 } : {}),
        autoRotate: false,
        playAnimations: false,
        showGrid: false,
      },
    };
  }, [asset.id, asset.source]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <dialog aria-labelledby="model-preview-title" className="resource-preview-dialog model-asset-preview-dialog" onCancel={onClose} ref={dialogRef}>
      <header>
        <div><p className="eyebrow">3D 预览</p><h2 id="model-preview-title">{name}</h2></div>
        <button aria-label="关闭模型预览" className="dialog-close" onClick={onClose} type="button">×</button>
      </header>
      <div className="resource-preview-stage is-model">
        <Model3DNode cameraControlsEnabled editable={false} node={node} onSceneNodeSelect={ignoreSelection} projectId={projectId} runtimeControlsEnabled={false} selectedSceneNodePath={null} />
      </div>
      <footer><span>{asset.format.toUpperCase()} · {formatFileSize(asset.byteSize)} · 拖动旋转，滚轮缩放</span><button className="secondary-button" onClick={onClose} type="button">关闭</button></footer>
    </dialog>
  );
}
