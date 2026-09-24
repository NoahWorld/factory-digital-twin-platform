import { useEffect, useMemo, useRef, useState } from "react";
import { findBuiltinModel } from "../../../../shared/builtin-models";
import { createCanvasNode, type Model3DProps, type ModelCameraView } from "../canvas/types";
import type { SceneInput, SceneRuntime, SceneStatus } from "../scene/scene-runtime";
import { demoDevices } from "./industrial-demo-scene";

// The AGV's clip travels 5.5 m through the workshop. The detail stand shows its parked pose;
// joint and machining clips can play in place. Locomotion remains in the full workshop demo.
const detailAnimations = { "robot-arm-v2": true, "production-machine-v2": true, "agv-v2": false } as const;

export const showcaseModels = demoDevices.map((device) => {
  const assetId = `builtin:workshop-${device.kind}`;
  const asset = findBuiltinModel(assetId);
  if (!asset) throw new Error(`宣传展台引用了未注册的公共模型：${assetId}`);
  return { ...device, asset, detailAnimation: detailAnimations[device.kind] };
});

export type ShowcaseModel = (typeof showcaseModels)[number];
const baseProps = createCanvasNode("model-3d", 0, 0, 0).props as Model3DProps;

/** One lazy runtime for the entire model selector; page scrolling never controls OrbitControls. */
export function PublicShowcaseModel({ model, playing, view }: {
  model: ShowcaseModel;
  playing: boolean;
  view: ModelCameraView;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const runtime = useRef<SceneRuntime | null>(null);
  const [nearby, setNearby] = useState(false);
  const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState<SceneStatus>({ status: "loading" });
  const input = useMemo<SceneInput>(() => ({
    instances: [{ id: "showcase-device", assetId: model.asset.id, label: model.shortName, visible: true,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      animation: { enabled: model.detailAnimation, speed: 0.55 } }],
    settings: { ...baseProps, ...model.asset.defaults, backgroundOpacity: 0,
      cameraView: view, cameraFov: 36, modelScale: 1.15,
      autoRotate: false, playAnimations: playing, showGrid: false, showControlPanel: false },
    appearanceOverrides: {}, selectedPath: null, selectedInstanceId: null,
    selectionStyle: "none", controlsEnabled: false, instanceTransformMode: null,
  }), [model, playing, view]);
  const latestInput = useRef(input);
  latestInput.current = input;

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setNearby(true); observer.disconnect(); }
    }, { rootMargin: "240px" });
    if (surface.current) observer.observe(surface.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = surface.current;
    if (!nearby || !container) return;
    let disposed = false;
    let created: SceneRuntime | null = null;
    let resize: ResizeObserver | null = null;
    let framedModel: string | null = null;
    setStatus({ status: "loading" });
    void import("../scene/scene-runtime").then(({ createSceneRuntime }) => {
      if (disposed) return;
      created = createSceneRuntime({
        container, projectId: "public-delivery-story", canvasNodeId: "public-delivery-story",
        initial: latestInput.current,
        resolveModelUrl: (id) => {
          const allowed = showcaseModels.find((item) => item.asset.id === id);
          if (!allowed) throw new Error(`宣传展台不允许访问此模型：${id}`);
          return `${import.meta.env.BASE_URL}${allowed.asset.contentPath.slice(1)}`;
        },
        onStatus: (value) => {
          if (disposed) return;
          setStatus(value);
          const frameKey = `${latestInput.current.instances[0].assetId}:${latestInput.current.settings.cameraView}`;
          if (value.status === "ready" && framedModel !== frameKey) {
            created?.resetCamera();
            framedModel = frameKey;
          }
        },
        onSnapshot: () => { /* Public visual demonstration: no business bindings. */ },
      });
      runtime.current = created;
      resize = new ResizeObserver(([entry]) => {
        if (entry.contentRect.width > 0 && entry.contentRect.height > 0) created?.resetCamera();
      });
      resize.observe(container);
      return created.update(latestInput.current);
    }).catch((reason: unknown) => {
      if (disposed) return;
      console.error("public.delivery-story.failed", { assetId: latestInput.current.instances[0].assetId, reason });
      setStatus({ status: "error", message: reason instanceof Error ? reason.message : String(reason) });
      created?.dispose();
      runtime.current = null;
    });
    return () => { disposed = true; resize?.disconnect(); created?.dispose(); runtime.current = null; };
  }, [nearby, retry]);

  useEffect(() => { if (runtime.current) void runtime.current.update(input); }, [input]);

  return <div className="delivery-public-model" data-model-status={status.status} data-model-id={model.asset.id}>
    <div ref={surface} className="delivery-public-model-canvas" role="img" aria-label={`${model.shortName}的三维模型，使用下方按钮切换视角`} />
    {status.status !== "ready" && <div className="delivery-public-model-status" role={status.status === "error" ? "alert" : "status"}>
      <strong>{status.status === "error" ? "模型加载失败" : "正在准备设备模型"}</strong>
      <p>{status.status === "error" ? status.message : nearby ? "加载公开模型与材质…" : "滚动到此处即可查看。"}</p>
      {status.status === "error" && <button type="button" onClick={() => setRetry(value => value + 1)}>重新加载模型</button>}
    </div>}
  </div>;
}
