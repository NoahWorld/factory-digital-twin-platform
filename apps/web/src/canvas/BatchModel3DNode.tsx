import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Model3DNodeProps } from "./Model3DNode";
import { ModelPresentationPanel } from "./ModelPresentationPanel";
import type { ModelSceneSnapshot } from "./model-scene";
import { componentLabels, parseModel3DProps, resolveModelInstances, type Model3DProps } from "./types";
import type { SceneInput, SceneRuntime, SceneStatus } from "../scene/scene-runtime";

const errorText = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

export const BatchModel3DNode = memo(function BatchModel3DNode({
  cameraControlsEnabled,
  runtimeControlsEnabled = true,
  editable,
  interactive = false,
  maximumModelInstances,
  node,
  onModelInstanceSelect,
  onSceneChange,
  onSceneNodeSelect,
  projectId,
  runtimeAppearanceOverrides = {},
  selectedModelInstanceId = null,
  selectedSceneNodePath,
}: Model3DNodeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<SceneRuntime | null>(null);
  const sceneCallbackRef = useRef(onSceneChange);
  sceneCallbackRef.current = onSceneChange;
  const pointerStartRef = useRef<{
    clientX: number;
    clientY: number;
    pointerId: number;
  } | null>(null);

  const saved = parseModel3DProps(node.props, maximumModelInstances);
  const runtimePanelEnabled = !editable && runtimeControlsEnabled && saved.ok && saved.value.showControlPanel;
  const viewKey = JSON.stringify([projectId, node.id, node.resourceRefs, saved.ok ? saved.value : null, runtimePanelEnabled]);
  const [viewOverride, setViewOverride] = useState<{ key: string; patch: Partial<Model3DProps> } | null>(null);
  const [loadedScene, setLoadedScene] = useState<{ scene: ModelSceneSnapshot; animationCount: number } | null>(null);
  const parsed = saved.ok && runtimePanelEnabled && viewOverride?.key === viewKey
    ? { ok: true as const, value: { ...saved.value, ...viewOverride.patch } }
    : saved;
  const instances = parsed.ok
    ? resolveModelInstances(node.resourceRefs, parsed.value.modelInstances)
    : [];
  const input: SceneInput | null = parsed.ok ? {
    instances, settings: parsed.value, appearanceOverrides: runtimeAppearanceOverrides,
    selectedPath: selectedSceneNodePath, selectedInstanceId: selectedModelInstanceId,
    controlsEnabled: cameraControlsEnabled ?? !editable,
  } : null;
  const inputRef = useRef(input);
  inputRef.current = input;
  const inputSignature = JSON.stringify(input);
  const [loadState, setLoadState] = useState<SceneStatus>(
    instances.length > 0 ? { status: "loading" } : { status: "empty" },
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !inputRef.current) return;
    let cancelled = false;
    let runtime: SceneRuntime | null = null;
    setLoadedScene(null);
    setLoadState({ status: "loading" });
    void import("../scene/scene-runtime").then(({ createSceneRuntime }) => {
      if (cancelled || !inputRef.current) return;
      runtime = createSceneRuntime({
        container, projectId, canvasNodeId: node.id, initial: inputRef.current,
        onStatus: (status) => { if (!cancelled) setLoadState(status); },
        onSnapshot: (snapshot) => {
          if (cancelled) return;
          setLoadedScene(snapshot);
          sceneCallbackRef.current?.(node.id, snapshot?.scene ?? null);
        },
        onDiagnostics: (diagnostics) => {
          // Diagnostic counts only; no renderer, business data or live state enters React.
          container.dataset.sceneDiagnostics = JSON.stringify(diagnostics);
        },
      });
      runtimeRef.current = runtime;
      return runtime.update(inputRef.current);
    }).catch((reason) => {
      if (cancelled) return;
      console.error("Failed to initialize 3D scene runtime.", { projectId, canvasNodeId: node.id, reason });
      setLoadState({ status: "error", message: `3D 场景初始化失败：${errorText(reason)}` });
      runtime?.dispose();
      runtimeRef.current = null;
    });
    return () => {
      cancelled = true;
      runtime?.dispose();
      runtimeRef.current = null;
      sceneCallbackRef.current?.(node.id, null);
    };
  }, [projectId, node.id, parsed.ok]);

  useEffect(() => {
    if (inputRef.current && runtimeRef.current) void runtimeRef.current.update(inputRef.current);
  }, [inputSignature]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((!editable && !interactive) || event.button !== 0) return;
    pointerStartRef.current = { clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId };
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if ((!editable && !interactive) || !start || start.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) > 4) return;
    try {
      const target = runtimeRef.current?.pickSceneTarget(event.clientX, event.clientY) ?? null;
      onModelInstanceSelect?.(node.id, target?.instanceId ?? null);
      onSceneNodeSelect(node.id, target?.path ?? null);
    } catch (reason) {
      console.error("Failed to pick an item in the batched model scene.", { canvasNodeId: node.id, reason });
      setLoadState({ status: "error", message: `节点选择失败：${errorText(reason)}` });
    }
  };

  if (!parsed.ok) {
    return <div className="model-3d-message is-error" role="alert"><strong>{componentLabels[node.type]}配置错误</strong><span>{parsed.message}</span></div>;
  }

  return (
    <div className="model-3d-node">
      <div
        className="model-3d-renderer"
        onPointerCancel={() => {
          pointerStartRef.current = null;
        }}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        ref={containerRef}
      />
      {runtimePanelEnabled && loadState.status === "ready" && loadedScene ? (
        <details className="model-runtime-controls" open key={viewKey}
          onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
          <summary>模型控制面板</summary>
          <ModelPresentationPanel settings={parsed.value} scene={loadedScene.scene}
            animationCount={loadedScene.animationCount} editable runtime onChange={(patch) =>
              setViewOverride((previous) => ({ key: viewKey, patch: { ...(previous?.key === viewKey ? previous.patch : {}), ...patch } }))} />
          <button className="secondary-button model-runtime-reset" type="button" onClick={() => setViewOverride(null)}>恢复预设</button>
        </details>
      ) : null}
      {loadState.status === "loading" ? <div className="model-3d-message"><span className="model-loading-spinner" /><strong>正在加载 {instances.length} 个 3D 模型实例</strong></div> : null}
      {loadState.status === "empty" ? <div className="model-3d-message"><strong>当前场景没有模型实例</strong></div> : null}
      {loadState.status === "error" ? <div className="model-3d-message is-error" role="alert"><strong>批量 3D 场景不可用</strong><span>{loadState.message}</span></div> : null}
    </div>
  );
});
