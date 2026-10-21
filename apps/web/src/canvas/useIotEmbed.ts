import { useEffect, useMemo, useState } from "react";
import { buildIotPointManifest, IOT_EMBED_CHANNEL, IOT_EMBED_VERSION, parseIotParentMessage } from "../../../../shared/iot-embed";
import { initialIotRuntimeState, projectIotRuntimeNode, receiveIotMessage, type IotRuntimeNode } from "./iot-runtime";
import { request } from "../api";
import { currentPublication, publicationsPath } from "../publication-runtime";
import { ApiRequestError, errorMessage, reportError } from "../errors";
import type { CanvasDocument } from "./types";

/** The IoT branch reads saved device mappings through the current IoT session. */
export function useIotEmbed(document: CanvasDocument | null, preview: boolean) {
  const [state, setState] = useState(initialIotRuntimeState);
  const [now, setNow] = useState(Date.now);
  const manifest = useMemo(() => buildIotPointManifest(document?.nodes ?? []), [document?.nodes]);
  const hasBindings = document?.nodes.some(node => node.iotBinding !== undefined) ?? false;
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
      ? `${publicationsPath(publication.rootProjectId)}/${encodeURIComponent(publication.versionId)}/projects/${encodeURIComponent(document.projectId)}/canvas/runtime`
      : `/api/v1/projects/${encodeURIComponent(document.projectId)}/canvas/runtime`;
    const sessionId = `${document.projectId}:${document.revision}`;
    const poll = async () => {
      active = new AbortController();
      const deadline = setTimeout(() => active?.abort(), 16000);
      let delay = 1000;
      try {
        const result = await request<{ revision: number; values: unknown }>(runtimePath, { signal: active.signal });
        if (stopped) return;
        if (result.revision !== document.revision) throw new Error("画布已更新，请重新加载后预览。");
        const parsed = parseIotParentMessage({ channel: IOT_EMBED_CHANNEL, version: IOT_EMBED_VERSION, type: "snapshot", sessionId, values: result.values });
        if (!parsed.ok) throw new Error(parsed.message);
        retries = 0;
        setState(previous => receiveIotMessage({ ...previous, sessionId, status: "connected", retryCount: 0, error: null }, parsed.value, manifest.value, Date.now()));
        setNow(Date.now());
      } catch (reason) {
        if (stopped) return;
        reportError(reason, { operation: "iot.canvas.runtime", projectId: document.projectId });
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
  }, [preview, document?.projectId, document?.revision, manifest, hasBindings]);
  useEffect(() => {
    if (!preview || !hasBindings) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [preview, hasBindings]);
  const nodes = useMemo(() => {
    const result: Record<string, IotRuntimeNode> = Object.create(null);
    if (preview) for (const node of document?.nodes ?? []) if (node.iotBinding !== undefined) result[node.id] = projectIotRuntimeNode(node, state, now, setupError);
    return result;
  }, [document?.nodes, preview, state, now, setupError]);
  return { nodes, error: preview && hasBindings && (setupError || state.error) };
}
