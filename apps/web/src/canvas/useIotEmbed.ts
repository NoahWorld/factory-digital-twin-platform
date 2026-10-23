import { useEffect, useMemo, useState } from "react";
import { buildIotPointManifest, parseIotEmbedOptions } from "../../../../shared/iot-embed";
import { initialIotRuntimeState, projectIotRuntimeNode, projectIotFluid, type IotRuntimeNode } from "./iot-runtime";
import { getIotEmbedSession } from "./iot-embed-session";
import type { CanvasDocument } from "./types";
import type { StandaloneSceneDocument } from "../../../../shared/standalone-3d";

function useIotPoints(document: { projectId: string; revision: number } | null, preview: boolean, manifest: ReturnType<typeof buildIotPointManifest>) {
  const [state, setState] = useState(initialIotRuntimeState);
  const [now, setNow] = useState(Date.now);
  const options = useMemo(() => parseIotEmbedOptions(window.location.search), []);
  const hasBindings = !manifest.ok || manifest.value.length > 0;
  const setupError = !manifest.ok ? manifest.message : !options.ok ? options.message
    : !options.value.enabled ? "未连接 IoT 宿主" : window.parent === window ? "IoT 预览须由宿主页面嵌入" : null;

  useEffect(() => {
    setState(initialIotRuntimeState());
    if (!preview || !document || !hasBindings || !options.ok || !options.value.enabled || window.parent === window) return;
    return getIotEmbedSession(options.value.parentOrigin).subscribe(manifest, next => { setState(next); setNow(Date.now()); });
  }, [preview, document?.projectId, document?.revision, manifest, hasBindings, options]);

  useEffect(() => {
    if (!preview || !hasBindings) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [preview, hasBindings]);
  return { state, now, setupError, hasBindings };
}

export function useIotEmbed(document: CanvasDocument | null, preview: boolean) {
  const manifest = useMemo(() => buildIotPointManifest(document?.nodes ?? []), [document?.nodes]);
  const { state, now, setupError, hasBindings } = useIotPoints(document, preview, manifest);
  const nodes = useMemo(() => {
    const result: Record<string, IotRuntimeNode> = Object.create(null);
    if (preview) for (const node of document?.nodes ?? []) if (node.iotBinding !== undefined || node.stateBinding !== undefined) result[node.id] = projectIotRuntimeNode(node, state, now, setupError);
    return result;
  }, [document?.nodes, preview, state, now, setupError]);
  return { nodes, error: preview && hasBindings && (setupError || state.error) };
}

export function useIotFluids(document: StandaloneSceneDocument | null, preview: boolean) {
  const manifest = useMemo(() => buildIotPointManifest((document?.fluids ?? []).map(f => ({ id: f.id, type: "fluid", stateBinding: f.stateBinding }))), [document?.fluids]);
  const { state, now, setupError } = useIotPoints(document, preview, manifest);
  return useMemo(() => {
    const results = (document?.fluids ?? []).map(f => preview ? projectIotFluid(f, state, now, setupError) : { fluid: f, error: null });
    return { fluids: results.map(r => r.fluid), errors: results.flatMap(r => r.error ? [r.error] : []) };
  }, [document?.fluids, preview, state, now, setupError]);
}
