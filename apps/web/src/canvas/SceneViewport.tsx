import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SceneViewportOptions, SceneViewportRuntime, ViewportState } from "./scene-viewport-runtime";
import type { ObjectTarget } from "./model-instance";

type Props = Omit<SceneViewportOptions, "onState"> & {
  interactive: boolean; hint?: string; selectedDisplayPath?: string | null;
  onPick: (target: ObjectTarget | null, path: string | null, ancestors: ObjectTarget[]) => void;
  onReady?: (runtime: SceneViewportRuntime | null) => void;
};

export function SceneViewport(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const runtime = useRef<SceneViewportRuntime | null>(null);
  const latest = useRef(props); latest.current = props;
  const pointer = useRef<{ x: number; y: number; id: number } | null>(null);
  const [state, setState] = useState<ViewportState>({ status: "loading", loaded: 0, total: props.scene.instances.length });
  const [attempt, setAttempt] = useState(0);
  const moduleFailed = useRef(false);
  const report = (next: ViewportState) => setState((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
  useEffect(() => {
    let cancelled = false;
    moduleFailed.current = true;
    void import("./scene-viewport-runtime").then(({ createSceneViewport }) => {
      if (cancelled || !container.current) return;
      moduleFailed.current = false;
      const engine = createSceneViewport(container.current, { ...latest.current, onState: report });
      runtime.current = engine; latest.current.onReady?.(engine); engine.update({ ...latest.current, onState: report });
    }).catch((reason) => {
      runtime.current?.dispose(); runtime.current = null;
      if (!cancelled) report({ status: "error", loaded: 0, total: latest.current.scene.instances.length, message: `3D 引擎不可用：${reason instanceof Error ? reason.message : String(reason)}` });
    });
    return () => { cancelled = true; runtime.current?.dispose(); runtime.current = null; latest.current.onReady?.(null); };
  }, [props.projectId, attempt]);
  useLayoutEffect(() => {
    try { runtime.current?.update({ ...props, onState: report }); }
    catch (reason) { report({ status: "error", loaded: 0, total: props.scene.instances.length, message: `场景配置无法应用：${String(reason)}` }); }
  }, [props.scene, props.legacyNames, props.cameraControlsEnabled, props.selectedTarget, props.selectedTargets, props.selectedLegacyPath, props.runtimeAppearances, props.onSnapshot]);
  return <div className="model-3d-node">
    <div className="model-3d-renderer" ref={container} data-selected-scene-node={props.selectedDisplayPath ?? ""}
      data-selected-instance={props.selectedTarget?.instanceId ?? props.selectedTargets?.[0]?.instanceId ?? ""} data-selected-object={props.selectedTarget?.objectId ?? props.selectedTargets?.[0]?.objectId ?? ""}
      onPointerDown={(event) => { if (props.interactive && event.button === 0) pointer.current = { x: event.clientX, y: event.clientY, id: event.pointerId }; }}
      onPointerCancel={() => { pointer.current = null; }}
      onPointerUp={(event) => {
        const start = pointer.current; pointer.current = null;
        if (!start || start.id !== event.pointerId || Math.hypot(start.x - event.clientX, start.y - event.clientY) > 4) return;
        try { const picked = runtime.current?.pick(event.clientX, event.clientY); props.onPick(picked?.target ?? null, picked?.path ?? null, picked?.ancestors ?? []); }
        catch (reason) { report({ ...state, status: "error", message: `选择失败：${String(reason)}` }); }
      }} />
    {state.status === "loading" ? <div className="model-3d-message"><span className="model-loading-spinner" /><strong>正在加载 3D 模型 {state.loaded}/{state.total}</strong></div> : null}
    {state.status === "error" ? <div className="model-3d-message is-error" role="alert"><strong>3D 模型不可用</strong><span>{state.message}</span><button onPointerDown={(event) => event.stopPropagation()} onClick={() => {
      if (runtime.current) runtime.current.retry();
      else if (moduleFailed.current) window.location.reload();
      else { report({ status: "loading", loaded: 0, total: props.scene.instances.length }); setAttempt((value) => value + 1); }
    }} type="button">重新加载模型</button></div> : null}
    {state.status === "ready" && props.hint ? <span className="model-3d-edit-hint">{props.hint}</span> : null}
    {state.status === "ready" && !props.scene.instances.length ? <div className="model-3d-message"><strong>场景中还没有模型实例</strong><span>从资源列表添加模型</span></div> : null}
  </div>;
}
