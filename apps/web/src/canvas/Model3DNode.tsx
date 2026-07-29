import { memo, useEffect, useRef, useState } from "react";
import type {
  Box3,
  GridHelper,
  Object3D,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";
import { componentLabels, parseModel3DProps, type CanvasNode } from "./types";
import { modelAssetContentUrl } from "./model-assets";

type Model3DNodeProps = {
  editable: boolean;
  node: CanvasNode;
  projectId: string;
};

type LoadState =
  | { status: "empty" }
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

const errorText = (reason: unknown): string =>
  reason instanceof Error ? reason.message : String(reason);

export const Model3DNode = memo(function Model3DNode({
  editable,
  node,
  projectId,
}: Model3DNodeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const gridRef = useRef<GridHelper | null>(null);
  const settingsRef = useRef({
    autoRotate: true,
    rotationSpeed: 0.35,
  });
  const [loadState, setLoadState] = useState<LoadState>(
    node.resourceRefs[0] ? { status: "loading" } : { status: "empty" },
  );
  const parsed = parseModel3DProps(node.props);
  const assetId = node.resourceRefs[0] ?? null;

  useEffect(() => {
    if (!parsed.ok) return;
    settingsRef.current = {
      autoRotate: parsed.value.autoRotate,
      rotationSpeed: parsed.value.rotationSpeed,
    };
    if (sceneRef.current) {
      void import("three").then(({ Color }) => {
        if (sceneRef.current) sceneRef.current.background = new Color(parsed.value.backgroundColor);
      });
    }
    if (gridRef.current) gridRef.current.visible = parsed.value.showGrid;
  }, [parsed.ok ? parsed.value.autoRotate : null, parsed.ok ? parsed.value.backgroundColor : null, parsed.ok ? parsed.value.rotationSpeed : null, parsed.ok ? parsed.value.showGrid : null]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !assetId || !parsed.ok) {
      setLoadState(assetId ? { status: "error", message: parsed.ok ? "3D 容器不可用" : parsed.message } : { status: "empty" });
      return;
    }

    let cancelled = false;
    let dispose: (() => void) | null = null;
    setLoadState({ status: "loading" });

    void Promise.all([
      import("three"),
      import("three/examples/jsm/loaders/GLTFLoader.js"),
      import("three/examples/jsm/controls/OrbitControls.js"),
    ]).then(([THREE, { GLTFLoader }, { OrbitControls }]) => {
      if (cancelled) return;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(parsed.value.backgroundColor);
      sceneRef.current = scene;

      const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 10000);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      container.replaceChildren(renderer.domElement);

      scene.add(new THREE.HemisphereLight(0xdaf4ff, 0x14202a, 2.1));
      const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
      keyLight.position.set(4, 8, 6);
      scene.add(keyLight);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enabled = !editable;
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;

      const grid = new THREE.GridHelper(10, 20, 0x2a7590, 0x163d50);
      grid.visible = parsed.value.showGrid;
      gridRef.current = grid;
      scene.add(grid);

      let modelRoot: Object3D | null = null;
      let modelRadius: number | null = null;
      let visible = true;
      let lastFrame = performance.now();

      const fitCameraToModel = () => {
        if (modelRadius === null) return;
        const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov / 2);
        const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * camera.aspect);
        const limitingHalfFov = Math.max(Math.min(verticalHalfFov, horizontalHalfFov), 0.01);
        // Fit the model's bounding sphere rather than its current AABB so it
        // remains fully visible at every auto-rotation angle.
        const distance = (modelRadius / Math.sin(limitingHalfFov)) * 1.15;
        const viewDirection = new THREE.Vector3(1.35, 0.9, 1.65).normalize();
        camera.position.copy(viewDirection.multiplyScalar(distance));
        controls.target.set(0, 0, 0);
        controls.update();
      };

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

          const box: Box3 = new THREE.Box3().setFromObject(gltf.scene);
          if (box.isEmpty()) {
            setLoadState({ status: "error", message: "模型没有可显示的几何边界" });
            return;
          }

          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const radius = Math.max(size.length() / 2, 0.01);
          const rotationPivot = new THREE.Group();
          gltf.scene.position.sub(center);
          rotationPivot.add(gltf.scene);
          scene.add(rotationPivot);
          modelRoot = rotationPivot;
          modelRadius = radius;
          grid.scale.setScalar(Math.max(radius / 2.5, 0.2));
          grid.position.y = -size.y / 2;
          camera.near = Math.max(radius / 100, 0.001);
          camera.far = Math.max(radius * 100, 100);
          camera.updateProjectionMatrix();
          fitCameraToModel();
          setLoadState({ status: "ready" });
        },
        undefined,
        (reason) => {
          if (!cancelled) {
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
        sceneRef.current = null;
        gridRef.current = null;
        if (container.contains(renderer.domElement)) container.replaceChildren();
      };
    }).catch((reason) => {
      if (!cancelled) {
        setLoadState({ status: "error", message: `3D 引擎加载失败：${errorText(reason)}` });
      }
    });

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [assetId, editable, parsed.ok, projectId]);

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
