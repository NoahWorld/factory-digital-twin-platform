import { useEffect, useMemo, useState } from "react";
import type { RoomAlarmRule } from "../../../../shared/room-alarms";
import { request, errorMessage } from "../api";
import { projectAssetsPath, type ProjectAsset, type ProjectAssetListResponse } from "../canvas/assets";
import type { RuntimeAssetConnection } from "../runtime-state";
import type { RoomAlarmObservation } from "../scene/room-alarm-runtime";
import { useAssetRuntimeConnections } from "./useAssetRuntimeConnections";
import { currentPublication, usePublicationSnapshot } from "../publication-runtime";

const EMPTY_ASSETS: ProjectAsset[] = [];
const EMPTY_CONNECTIONS: Record<string, RuntimeAssetConnection> = {};
export type RoomAlarmProjectData = {
  projectId: string; label: string; assets: ProjectAsset[]; loading: boolean; error: string | null;
  connections?: Record<string, RuntimeAssetConnection>;
};

function useAlarmAssets(projectId: string | null, needed: boolean) {
  const [state, setState] = useState<{ projectId: string; assets: ProjectAsset[]; error: string | null } | null>(null);
  useEffect(() => {
    if (!projectId || !needed) return;
    const controller = new AbortController();
    setState(null);
    void request<ProjectAssetListResponse>(projectAssetsPath(projectId), { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setState({ projectId, assets: result.assets, error: null }); })
      .catch(reason => { if (!controller.signal.aborted) setState({ projectId, assets: [], error: errorMessage(reason) }); });
    return () => controller.abort();
  }, [projectId, needed]);
  return {
    assets: state?.projectId === projectId ? state.assets : EMPTY_ASSETS,
    loading: needed && !!projectId && state?.projectId !== projectId,
    error: state?.projectId === projectId ? state.error : null,
  };
}

/** Map only authenticated, project-scoped normalized observations; never reinterpret an old value as recovery. */
export function roomAlarmObservations(rules: RoomAlarmRule[], sources: RoomAlarmProjectData[]): Record<string, RoomAlarmObservation> {
  return Object.fromEntries(rules.map(rule => {
    const source = sources.find(item => item.projectId === rule.source.projectId);
    const asset = source?.assets.find(item => item.projectId === source.projectId && item.assetId === rule.source.assetId);
    const connection = asset ? source?.connections?.[asset.id] : undefined;
    const waiting: RoomAlarmObservation = { status: "loading", timestamp: null, staleAfterMs: 0, value: null };
    if (!source || source.error) return [rule.id, { ...waiting, status: "offline", message: source?.error ?? "报警数据项目未获授权或已取消关联" }];
    if (source.loading) return [rule.id, waiting];
    if (!asset) return [rule.id, { ...waiting, status: "offline", message: "报警业务资产不存在或无法访问" }];
    if (!connection || connection.status === "loading") return [rule.id, waiting];
    if (connection.status === "offline") return [rule.id, { ...waiting, status: "offline", message: connection.errorMessage ?? "报警数据源失联" }];
    const snapshot = connection.snapshot;
    if (!snapshot || snapshot.asset?.id !== asset.id || snapshot.asset.assetId !== rule.source.assetId) {
      return [rule.id, { ...waiting, status: "offline", message: "报警数据身份不匹配" }];
    }
    const metrics = snapshot.metrics?.filter(item => item.metricKey === rule.source.metricKey) ?? [];
    const metric = metrics.length === 1 ? metrics[0] : undefined;
    const metricSources = metric?.sourceId ? snapshot.sources.filter(item => item.id === metric.sourceId) : [];
    const value = Object.hasOwn(snapshot.values, rule.source.metricKey) ? snapshot.values[rule.source.metricKey] : null;
    if (!metric || metric.quality !== "good" || metricSources.length !== 1 || typeof metric.timestamp !== "string"
      || typeof metric.collectedAt !== "string" || metric.value !== value) {
      return [rule.id, { ...waiting, status: "offline", message: "指标缺少一致的采样身份或质量信息，保留最后有效报警状态" }];
    }
    // An unrelated slow metric must never supply this metric's observation time.
    const metricSource = metricSources[0];
    const times = [metric.timestamp, metric.collectedAt].map(item => Date.parse(item));
    const validTime = times.every(Number.isFinite)
      && times[0] === Date.parse(metricSource.sourceTimestamp ?? metricSource.collectedAt) && times[1] === Date.parse(metricSource.collectedAt);
    return [rule.id, {
      status: "live", timestamp: validTime ? metric.timestamp : null, collectedAt: metric.collectedAt,
      staleAfterMs: metric.staleAfterSeconds * 1000,
      value: typeof value === "number" || typeof value === "boolean" || typeof value === "string" ? value : null,
    } satisfies RoomAlarmObservation];
  }));
}

