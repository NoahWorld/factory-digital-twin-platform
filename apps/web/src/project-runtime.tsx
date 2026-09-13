import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import type { ComponentBinding, MetricCatalogEntry } from "../../../shared/component-bindings";
import type { CanvasNode } from "./canvas/types";
import type { ProjectAsset } from "./canvas/assets";
import type { RuntimeAssetConnection } from "./runtime-state";
import { ProjectRuntimeTransport } from "./project-runtime-transport";

export type RuntimeCatalog = { assets: ProjectAsset[]; metrics: MetricCatalogEntry[] };
export const runtimeCatalogPath = (projectId: string) => `/api/v1/projects/${encodeURIComponent(projectId)}/runtime-catalog`;

export type ProjectRuntimeContextValue = RuntimeCatalog & {
  enabled: boolean;
  loading: boolean;
  error: string | null;
  bindings: ComponentBinding[];
  connections: Record<string, RuntimeAssetConnection>;
  selectedAssetId: string | null;
  selectAsset: (assetId: string | null) => void;
  changeBinding: (node: CanvasNode, binding: ComponentBinding | null) => void;
};

export const ProjectRuntimeContext = createContext<ProjectRuntimeContextValue | null>(null);
export function useProjectRuntimeContext() { return useContext(ProjectRuntimeContext); }

export function useProjectRuntime(projectId: string, assets: ProjectAsset[], neededAssetIds: string[],versionId?:string) {
  const store = useMemo(() => new ProjectRuntimeTransport(projectId,versionId), [projectId,versionId]);
  const demandKey = JSON.stringify(assets.filter((asset) => neededAssetIds.includes(asset.assetId))
    .map(({ id, assetId }) => ({ id, assetId })).sort((a, b) => a.assetId.localeCompare(b.assetId)));
  useEffect(() => { store.setDemand(JSON.parse(demandKey)); }, [demandKey, store]);
  useEffect(() => () => store.dispose(), [store]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
