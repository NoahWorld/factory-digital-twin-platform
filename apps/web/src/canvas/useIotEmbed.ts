import { useEffect, useMemo, useRef, useState } from "react";
import { buildIotPointManifest, IOT_EMBED_CHANNEL, IOT_EMBED_VERSION, parseIotEmbedOptions, parseIotParentMessage, type IotReadyMessage, type IotRequestHelloMessage } from "../../../../shared/iot-embed";
import { initialIotRuntimeState, isTrustedIotEvent, projectIotRuntimeNode, receiveIotMessage, type IotRuntimeNode } from "./iot-runtime";
import type { CanvasDocument } from "./types";

export function useIotEmbed(document: CanvasDocument | null, preview: boolean) {
  const [state, setState] = useState(initialIotRuntimeState);
  const stateRef = useRef(state);
  const [now, setNow] = useState(Date.now);
  const options = useMemo(() => parseIotEmbedOptions(window.location.search), []);
  const manifest = useMemo(() => buildIotPointManifest(document?.nodes ?? []), [document?.nodes]);
  const hasBindings = document?.nodes.some((node) => node.iotBinding !== undefined) ?? false;
  const setupError = !manifest.ok ? manifest.message : !options.ok ? options.message
    : !options.value.enabled ? "未连接 IoT 宿主" : window.parent === window ? "IoT 预览须由宿主页面嵌入" : null;

  useEffect(() => {
    stateRef.current = initialIotRuntimeState();
    setState(stateRef.current);
    if (!preview || !document || !options.ok || !options.value.enabled || window.parent === window) return;
    const parentOrigin = options.value.parentOrigin;
    let scheduled: number | null = null;
    const publish = () => {
      if (scheduled !== null) return;
      scheduled = window.requestAnimationFrame(() => { scheduled = null; setState(stateRef.current); setNow(Date.now()); });
    };
    const onMessage = (event: MessageEvent) => {
      if (!isTrustedIotEvent(event, window.parent, parentOrigin) || event.data?.channel !== IOT_EMBED_CHANNEL) return;
      if (event.data?.type !== "hello" && event.data?.sessionId !== stateRef.current.sessionId) return;
      const parsed = parseIotParentMessage(event.data);
      if (!parsed.ok) {
        console.error("[iot-embed] Invalid parent message", { projectId: document.projectId, sessionId: stateRef.current.sessionId, error: parsed.message });
        stateRef.current = { ...stateRef.current, status: "error", error: parsed.message, values: Object.create(null) };
        publish();
        return;
      }
      const message = parsed.value;
      if (message.type === "hello") {
        const ready: IotReadyMessage = { channel: IOT_EMBED_CHANNEL, version: IOT_EMBED_VERSION, type: "ready", sessionId: message.sessionId, points: manifest.ok ? manifest.value : [], ...(!manifest.ok ? { error: manifest.message } : {}) };
        window.parent.postMessage(ready, parentOrigin);
      }
      const previous = stateRef.current;
      stateRef.current = receiveIotMessage(previous, message, manifest.ok ? manifest.value : [], Date.now());
      if (stateRef.current.error && stateRef.current.error !== previous.error) console.error("[iot-embed] Point input rejected", { projectId: document.projectId, sessionId: message.sessionId, error: stateRef.current.error });
      publish();
    };
    window.addEventListener("message", onMessage);
    // Hash navigation can remount a preview without firing the iframe's load event.
    if (hasBindings) {
      const request: IotRequestHelloMessage = { channel: IOT_EMBED_CHANNEL, version: IOT_EMBED_VERSION, type: "request-hello" };
      window.parent.postMessage(request, parentOrigin);
    }
    return () => {
      window.removeEventListener("message", onMessage);
      if (scheduled !== null) window.cancelAnimationFrame(scheduled);
    };
  }, [preview, document?.projectId, document?.revision, hasBindings, manifest, options]);

  useEffect(() => {
    if (!preview || !hasBindings) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [preview, hasBindings]);

  const nodes = useMemo(() => {
    const result: Record<string, IotRuntimeNode> = Object.create(null);
    if (preview) for (const node of document?.nodes ?? []) if (node.iotBinding !== undefined) result[node.id] = projectIotRuntimeNode(node, state, now, setupError);
    return result;
  }, [document?.nodes, preview, state, now, setupError]);
  return { nodes, error: preview && hasBindings && (setupError || state.error) };
}
