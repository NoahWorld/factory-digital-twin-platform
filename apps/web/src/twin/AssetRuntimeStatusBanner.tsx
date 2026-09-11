import type { RuntimeAssetConnection } from "../runtime-state";

type AssetRuntimeStatusBannerProps = {
  connections: Record<string, RuntimeAssetConnection>;
  label?: string;
  loading: boolean;
  setupError: string | null;
};

export const runtimeConnectionSummary = (
  connections: Record<string, RuntimeAssetConnection>,
) => {
  const list = Object.values(connections);
  const offlineCount = list.filter((state) => state.status === "offline").length;
  const staleCount = list.filter(
    (state) => state.status === "offline" && state.errorCode === "data_source_stale",
  ).length;
  const disconnectedCount = offlineCount - staleCount;
  const liveCount = list.filter((state) => state.status === "live").length;
  const loadingCount = list.filter((state) => state.status === "loading").length;
  const maximumFailureCount = Math.max(0, ...list.map((state) => state.failureCount));
  return {
    disconnectedCount,
    liveCount,
    loadingCount,
    maximumFailureCount,
    offlineCount,
    staleCount,
  };
};

export function AssetRuntimeStatusBanner({
  connections,
  label = "REST 模拟采集",
  loading,
  setupError,
}: AssetRuntimeStatusBannerProps) {
  const summary = runtimeConnectionSummary(connections);
  const offlineSummary = summary.staleCount > 0 && summary.disconnectedCount > 0
    ? `数据异常 ${summary.offlineCount} 台（陈旧 ${summary.staleCount} / 失联 ${summary.disconnectedCount}）`
    : summary.staleCount > 0
      ? `数据陈旧 ${summary.staleCount} 台`
      : `数据失联 ${summary.disconnectedCount} 台`;
  const stateClass = setupError
    ? "is-error"
    : summary.offlineCount > 0
      ? summary.staleCount === summary.offlineCount ? "is-stale" : "is-offline"
      : summary.liveCount > 0
        ? "is-live"
        : "is-loading";

  return (
    <div
      className={`runtime-status-banner ${stateClass}`}
      role={setupError || summary.offlineCount > 0 ? "alert" : "status"}
    >
      <strong>{label}</strong>
      <span>
        {loading
          ? "🟡 正在读取资产映射…"
          : setupError
            ? `⚠ ${setupError}`
            : summary.offlineCount > 0
              ? `${summary.staleCount === summary.offlineCount ? "🟠" : "🔴"} ${offlineSummary} · 正在重连（第 ${summary.maximumFailureCount} 次）`
              : summary.liveCount > 0
                ? `🟢 在线 ${summary.liveCount} 台 · 字段映射与 3D 状态已生效`
                : "🟡 正在连接设备数据…"}
      </span>
    </div>
  );
}
