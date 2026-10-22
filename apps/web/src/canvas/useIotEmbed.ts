import { useEffect, useMemo, useState } from "react";
import { buildIotPointManifest, IOT_EMBED_CHANNEL, IOT_EMBED_VERSION, parseIotParentMessage } from "../../../../shared/iot-embed";
import { initialIotRuntimeState, projectIotRuntimeNode, projectIotFluid, receiveIotMessage, type IotRuntimeNode } from "./iot-runtime";
import { request } from "../api";
import { currentPublication, publicationsPath } from "../publication-runtime";
import { ApiRequestError, errorMessage, reportError } from "../errors";
import type { CanvasDocument } from "./types";
import type { StandaloneSceneDocument } from "../../../../shared/standalone-3d";

/** The IoT branch reads saved device mappings through the current IoT session. */
function useIotPoints(document: { projectId: string; revision: number } | null, preview: boolean, manifest: ReturnType<typeof buildIotPointManifest>, scope: "canvas" | "scene") {
  const [state, setState] = useState(initialIotRuntimeState);
  const [now, setNow] = useState(Date.now);
  const hasBindings = !manifest.ok || manifest.value.length > 0;
  const setupError = !manifest.ok ? manifest.message : null;
  useEffect(() => {
    setState(initialIotRuntimeState());
    if (!preview || !document || !manifest.ok || !hasBindings) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let active: AbortController | null = null;
    let retries = 0;
    const publication = currentPublication();
    const runtimePath = publication
      ? `${publicationsPath(publication.rootProjectId)}/${encodeURIComponent(publication.versionId)}/projects/${encodeURIComponent(document.projectId)}/${scope}/runtime`
      : `/api/v1/projects/${encodeURIComponent(document.projectId)}/${scope}/runtime`;
    const sessionId = `${document.projectId}:${document.revision}`;
    const poll = async () => {
      active = new AbortController();
      const deadline = setTimeout(() => active?.abort(), 16000);
      let delay = 1000;
      try {
        const result = await request<{ revision: number; values: unknown }>(runtimePath, { signal: active.signal });
        if (stopped) return;
        if (result.revision !== document.revision) throw new Error("配置已更新，请重新加载后预览。");
        const parsed = parseIotParentMessage({ channel: IOT_EMBED_CHANNEL, version: IOT_EMBED_VERSION, type: "snapshot", sessionId, values: result.values });
        if (!parsed.ok) throw new Error(parsed.message);
        retries = 0;
        setState(previous => receiveIotMessage({ ...previous, sessionId, status: "connected", retryCount: 0, error: null }, parsed.value, manifest.value, Date.now()));
        setNow(Date.now());
      } catch (reason) {
        if (stopped) return;
        reportError(reason, { operation: `iot.${scope}.runtime`, projectId: document.projectId });
        retries++;
        const retryable = active.signal.aborted || reason instanceof ApiRequestError && (reason.code === "network_error" || reason.code === "iot_device_data_pending" || (reason.context.status ?? 0) >= 500);
        const retry = retryable && retries <= 6;
        setState({ ...initialIotRuntimeState(), sessionId, status: retry ? "reconnecting" : "error", retryCount: retries, error: active.signal.aborted ? "IoT 数据请求超时" : errorMessage(reason) });
        if (!retry) return;
        delay = Math.min(30000, 1000 * 2 ** (retries - 1));
      } finally { clearTimeout(deadline); }
      if (!stopped) timer = setTimeout(() => void poll(), delay);
    };
    void poll();
    return () => { stopped = true; active?.abort(); clearTimeout(timer); };
  }, [preview, document?.projectId, document?.revision, manifest, hasBindings, scope]);
  useEffect(() => {
    if (!preview || !hasBindings) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [preview, hasBindings]);
  return { state, now, setupError, hasBindings };
}

export function useIotEmbed(document: CanvasDocument | null, preview: boolean) {
  const manifest = useMemo(() => buildIotPointManifest(document?.nodes ?? []), [document?.nodes]);
  const { state, now, setupError, hasBindings } = useIotPoints(document, preview, manifest, "canvas");
  const nodes = useMemo(() => {
    const result: Record<string, IotRuntimeNode> = Object.create(null);
    if (preview) for (const node of document?.nodes ?? []) if (node.iotBinding !== undefined || node.stateBinding !== undefined) result[node.id] = projectIotRuntimeNode(node, state, now, setupError);
    return result;
  }, [document?.nodes, preview, state, now, setupError]);
  return { nodes, error: preview && hasBindings && (setupError || state.error) };
}

export function useIotFluids(document: StandaloneSceneDocument | null, preview: boolean) {
  const manifest = useMemo(() => buildIotPointManifest((document?.fluids ?? []).map(f => ({ id: f.id, type: "fluid", stateBinding: f.stateBinding }))), [document?.fluids]);
  const { state, now, setupError } = useIotPoints(document, preview, manifest, "scene");
  return useMemo(() => {
    const results = (document?.fluids ?? []).map(f => preview ? projectIotFluid(f, state, now, setupError) : { fluid: f, error: null });
    return { fluids: results.map(r => r.fluid), errors: results.flatMap(r => r.error ? [r.error] : []) };
  }, [document?.fluids, preview, state, now, setupError]);
}
