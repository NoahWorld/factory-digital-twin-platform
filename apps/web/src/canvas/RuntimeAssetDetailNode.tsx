import type { CSSProperties } from "react";
import type { RuntimeAssetConnection } from "../runtime-state";
import { AssetRuntimeDetailPanel } from "../twin/AssetRuntimeDetailPanel";
import type { ProjectAsset } from "./assets";
import { parseAssetDetailProps, type CanvasNode } from "./types";

type RuntimeAssetDetailNodeProps = {
  asset: ProjectAsset | null;
  connection: RuntimeAssetConnection | undefined;
  editable: boolean;
  error: string | null;
  loading: boolean;
  node: CanvasNode;
};

export function RuntimeAssetDetailNode({
  asset,
  connection,
  editable,
  error,
  loading,
  node,
}: RuntimeAssetDetailNodeProps) {
  const parsed = parseAssetDetailProps(node.props);
  if (!parsed.ok) {
    return <div className="asset-detail-node-state is-error" role="alert"><strong>设备数据配置无效</strong><span>{parsed.message}</span></div>;
  }
  const style = {
    "--asset-detail-accent": parsed.value.accentColor,
    "--asset-detail-border": parsed.value.borderColor,
    "--asset-detail-fill": parsed.value.fillColor,
    "--asset-detail-text": parsed.value.textColor,
  } as CSSProperties;

  return (
    <div className="asset-detail-node" style={style}>
      {asset ? (
        <AssetRuntimeDetailPanel
          asset={asset}
          connection={connection}
          embedded
          eyebrow={parsed.value.title}
          maximumMetrics={parsed.value.maximumMetrics}
          showMetadata={parsed.value.showMetadata}
        />
      ) : (
        <div className={`asset-detail-node-state${error ? " is-error" : ""}`} role={error ? "alert" : "status"}>
          {loading ? <span className="model-loading-spinner" /> : <span className="asset-detail-empty-icon" aria-hidden="true">⌖</span>}
          <strong>{loading ? "正在读取设备数据" : error ? "设备数据不可用" : parsed.value.title}</strong>
          <span>{error ?? (editable ? "预览时点击 3D 场景中的设备，将在此显示实时数据。" : parsed.value.emptyText)}</span>
        </div>
      )}
    </div>
  );
}
