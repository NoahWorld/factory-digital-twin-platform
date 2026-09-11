import type { ProjectAsset } from "../canvas/assets";
import {
  deviceVisualStatus,
  deviceVisualStatusLabel,
  type RuntimeAssetConnection,
} from "../runtime-state";
import { AssetRuntimeDetailPanel, isSimulationAsset } from "./AssetRuntimeDetailPanel";
import { runtimeConnectionSummary } from "./AssetRuntimeStatusBanner";

type TwinDashboardPanelProps = {
  assets: ProjectAsset[];
  connections: Record<string, RuntimeAssetConnection>;
  linkedProjectId: string;
  onSelectAsset: (asset: ProjectAsset) => void;
  selectedAsset: ProjectAsset | null;
  setupError: string | null;
};

export function TwinDashboardPanel({
  assets,
  connections,
  linkedProjectId,
  onSelectAsset,
  selectedAsset,
  setupError,
}: TwinDashboardPanelProps) {
  const summary = runtimeConnectionSummary(connections);
  const abnormalCount = assets.filter((asset) => {
    const status = deviceVisualStatus(connections[asset.id]);
    return status === "warning" || status === "alarm" || status === "offline";
  }).length;
  const simulation = assets.length > 0 && assets.every(isSimulationAsset);

  return (
    <aside className="twin-dashboard-panel" aria-label="2D 设备联动看板">
      <header className="twin-dashboard-header">
        <div>
          <span>2D × 3D DIGITAL TWIN</span>
          <h1>车间设备看板</h1>
        </div>
        {simulation ? <strong>模拟数据</strong> : null}
      </header>
      <p className="twin-dashboard-guide">点击 3D 模型查看设备数据；点击设备列表可反向选中模型。</p>
      <div className="twin-dashboard-kpis">
        <article><span>绑定设备</span><strong>{assets.length}</strong><small>台</small></article>
        <article><span>在线</span><strong>{summary.liveCount}</strong><small>台</small></article>
        <article className={abnormalCount > 0 ? "is-alert" : ""}><span>异常</span><strong>{abnormalCount}</strong><small>台</small></article>
      </div>
      {setupError ? <div className="twin-dashboard-error" role="alert">{setupError}</div> : null}
      <section className="twin-asset-list-section">
        <div className="twin-dashboard-section-title"><h2>设备列表</h2><span>{assets.length} ASSETS</span></div>
        {assets.length > 0 ? (
          <div className="twin-asset-list">
            {assets.map((asset) => {
              const status = deviceVisualStatus(connections[asset.id]);
              return (
                <button
                  aria-pressed={selectedAsset?.id === asset.id}
                  className={`twin-asset-row is-${status}${selectedAsset?.id === asset.id ? " is-selected" : ""}`}
                  key={asset.id}
                  onClick={() => onSelectAsset(asset)}
                  type="button"
                >
                  <i aria-hidden="true" />
                  <span><strong>{asset.name}</strong><small>{asset.assetId}</small></span>
                  <em>{deviceVisualStatusLabel[status]}</em>
                </button>
              );
            })}
          </div>
        ) : <p className="twin-dashboard-empty">场景中没有绑定 2D 业务资产。</p>}
      </section>
      {selectedAsset ? (
        <AssetRuntimeDetailPanel
          asset={selectedAsset}
          connection={connections[selectedAsset.id]}
          embedded
        />
      ) : (
        <div className="twin-dashboard-placeholder">
          <span aria-hidden="true">⌖</span>
          <strong>选择一台设备</strong>
          <p>模型高亮与设备数据使用同一个 assetId 关联。</p>
        </div>
      )}
      <a
        className="secondary-button compact-button twin-dashboard-link"
        href={`#/projects/${encodeURIComponent(linkedProjectId)}/preview${selectedAsset ? `?asset=${encodeURIComponent(selectedAsset.assetId)}` : ""}`}
      >打开完整 2D 看板</a>
    </aside>
  );
}
