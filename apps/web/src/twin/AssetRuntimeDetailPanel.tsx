import type { ProjectAsset } from "../canvas/assets";
import {
  deviceVisualStatus,
  deviceVisualStatusLabel,
  type RuntimeAssetConnection,
  type RuntimeMetricValue,
} from "../runtime-state";

type AssetRuntimeDetailPanelProps = {
  asset: ProjectAsset;
  connection: RuntimeAssetConnection | undefined;
  embedded?: boolean;
  eyebrow?: string;
  maximumMetrics?: number;
  onClose?: () => void;
  showMetadata?: boolean;
};

const formatRuntimeValue = (value: RuntimeMetricValue): string => {
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
};

const formatRuntimeTime = (value: string | undefined): string => {
  if (!value) return "—";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(timestamp)
    : value;
};

const metricLabel = (asset: ProjectAsset, metricKey: string): string => {
  const labels = asset.metadata.metricLabels;
  if (!labels || typeof labels !== "object" || Array.isArray(labels)) return metricKey;
  const label = (labels as Record<string, unknown>)[metricKey];
  return typeof label === "string" && label.trim() ? label.trim() : metricKey;
};

export const isSimulationAsset = (asset: ProjectAsset): boolean =>
  asset.metadata.runtimeMode === "simulation"
  || asset.metadata.dataLabel === "模拟数据"
  || asset.metadata.simulation === true;

export function AssetRuntimeDetailPanel({
  asset,
  connection,
  embedded = false,
  eyebrow = "2D DEVICE DETAIL",
  maximumMetrics,
  onClose,
  showMetadata = true,
}: AssetRuntimeDetailPanelProps) {
  const deviceStatus = deviceVisualStatus(connection);
  const isStale = connection?.errorCode === "data_source_stale";
  const simulation = isSimulationAsset(asset);
  return (
    <section
      aria-label={`${asset.name} 设备详情`}
      className={`runtime-detail-panel${embedded ? " is-embedded" : ""}`}
    >
      <header>
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2>{asset.name}</h2>
        </div>
        {onClose ? <button aria-label="关闭设备详情" onClick={onClose} type="button">×</button> : null}
      </header>
      {simulation ? <div className="runtime-simulation-label">模拟数据 · 非真实生产数据</div> : null}
      <div className={`runtime-device-state is-${deviceStatus}${isStale ? " is-stale" : ""}`}>
        <i aria-hidden="true" />
        <strong>{isStale ? "数据陈旧" : deviceVisualStatusLabel[deviceStatus]}</strong>
        <span>{connection?.status === "offline" ? `重连第 ${connection.failureCount} 次` : "实时状态"}</span>
      </div>
      {showMetadata ? (
        <dl className="runtime-device-meta">
          <div><dt>assetId</dt><dd>{asset.assetId}</dd></div>
          <div><dt>设备类型</dt><dd>{asset.assetType}</dd></div>
          <div><dt>模型节点</dt><dd>{asset.modelNode ?? "独立 3D 实例"}</dd></div>
          <div><dt>最近成功</dt><dd>{formatRuntimeTime(connection?.lastSuccessAt)}</dd></div>
        </dl>
      ) : null}
      {connection?.status === "offline" ? (
        <div className={`runtime-offline-alert${isStale ? " is-stale" : ""}`} role="alert">
          <strong>{isStale ? "设备数据已陈旧" : "设备数据已失联"}</strong>
          <p>{connection.errorMessage ?? "采集请求失败。"}</p>
          <small>最后数据保留用于排查，不代表当前实时值。</small>
        </div>
      ) : null}
      <section className="runtime-metric-section">
        <div className="runtime-section-heading">
          <h3>映射指标</h3>
          {connection?.status === "offline" && connection.snapshot
            ? <span>最后一次成功值</span>
            : null}
        </div>
        {connection?.snapshot?.metrics.length ? (
          <div className="runtime-metric-grid">
            {connection.snapshot.metrics.slice(0, maximumMetrics).map((metric) => (
              <div className="runtime-metric-card" key={metric.bindingId}>
                <span title={metric.metricKey}>{metricLabel(asset, metric.metricKey)}</span>
                <strong>{formatRuntimeValue(metric.value)}{metric.unit ? <small>{metric.unit}</small> : null}</strong>
                <code>{metric.sourcePath}</code>
              </div>
            ))}
          </div>
        ) : (
          <p className="runtime-empty-metrics">
            {connection?.status === "loading" ? "正在读取映射数据…" : "尚无可显示指标。"}
          </p>
        )}
      </section>
    </section>
  );
}