/** At most two authorized projects and 50 unique assets, shared by all rules in this view. */
export function useRoomAlarmData({ projectId, linkedProjectId, rules, enabled, loadEditableAssets = false, linkedData, publicationVersion }: {
  projectId: string; linkedProjectId: string | null; rules: RoomAlarmRule[]; enabled: boolean;
  loadEditableAssets?: boolean; linkedData?: RoomAlarmProjectData;
  publicationVersion?: { rootProjectId: string; versionId: string };
}) {
  const publication = usePublicationSnapshot();
  const fixedVersion = publicationVersion ?? (publication ? currentPublication() ?? undefined : undefined);
  const wantedKey = JSON.stringify([...new Set(rules.filter(rule => rule.enabled).map(rule => `${rule.source.projectId}\0${rule.source.assetId}`))].sort());
  const wanted = useMemo(() => new Set<string>(JSON.parse(wantedKey)), [wantedKey]);
  const currentOwn = useAlarmAssets(projectId, !publication && (loadEditableAssets || (enabled && rules.some(rule => rule.source.projectId === projectId))));
  const currentLinked = useAlarmAssets(linkedProjectId, !publication && !linkedData && enabled && rules.some(rule => rule.source.projectId === linkedProjectId));
  const own = publication ? { assets: publication.projects[projectId]?.assets ?? EMPTY_ASSETS, loading: false, error: publication.projects[projectId] ? null : "固定版本不含当前报警数据项目" } : currentOwn;
  const linked = publication ? { assets: publication.projects[linkedProjectId ?? ""]?.assets ?? EMPTY_ASSETS, loading: false, error: publication.projects[linkedProjectId ?? ""] ? null : "固定版本不含关联报警数据项目" } : currentLinked;
  const ownAssets = useMemo(() => own.assets.filter(asset => asset.projectId === projectId && wanted.has(`${projectId}\0${asset.assetId}`)), [own.assets, projectId, wanted]);
  const linkedAssets = useMemo(() => linked.assets.filter(asset => asset.projectId === linkedProjectId && wanted.has(`${linkedProjectId}\0${asset.assetId}`)), [linked.assets, linkedProjectId, wanted]);
  const budgetError = wanted.size > 50 ? "房间报警最多订阅 50 个不同资产，请减少规则或复用资产指标" : null;
  const ownConnections = useAssetRuntimeConnections({
    assets: ownAssets, projectId, enabled: enabled && !own.loading, blockedReason: own.error ?? budgetError,
    publicationVersion: fixedVersion, stopOnAccessDenied: true,
  });
  const linkedConnections = useAssetRuntimeConnections({
    assets: linkedAssets, projectId: linkedProjectId, enabled: enabled && !linkedData && !linked.loading,
    blockedReason: linked.error ?? budgetError, publicationVersion: fixedVersion, stopOnAccessDenied: true,
  });
  const sources: RoomAlarmProjectData[] = [
    { projectId, label: "当前 3D 项目", ...own, error: own.error ?? budgetError, connections: enabled ? ownConnections : EMPTY_CONNECTIONS },
    ...(linkedProjectId ? [linkedData ?? { projectId: linkedProjectId, label: "关联 2D 项目", ...linked, error: linked.error ?? budgetError, connections: enabled ? linkedConnections : EMPTY_CONNECTIONS }] : []),
  ];
  return { sources, observations: enabled ? roomAlarmObservations(rules, sources) : {} };
}
