import { memo, useEffect, useRef, useState } from "react";
import type { Object3D } from "three";
import {
  componentLabels,
  parseModel3DProps,
  type CanvasNode,
  type Model3DProps,
  type ModelNodeTransform,
} from "./types";
import { modelAssetContentUrl } from "./model-assets";
import { buildModelSceneTree, type ModelSceneSnapshot } from "./model-scene";

type Model3DNodeProps = {
  editable: boolean;
  node: CanvasNode;
  onSceneChange?: (canvasNodeId: string, snapshot: ModelSceneSnapshot | null) => void;
  projectId: string;
};

type LoadState =
  | { status: "empty" }
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

type ModelRuntime = {
  applySceneSettings: (settings: Model3DProps) => void;
  applyTransforms: (overrides: Record<string, ModelNodeTransform>) => void;
};

const errorText = (reason: unknown): string =>
  reason instanceof Error ? reason.message : String(reason);

export const Model3DNode = memo(function Model3DNode({
  editable,
  node,
  onSceneChange,
  projectId,
}: Model3DNodeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<{ enabled: boolean } | null>(null);
  const runtimeRef = useRef<ModelRuntime | null>(null);
  const modelPropsRef = useRef<Model3DProps | null>(null);
  const settingsRef = useRef({
    autoRotate: true,
    rotationSpeed: 0.35,
  });
  const [loadState, setLoadState] = useState<LoadState>(
    node.resourceRefs[0] ? { status: "loading" } : { status: "empty" },
  );
  const parsed = parseModel3DProps(node.props);
  modelPropsRef.current = parsed.ok ? parsed.value : null;
  const assetId = node.resourceRefs[0] ?? null;
  const transformOverridesSignature = parsed.ok
    ? JSON.stringify(parsed.value.transformOverrides)
    : "";
  const sceneSettingsSignature = parsed.ok
    ? JSON.stringify([
        parsed.value.backgroundColor,
        parsed.value.backgroundOpacity,
        parsed.value.environmentLightColor,
        parsed.value.environmentLightIntensity,
        parsed.value.keyLightColor,
        parsed.value.keyLightIntensity,
        parsed.value.cameraFov,
        parsed.value.cameraView,
        parsed.value.showGrid,
      ])
    : "";

  useEffect(() => {
    if (!parsed.ok) return;
    settingsRef.current = {
      autoRotate: parsed.value.autoRotate,
      rotationSpeed: parsed.value.rotationSpeed,
    };
  }, [
    parsed.ok ? parsed.value.autoRotate : null,
    parsed.ok ? parsed.value.rotationSpeed : null,
  ]);

  useEffect(() => {
    if (!parsed.ok || !runtimeRef.current) return;
    try {
      runtimeRef.current.applySceneSettings(parsed.value);
      setLoadState({ status: "ready" });
    } catch (reason) {
      console.error("Failed to apply 3D scene settings.", {
        assetId,
        canvasNodeId: node.id,
        reason,
      });
      setLoadState({
        status: "error",
        message: `场景配置应用失败：${errorText(reason)}`,
      });
    }
  }, [assetId, node.id, parsed.ok, sceneSettingsSignature]);

  useEffect(() => {
    if (controlsRef.current) controlsRef.current.enabled = !editable;
  }, [editable]);

  useEffect(() => {
    if (!parsed.ok || !runtimeRef.current) return;
    try {
      runtimeRef.current.applyTransforms(parsed.value.transformOverrides);
      setLoadState({ status: "ready" });
    } catch (reason) {
      console.error("Failed to apply model node transforms.", {
        assetId,
        canvasNodeId: node.id,
        reason,
      });
      setLoadState({
        status: "error",
        message: `节点变换应用失败：${errorText(reason)}`,
      });
    }
  }, [assetId, node.id, parsed.ok, transformOverridesSignature]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !assetId || !parsed.ok) {
      onSceneChange?.(node.id, null);
      setLoadState(assetId ? { status: "error", message: parsed.ok ? "3D 容器不可用" : parsed.message } : { status: "empty" });
      return;
    }

    let cancelled = false;
    let dispose: (() => void) | null = null;
    let runtimeController: ModelRuntime | null = null;
    runtimeRef.current = null;
    onSceneChange?.(node.id, null);
    setLoadState({ status: "loading" });

    void Promise.all([
      import("three"),
      import("three/examples/jsm/loaders/GLTFLoader.js"),
      import("three/examples/jsm/controls/OrbitControls.js"),
    ]).then(([THREE, { GLTFLoader }, { OrbitControls }]) => {
      if (cancelled) return;

      const scene = new THREE.Scene();
      scene.background = null;

      const camera = new THREE.PerspectiveCamera(
        parsed.value.cameraFov,
        1,
        0.01,
        10000,
      );
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      container.replaceChildren(renderer.domElement);

      const environmentLight = new THREE.HemisphereLight(
        parsed.value.environmentLightColor,
        0x14202a,
        parsed.value.environmentLightIntensity,
      );
      scene.add(environmentLight);
      const keyLight = new THREE.DirectionalLight(
        parsed.value.keyLightColor,
        parsed.value.keyLightIntensity,
      );
      keyLight.position.set(4, 8, 6);
      scene.add(keyLight);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enabled = !editable;
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controlsRef.current = controls;

      const grid = new THREE.GridHelper(10, 20, 0x2a7590, 0x163d50);
      grid.visible = parsed.value.showGrid;
      scene.add(grid);

      let modelRoot: Object3D | null = null;
      let modelRadius: number | null = null;
      let visible = true;
      let lastFrame = performance.now();

      const fitCameraToModel = () => {
        if (modelRadius === null) return;
        const settings = modelPropsRef.current;
        if (!settings) {
          throw new Error("当前 3D 场景配置不可用");
        }
        const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov / 2);
        const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * camera.aspect);
        const limitingHalfFov = Math.max(Math.min(verticalHalfFov, horizontalHalfFov), 0.01);
        // Fit the model's bounding sphere rather than its current AABB so it
        // remains fully visible at every auto-rotation angle.
        const distance = (modelRadius / Math.sin(limitingHalfFov)) * 1.15;
        const viewDirection = settings.cameraView === "front"
          ? new THREE.Vector3(0, 0.12, 1)
          : settings.cameraView === "top"
            ? new THREE.Vector3(0.001, 1, 0)
            : new THREE.Vector3(1.35, 0.9, 1.65);
        camera.up.set(
          0,
          settings.cameraView === "top" ? 0 : 1,
          settings.cameraView === "top" ? -1 : 0,
        );
        camera.position.copy(viewDirection.normalize().multiplyScalar(distance));
        controls.target.set(0, 0, 0);
        controls.update();
      };

      const applySceneSettings = (settings: Model3DProps) => {
        renderer.setClearColor(settings.backgroundColor, settings.backgroundOpacity);
        environmentLight.color.set(settings.environmentLightColor);
        environmentLight.intensity = settings.environmentLightIntensity;
        keyLight.color.set(settings.keyLightColor);
        keyLight.intensity = settings.keyLightIntensity;
        grid.visible = settings.showGrid;
        camera.fov = settings.cameraFov;
        camera.updateProjectionMatrix();
        fitCameraToModel();
      };

      const initialSettings = modelPropsRef.current;
      if (!initialSettings) {
        throw new Error("3D 场景初始化时没有可用配置");
      }
      applySceneSettings(initialSettings);

      const resize = () => {
        const width = Math.max(container.clientWidth, 1);
        const height = Math.max(container.clientHeight, 1);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        fitCameraToModel();
      };
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(container);
      resize();

      const intersectionObserver = new IntersectionObserver(([entry]) => {
        visible = entry?.isIntersecting ?? false;
      });
      intersectionObserver.observe(container);

      renderer.setAnimationLoop((now) => {
        if (!visible || document.hidden) {
          lastFrame = now;
          return;
        }
        const deltaSeconds = Math.min((now - lastFrame) / 1000, 0.1);
        lastFrame = now;
        if (modelRoot && settingsRef.current.autoRotate) {
          modelRoot.rotation.y += deltaSeconds * settingsRef.current.rotationSpeed;
        }
        controls.update();
        renderer.render(scene, camera);
      });

      const loader = new GLTFLoader();
      loader.load(
        modelAssetContentUrl(projectId, assetId),
        (gltf) => {
          if (cancelled) return;

          const sceneTree = buildModelSceneTree(gltf.scene);
          const originals = new Map<Object3D, {
            position: InstanceType<typeof THREE.Vector3>;
            quaternion: InstanceType<typeof THREE.Quaternion>;
            scale: InstanceType<typeof THREE.Vector3>;
          }>();
          const objectsByName = new Map<string, Object3D[]>();
          gltf.scene.traverse((object) => {
            originals.set(object, {
              position: object.position.clone(),
              quaternion: object.quaternion.clone(),
              scale: object.scale.clone(),
            });
            const name = object.name.trim();
            if (!name) return;
            const matches = objectsByName.get(name) ?? [];
            matches.push(object);
            objectsByName.set(name, matches);
          });

          const rotationPivot = new THREE.Group();
          const contentOffset = new THREE.Group();
          contentOffset.add(gltf.scene);
          rotationPivot.add(contentOffset);
          scene.add(rotationPivot);
          modelRoot = rotationPivot;

          const applyTransforms = (
            overrides: Record<string, ModelNodeTransform>,
          ) => {
            contentOffset.position.set(0, 0, 0);
            originals.forEach((original, object) => {
              object.position.copy(original.position);
              object.quaternion.copy(original.quaternion);
              object.scale.copy(original.scale);
            });

            for (const [nodeName, transform] of Object.entries(overrides)) {
              const matches = objectsByName.get(nodeName);
              if (!matches || matches.length === 0) {
                throw new Error(`模型中找不到已配置节点：${nodeName}`);
              }
              for (const object of matches) {
                object.position.set(...transform.position);
                object.rotation.set(
                  THREE.MathUtils.degToRad(transform.rotation[0]),
                  THREE.MathUtils.degToRad(transform.rotation[1]),
                  THREE.MathUtils.degToRad(transform.rotation[2]),
                  object.rotation.order,
                );
                object.scale.set(...transform.scale);
              }
            }

            gltf.scene.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(gltf.scene);
            if (box.isEmpty()) {
              throw new Error("模型没有可显示的几何边界");
            }
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            if (
              !Number.isFinite(center.x)
              || !Number.isFinite(center.y)
              || !Number.isFinite(center.z)
              || !Number.isFinite(size.x)
              || !Number.isFinite(size.y)
              || !Number.isFinite(size.z)
            ) {
              throw new Error("节点变换产生了无效的模型边界");
            }

            contentOffset.position.copy(center).multiplyScalar(-1);
            contentOffset.updateMatrixWorld(true);
            const radius = Math.max(size.length() / 2, 0.01);
            modelRadius = radius;
            grid.scale.setScalar(Math.max(radius / 2.5, 0.2));
            grid.position.y = -size.y / 2;
            camera.near = Math.max(radius / 100, 0.001);
            camera.far = Math.max(radius * 100, 100);
            camera.updateProjectionMatrix();
            fitCameraToModel();
          };

          try {
            const latestSettings = modelPropsRef.current;
            if (!latestSettings) {
              throw new Error("模型加载完成时 3D 场景配置不可用");
            }
            applySceneSettings(latestSettings);
            applyTransforms(latestSettings.transformOverrides);
          } catch (reason) {
            console.error("Failed to initialize the 3D model scene.", {
              assetId,
              canvasNodeId: node.id,
              reason,
            });
            onSceneChange?.(node.id, null);
            setLoadState({
              status: "error",
              message: `3D 场景初始化失败：${errorText(reason)}`,
            });
            return;
          }

          runtimeController = { applySceneSettings, applyTransforms };
          runtimeRef.current = runtimeController;
          onSceneChange?.(node.id, { assetId, ...sceneTree });
          setLoadState({ status: "ready" });
        },
        undefined,
        (reason) => {
          if (!cancelled) {
            onSceneChange?.(node.id, null);
            setLoadState({ status: "error", message: `模型加载失败：${errorText(reason)}` });
          }
        },
      );

      dispose = () => {
        renderer.setAnimationLoop(null);
        resizeObserver.disconnect();
        intersectionObserver.disconnect();
        controls.dispose();
        scene.traverse((object) => {
          const candidate = object as Object3D & {
            geometry?: { dispose: () => void };
            material?: { dispose: () => void } | Array<{ dispose: () => void }>;
          };
          candidate.geometry?.dispose();
          if (Array.isArray(candidate.material)) {
            candidate.material.forEach((material) => material.dispose());
          } else {
            candidate.material?.dispose();
          }
        });
        renderer.dispose();
        renderer.forceContextLoss();
        if (controlsRef.current === controls) controlsRef.current = null;
        if (runtimeRef.current === runtimeController) runtimeRef.current = null;
        if (container.contains(renderer.domElement)) container.replaceChildren();
      };
    }).catch((reason) => {
      if (!cancelled) {
        onSceneChange?.(node.id, null);
        setLoadState({ status: "error", message: `3D 引擎加载失败：${errorText(reason)}` });
      }
    });

    return () => {
      cancelled = true;
      onSceneChange?.(node.id, null);
      dispose?.();
    };
  }, [assetId, node.id, onSceneChange, parsed.ok, projectId]);

  if (!parsed.ok) {
    return <div className="model-3d-message is-error" role="alert"><strong>{componentLabels[node.type]}配置错误</strong><span>{parsed.message}</span></div>;
  }

  return (
    <div className="model-3d-node">
      <div className="model-3d-renderer" ref={containerRef} />
      {loadState.status === "empty" ? <div className="model-3d-message"><strong>尚未绑定模型</strong><span>在右侧属性面板导入 GLB 或 GLTF</span></div> : null}
      {loadState.status === "loading" ? <div className="model-3d-message"><span className="model-loading-spinner" /><strong>正在加载 3D 模型</strong></div> : null}
      {loadState.status === "error" ? <div className="model-3d-message is-error" role="alert"><strong>3D 模型不可用</strong><span>{loadState.message}</span></div> : null}
      {loadState.status === "ready" && editable ? <span className="model-3d-edit-hint">预览模式可旋转与缩放视角</span> : null}
    </div>
  );
});
