import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { InteractionRuntime, type InteractionHost, type InteractionSnapshot } from "../../../shared/interaction-runtime";
import type { InteractionEvent, InteractionDefinition } from "../../../shared/interactions";
import type { RuntimeAssetConnection } from "./runtime-state";

const EMPTY: InteractionSnapshot = { states: {}, traces: [], active: 0, pageId: null };
export const InteractionContext = createContext<{ emit: (event: InteractionEvent) => void; hiddenNodes: Set<string> } | null>(null);
export const useInteractionContext = () => useContext(InteractionContext);

/** CanvasPage retains this session across page routes; edit/preview or project changes dispose it. */
export function useInteractionSession(config: InteractionDefinition | undefined, enabled: boolean, pageId: string | undefined,
  connections: Record<string, RuntimeAssetConnection>, host: InteractionHost["perform"]) {
  const latest = useRef({ connections, host }); latest.current = { connections, host };
  const navigating = useRef(false);
  const [runtime, setRuntime] = useState<InteractionRuntime | null>(null);
  const configKey = JSON.stringify(config);
  useEffect(() => {
    if (!enabled || !config) { setRuntime(null); return; }
    const engine = new InteractionRuntime(config, {
      metric: (assetId, metricKey) => { const connection = latest.current.connections[assetId]; return connection?.status === "live" ? connection.snapshot?.values[metricKey] : undefined; },
      perform: async (action, value, signal) => {
        if (action.type === "page.navigate") navigating.current = true;
        try { return await latest.current.host(action, value, signal); }
        finally { if (action.type === "page.navigate") navigating.current = false; }
      },
    });
    setRuntime(engine);
    return () => engine.dispose();
  }, [enabled, configKey]);
  useEffect(() => { if (pageId && !navigating.current) runtime?.setPage(pageId); }, [runtime, pageId]);
  const lastData = useRef(new Map<string, { status: string; values: Record<string, unknown> }>());
  useEffect(() => { lastData.current.clear(); }, [runtime]);
  useEffect(() => {
    if (!runtime) return;
    for (const [id, connection] of Object.entries(connections)) {
      const status = connection.errorCode === "data_source_stale" ? "stale" : connection.status;
      const previous = lastData.current.get(id);
      if (previous?.status !== status) runtime.emit({ type: "connection.change", sourceId: id, assetId: id, status, value: status, ...(previous ? { previous: previous.status } : {}) });
      const values = connection.status === "live" ? connection.snapshot?.values ?? {} : {};
      for (const key of new Set([...Object.keys(values), ...Object.keys(previous?.values ?? {})])) {
        const value = values[key], old = previous?.values[key];
        if (old !== value || previous?.status !== status) runtime.emit({ type: "data.change", sourceId: id, assetId: id, metricKey: key,
          status: value === undefined ? "unavailable" : "live", ...(value === undefined ? {} : { value }), ...(old === undefined ? {} : { previous: old as typeof value }) });
      }
      lastData.current.set(id, { status, values: { ...values } });
    }
    for (const id of lastData.current.keys()) if (!connections[id]) lastData.current.delete(id);
  }, [runtime, connections]);
  const snapshot = useSyncExternalStore(runtime?.subscribe ?? (() => () => undefined), runtime?.getSnapshot ?? (() => EMPTY));
  const emit = useMemo(() => (event: InteractionEvent) => runtime?.emit(event), [runtime]);
  return { runtime, snapshot, emit };
}
