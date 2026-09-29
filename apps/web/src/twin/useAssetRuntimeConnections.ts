import { useEffect, useState } from "react";
import { ApiRequestError, errorMessage, reportError, request } from "../api";
import type { ProjectAsset } from "../canvas/assets";
import {
  assetRuntimeStatePath,
  type AssetRuntimeStateResponse,
  type RuntimeAssetConnection,
} from "../runtime-state";

type AssetRuntimePollOutcome =
  | { asset: ProjectAsset; kind: "success"; result: AssetRuntimeStateResponse }
  | { asset: ProjectAsset; failureCount: number; kind: "failure"; reason: unknown };

type UseAssetRuntimeConnectionsOptions = {
  assets: ProjectAsset[];
  blockedReason?: string | null;
  enabled: boolean;
  projectId: string | null;
  publicationVersion?: { rootProjectId: string; versionId: string };
  stopOnAccessDenied?: boolean;
};

/**
 * Owns the browser-side P1 polling lifecycle shared by 2D preview and standalone 3D preview.
 * The hook retains the last successful snapshot on failure so the UI can show diagnostic context,
 * while the connection status remains explicitly offline.
 */
export const useAssetRuntimeConnections = ({
  assets,
  blockedReason = null,
  enabled,
  projectId,
  publicationVersion,
  stopOnAccessDenied = false,
}: UseAssetRuntimeConnectionsOptions): Record<string, RuntimeAssetConnection> => {
  const [connections, setConnections] = useState<Record<string, RuntimeAssetConnection>>({});
  const publicationRootProjectId = publicationVersion?.rootProjectId;
  const publicationVersionId = publicationVersion?.versionId;

  useEffect(() => {
    if (!enabled || blockedReason || !projectId || assets.length === 0) {
      setConnections(current => Object.keys(current).length ? {} : current);
      return;
    }

    let cancelled = false;
    let nextPollTimer: number | null = null;
    const failureCounts = new Map<string, number>();
    setConnections(Object.fromEntries(
      assets.map((asset) => [
        asset.id,
        { status: "loading", failureCount: 0 } satisfies RuntimeAssetConnection,
      ]),
    ));

    const poll = async () => {
      const outcomes: AssetRuntimePollOutcome[] = await Promise.all(assets.map(async (asset) => {
        try {
          const result = await request<AssetRuntimeStateResponse>(
            publicationRootProjectId && publicationVersionId
              ? `/api/v1/projects/${encodeURIComponent(publicationRootProjectId)}/publications/${encodeURIComponent(publicationVersionId)}/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(asset.id)}/runtime-state`
              : assetRuntimeStatePath(projectId, asset.id),
          );
          failureCounts.set(asset.id, 0);
          return { asset, kind: "success", result } as const;
        } catch (reason) {
          const failureCount = (failureCounts.get(asset.id) ?? 0) + 1;
          failureCounts.set(asset.id, failureCount);
          reportError(reason, { operation: "asset-runtime.poll", projectId, assetId: asset.assetId, assetRecordId: asset.id, failureCount });
          return { asset, failureCount, kind: "failure", reason } as const;
        }
      }));

      if (cancelled) return;
      setConnections((current) => {
        const next = { ...current };
        for (const outcome of outcomes) {
          if (outcome.kind === "success") {
            next[outcome.asset.id] = {
              status: "live",
              snapshot: outcome.result.runtimeState,
              failureCount: 0,
              lastSuccessAt: outcome.result.runtimeState.timestamp,
            };
          } else {
            const previous = current[outcome.asset.id];
            const apiError = outcome.reason instanceof ApiRequestError
              ? outcome.reason
              : null;
            next[outcome.asset.id] = {
              status: "offline",
              snapshot: previous?.snapshot,
              errorCode: apiError?.code ?? "runtime_request_failed",
              errorMessage: errorMessage(outcome.reason),
              failedAt: new Date().toISOString(),
              failureCount: outcome.failureCount,
              lastSuccessAt: previous?.lastSuccessAt,
            };
          }
        }
        return next;
      });

      if (stopOnAccessDenied && outcomes.some(outcome => outcome.kind === "failure"
        && outcome.reason instanceof ApiRequestError
        && ["unauthenticated", "forbidden", "project_access_denied", "module_access_denied", "project_not_found", "publication_not_found", "publication_revoked"].includes(outcome.reason.code ?? ""))) return;
      const successfulIntervals = outcomes.flatMap((outcome) => (
        outcome.kind === "success" ? [outcome.result.runtimeState.pollAfterSeconds] : []
      ));
      const maximumFailureCount = Math.max(0, ...failureCounts.values());
      const nextSeconds = successfulIntervals.length > 0
        ? Math.min(...successfulIntervals)
        : Math.min(2 ** Math.max(maximumFailureCount - 1, 0), 30);
      nextPollTimer = window.setTimeout(() => void poll(), nextSeconds * 1000);
    };

    void poll();
    return () => {
      cancelled = true;
      if (nextPollTimer !== null) window.clearTimeout(nextPollTimer);
    };
  }, [assets, blockedReason, enabled, projectId, publicationRootProjectId, publicationVersionId, stopOnAccessDenied]);

  return connections;
};
