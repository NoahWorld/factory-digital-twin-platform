import { useEffect, useRef, useState } from "react";
import { findBuiltinModel } from "../../../../shared/builtin-models";
import type { ModelAsset } from "./model-assets";

/** List previews never load GLB files or create a WebGL context. */
export function ModelAssetThumbnail({ asset, name, onPreview }: {
  asset: ModelAsset;
  name: string;
  onPreview: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  const thumbnail = findBuiltinModel(asset.id)?.thumbnailPath;
  useEffect(() => {
    const button = buttonRef.current;
    if (!button || !thumbnail) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "96px" });
    observer.observe(button);
    return () => observer.disconnect();
  }, [thumbnail]);
  return (
    <button aria-label={`预览 ${name}`} className="model-asset-thumbnail" onClick={onPreview} ref={buttonRef} title={`查看 ${name} 的 3D 预览`} type="button">
      {thumbnail && !failed ? visible ? (
        <img alt={`${name} 缩略图`} decoding="async" draggable={false} height={64} loading="lazy" onError={() => {
          console.error("Model thumbnail failed to load.", { modelAssetId: asset.id, thumbnail });
          setFailed(true);
        }} src={thumbnail} width={64} />
      ) : <span>缩略图</span> : <span>{failed ? "缩略图加载失败" : "暂无缩略图"}<small>点击预览</small></span>}
    </button>
  );
}
