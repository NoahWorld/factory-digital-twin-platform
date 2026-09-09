import {
  memo,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  AnimationClip,
  AnimationMixer,
  BufferGeometry,
  Material,
  Object3D,
  Quaternion,
  Texture,
  Vector3,
} from "three";
import type { Model3DNodeProps } from "./Model3DNode";
import { ModelPresentationPanel } from "./ModelPresentationPanel";
import { modelAssetContentUrl } from "./model-assets";
import { buildModelSceneTree, type ModelSceneSnapshot } from "./model-scene";
import {
  componentLabels,
  parseModel3DProps,
  resolveModelInstances,
  type Model3DProps,
  type ModelAssetInstance,
  type ModelNodeAppearance,
} from "./types";

type LoadState =
  | { status: "empty" }
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

type MaterialObject = Object3D & {
  material?: Material | Material[];
};

type ColorMaterial = Material & {
  color?: { set: (value: string) => unknown };
  metalness?: number;
  roughness?: number;
};

type OriginalTransform = {
  position: Vector3;
  quaternion: Quaternion;
  scale: Vector3;
};

type InstanceRecord = {
  assetId: string;
  id: string;
  model: Object3D;
  wrapper: Object3D;
  mixer: AnimationMixer | null;
  originals: Map<Object3D, OriginalTransform>;
  originalVisibility: Map<Object3D, boolean>;
  originalMaterials: Map<MaterialObject, Material | Material[]>;
  activeMaterialClones: Map<MaterialObject, Material[]>;
  objectsByName: Map<string, Object3D[]>;
};

type BatchRuntime = {
  applyInstances: (instances: ModelAssetInstance[]) => void;
  applyModelState: (settings: Model3DProps) => void;
  applySceneSettings: (settings: Model3DProps) => void;
  applySelection: (path: string | null) => void;
  pickScenePath: (clientX: number, clientY: number) => string | null;
};

const errorText = (reason: unknown): string =>
  reason instanceof Error ? reason.message : String(reason);

const disposeSourceResources = (root: Object3D) => {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  root.traverse((object) => {
    const owner = object as MaterialObject & { geometry?: BufferGeometry };
    if (owner.geometry) geometries.add(owner.geometry);
    if (owner.material) {
      (Array.isArray(owner.material) ? owner.material : [owner.material])
        .forEach((material) => materials.add(material));
    }
  });
  materials.forEach((material) => {
    Object.values(material).forEach((value: unknown) => {
      if (value && typeof value === "object" && "isTexture" in value && value.isTexture) {
        textures.add(value as Texture);
      }
    });
    material.dispose();
  });
  textures.forEach((texture) => {
    if (typeof ImageBitmap !== "undefined" && texture.image instanceof ImageBitmap) {
      texture.image.close();
    }
    texture.dispose();
  });
  geometries.forEach((geometry) => geometry.dispose());
};

const captureInstanceRecord = (
  assetId: string,
  id: string,
  model: Object3D,
  wrapper: Object3D,
  mixer: AnimationMixer | null,
): InstanceRecord => {
  const originals = new Map<Object3D, OriginalTransform>();
  const originalVisibility = new Map<Object3D, boolean>();
  const originalMaterials = new Map<MaterialObject, Material | Material[]>();
  const objectsByName = new Map<string, Object3D[]>();
  model.traverse((object) => {
    originals.set(object, {
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      scale: object.scale.clone(),
    });
    originalVisibility.set(object, object.visible);
    const materialOwner = object as MaterialObject;
    if (materialOwner.material) originalMaterials.set(materialOwner, materialOwner.material);
    const name = object.name.trim();
    if (name) objectsByName.set(name, [...(objectsByName.get(name) ?? []), object]);
  });
  return {
    assetId,
    id,
    model,
    wrapper,
    mixer,
    originals,
    originalVisibility,
    originalMaterials,
    activeMaterialClones: new Map(),
    objectsByName,
  };
};

export const BatchModel3DNode = memo(function BatchModel3DNode({
  cameraControlsEnabled,
  runtimeControlsEnabled = true,
  editable,
  interactive = false,
  node,
  onSceneChange,
  onSceneNodeSelect,
  projectId,
  runtimeAppearanceOverrides = {},
  selectedSceneNodePath,
}: Model3DNodeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<{ enabled: boolean } | null>(null);
  const controlsEnabledRef = useRef(cameraControlsEnabled ?? !editable);
  controlsEnabledRef.current = cameraControlsEnabled ?? !editable;
  const runtimeRef = useRef<BatchRuntime | null>(null);
  const settingsRef = useRef<Model3DProps | null>(null);
  const runtimeAppearanceOverridesRef = useRef(runtimeAppearanceOverrides);
  runtimeAppearanceOverridesRef.current = runtimeAppearanceOverrides;
  const selectedSceneNodePathRef = useRef(selectedSceneNodePath);
  selectedSceneNodePathRef.current = selectedSceneNodePath;
  const pointerStartRef = useRef<{
    clientX: number;
    clientY: number;
    pointerId: number;
  } | null>(null);

  const saved = parseModel3DProps(node.props);
  const runtimePanelEnabled = !editable && runtimeControlsEnabled && saved.ok && saved.value.showControlPanel;
  const viewKey = JSON.stringify([projectId, node.id, node.resourceRefs, saved.ok ? saved.value : null, runtimePanelEnabled]);
  const [viewOverride, setViewOverride] = useState<{ key: string; patch: Partial<Model3DProps> } | null>(null);
  const [loadedScene, setLoadedScene] = useState<{ scene: ModelSceneSnapshot; animationCount: number } | null>(null);
  const parsed = saved.ok && runtimePanelEnabled && viewOverride?.key === viewKey
    ? { ok: true as const, value: { ...saved.value, ...viewOverride.patch } }
    : saved;
  settingsRef.current = parsed.ok ? parsed.value : null;
  const instances = parsed.ok
    ? resolveModelInstances(node.resourceRefs, parsed.value.modelInstances)
    : [];
  const assetGraphSignature = JSON.stringify(instances.map(({ assetId, id }) => [id, assetId]));
  const instanceStateSignature = JSON.stringify(instances);
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
        parsed.value.modelScale,
        parsed.value.showGrid,
        parsed.value.presentation.lighting,
      ])
    : "";
  const modelStateSignature = parsed.ok
    ? JSON.stringify([
        parsed.value.presentation,
        parsed.value.transformOverrides,
        parsed.value.appearanceOverrides,
        runtimeAppearanceOverrides,
      ])
    : "";
  const [loadState, setLoadState] = useState<LoadState>(
    instances.length > 0 ? { status: "loading" } : { status: "empty" },
  );

  useEffect(() => {
    if (controlsRef.current) controlsRef.current.enabled = cameraControlsEnabled ?? !editable;
  }, [cameraControlsEnabled, editable]);

  useEffect(() => {
    if (!parsed.ok || !runtimeRef.current) return;
    try {
      runtimeRef.current.applySceneSettings(parsed.value);
    } catch (reason) {
      console.error("Failed to apply batched 3D scene settings.", { canvasNodeId: node.id, reason });
      setLoadState({ status: "error", message: `批量场景配置应用失败：${errorText(reason)}` });
    }
  }, [node.id, parsed.ok, sceneSettingsSignature]);

  useEffect(() => {
    if (!parsed.ok || !runtimeRef.current) return;
    try {
      runtimeRef.current.applyInstances(instances);
    } catch (reason) {
      console.error("Failed to apply batched model instance transforms.", { canvasNodeId: node.id, reason });
      setLoadState({ status: "error", message: `模型实例变换应用失败：${errorText(reason)}` });
    }
  }, [instanceStateSignature, node.id, parsed.ok]);

  useEffect(() => {
    if (!parsed.ok || !runtimeRef.current) return;
    try {
      runtimeRef.current.applyModelState(parsed.value);
    } catch (reason) {
      console.error("Failed to apply batched model state.", { canvasNodeId: node.id, reason });
      setLoadState({ status: "error", message: `批量模型状态应用失败：${errorText(reason)}` });
    }
  }, [modelStateSignature, node.id, parsed.ok]);

  useEffect(() => {
    if (!runtimeRef.current) return;
    try {
      runtimeRef.current.applySelection(selectedSceneNodePath);
    } catch (reason) {
      console.error("Failed to highlight a node in the primary batched model.", {
        canvasNodeId: node.id,
        reason,
        selectedSceneNodePath,
      });
      setLoadState({ status: "error", message: `节点高亮失败：${errorText(reason)}` });
    }
  }, [node.id, selectedSceneNodePath]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !parsed.ok || instances.length === 0) {
      onSceneChange?.(node.id, null);
      setLoadState(instances.length === 0
        ? { status: "empty" }
        : { status: "error", message: parsed.ok ? "3D 容器不可用" : parsed.message });
      return;
    }

    let cancelled = false;
    let dispose: (() => void) | null = null;
    let runtimeController: BatchRuntime | null = null;
    runtimeRef.current = null;
    onSceneChange?.(node.id, null);
    setLoadedScene(null);
    setLoadState({ status: "loading" });

    void Promise.all([
      import("three"),
      import("three/examples/jsm/loaders/GLTFLoader.js"),
      import("three/examples/jsm/controls/OrbitControls.js"),
      import("three/examples/jsm/environments/RoomEnvironment.js"),
      import("three/examples/jsm/utils/SkeletonUtils.js"),
    ]).then(async ([THREE, { GLTFLoader }, { OrbitControls }, { RoomEnvironment }, { clone }]) => {
      if (cancelled) return;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(parsed.value.cameraFov, 1, 0.01, 10000);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      container.replaceChildren(renderer.domElement);

      const environmentLight = new THREE.HemisphereLight(parsed.value.environmentLightColor, 0x14202a, parsed.value.environmentLightIntensity);
      const keyLight = new THREE.DirectionalLight(parsed.value.keyLightColor, parsed.value.keyLightIntensity);
      keyLight.position.set(4, 8, 6);
      const rimLight = new THREE.DirectionalLight(0x8cc9ff, 1.3);
      rimLight.position.set(1, 5, -5);
      const warmLight = new THREE.DirectionalLight(0xffbd85, 0.7);
      warmLight.position.set(-6, 3, 0);
      scene.add(environmentLight, keyLight, rimLight, warmLight);

      const grid = new THREE.GridHelper(10, 20, 0x2a7590, 0x163d50);
      scene.add(grid);
      const rotationPivot = new THREE.Group();
      const contentOffset = new THREE.Group();
      rotationPivot.add(contentOffset);
      scene.add(rotationPivot);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enabled = controlsEnabledRef.current;
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controlsRef.current = controls;

      let environmentTarget: ReturnType<InstanceType<typeof THREE.PMREMGenerator>["fromScene"]> | null = null;
      const ensureStudio = () => {
        if (environmentTarget) return;
        const room = new RoomEnvironment();
        const pmrem = new THREE.PMREMGenerator(renderer);
        environmentTarget = pmrem.fromScene(room, 0.04);
        room.dispose();
        pmrem.dispose();
      };

      const sources = new Map<string, { scene: Object3D; animations: AnimationClip[] }>();
      const records: InstanceRecord[] = [];
      let primaryPathsByObject = new Map<Object3D, string>();
      let primaryObjectsByPath = new Map<string, Object3D>();
      let selectionHelper: InstanceType<typeof THREE.BoxHelper> | null = null;
      let modelRadius: number | null = null;
      let visible = true;
      let lastFrame = performance.now();
      let disposed = false;
      let resizeObserver: ResizeObserver | null = null;
      let intersectionObserver: IntersectionObserver | null = null;

      const handleContextLost = (event: Event) => {
        event.preventDefault();
        console.error("Batched 3D scene lost its WebGL context.", {
          canvasNodeId: node.id,
          instanceCount: instances.length,
          uniqueAssetCount: new Set(instances.map((instance) => instance.assetId)).size,
        });
        if (!cancelled) setLoadState({ status: "error", message: "3D 图形上下文已丢失，请减少模型复杂度后重新打开场景。" });
      };

      const clearSelection = () => {
        if (!selectionHelper) return;
        scene.remove(selectionHelper);
        selectionHelper.geometry.dispose();
        selectionHelper.material.dispose();
        selectionHelper = null;
      };

      const disposeClonedMaterials = (record: InstanceRecord) => {
        record.activeMaterialClones.forEach((materials, owner) => {
          owner.material = record.originalMaterials.get(owner);
          materials.forEach((material) => material.dispose());
        });
        record.activeMaterialClones.clear();
      };

      const disposeRuntime = () => {
        if (disposed) return;
        disposed = true;
        renderer.setAnimationLoop(null);
        resizeObserver?.disconnect();
        intersectionObserver?.disconnect();
        renderer.domElement.removeEventListener("webglcontextlost", handleContextLost);
        controls.dispose();
        clearSelection();
        records.forEach((record) => {
          record.mixer?.stopAllAction();
          record.mixer?.uncacheRoot(record.model);
          disposeClonedMaterials(record);
        });
        sources.forEach((source) => disposeSourceResources(source.scene));
        sources.clear();
        grid.geometry.dispose();
        if (Array.isArray(grid.material)) grid.material.forEach((material) => material.dispose());
        else grid.material.dispose();
        environmentTarget?.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        if (controlsRef.current === controls) controlsRef.current = null;
        if (runtimeRef.current === runtimeController) runtimeRef.current = null;
        if (container.contains(renderer.domElement)) container.replaceChildren();
      };
      dispose = disposeRuntime;
      renderer.domElement.addEventListener("webglcontextlost", handleContextLost);

      const fitCameraToScene = () => {
        if (modelRadius === null) return;
        const settings = settingsRef.current;
        if (!settings) throw new Error("当前批量 3D 场景配置不可用");
        const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov / 2);
        const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * camera.aspect);
        const limitingHalfFov = Math.max(Math.min(verticalHalfFov, horizontalHalfFov), 0.01);
        const distance = (modelRadius / Math.sin(limitingHalfFov)) * 1.15;
        const direction = settings.cameraView === "front"
          ? new THREE.Vector3(0, 0.12, 1)
          : settings.cameraView === "top"
            ? new THREE.Vector3(0.001, 1, 0)
            : settings.cameraView === "isometric-left"
              ? new THREE.Vector3(-1.35, 0.78, 1.78)
              : new THREE.Vector3(1.35, 0.9, 1.65);
        camera.up.set(0, settings.cameraView === "top" ? 0 : 1, settings.cameraView === "top" ? -1 : 0);
        camera.position.copy(direction.normalize().multiplyScalar(distance));
        controls.target.set(0, 0, 0);
        controls.update();
      };

      const updateSceneBounds = () => {
        contentOffset.position.set(0, 0, 0);
        const priorRotation = rotationPivot.rotation.y;
        rotationPivot.rotation.y = 0;
        scene.updateMatrixWorld(true);
        const box = new THREE.Box3();
        let hasVisibleGeometry = false;
        for (const record of records) {
          if (!record.wrapper.visible) continue;
          const instanceBox = new THREE.Box3().setFromObject(record.wrapper);
          if (!instanceBox.isEmpty()) {
            box.union(instanceBox);
            hasVisibleGeometry = true;
          }
        }
        if (!hasVisibleGeometry) {
          rotationPivot.rotation.y = priorRotation;
          modelRadius = null;
          return;
        }
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        if (![center.x, center.y, center.z, size.x, size.y, size.z].every(Number.isFinite)) {
          throw new Error("模型实例变换产生了无效的场景边界");
        }
        contentOffset.position.copy(center).multiplyScalar(-1);
        rotationPivot.rotation.y = priorRotation;
        scene.updateMatrixWorld(true);
        modelRadius = Math.max(size.length() / 2, 0.01);
        grid.scale.setScalar(Math.max(modelRadius / 2.5, 0.2));
        grid.position.y = -size.y / 2;
        camera.near = Math.max(modelRadius / 100, 0.001);
        camera.far = Math.max(modelRadius * 100, 100);
        camera.updateProjectionMatrix();
        fitCameraToScene();
      };

      const applySceneSettings = (settings: Model3DProps) => {
        const studio = settings.presentation.lighting === "studio";
        if (studio) ensureStudio();
        scene.environment = studio ? environmentTarget!.texture : null;
        scene.environmentIntensity = 0.8;
        scene.background = settings.backgroundOpacity === 1 ? new THREE.Color(settings.backgroundColor) : null;
        renderer.setClearColor(settings.backgroundColor, settings.backgroundOpacity);
        renderer.toneMappingExposure = studio ? 0.9 : 1.15;
        environmentLight.color.set(settings.environmentLightColor);
        environmentLight.intensity = settings.environmentLightIntensity;
        keyLight.color.set(settings.keyLightColor);
        keyLight.intensity = settings.keyLightIntensity;
        rimLight.visible = studio;
        warmLight.visible = studio;
        grid.visible = settings.showGrid;
        camera.fov = settings.cameraFov;
        camera.zoom = settings.modelScale;
        camera.updateProjectionMatrix();
        fitCameraToScene();
      };

      const applyInstances = (nextInstances: ModelAssetInstance[]) => {
        const byId = new Map(nextInstances.map((instance) => [instance.id, instance]));
        if (byId.size !== records.length || records.some((record) => byId.get(record.id)?.assetId !== record.assetId)) {
          throw new Error("模型实例资源结构已变化，等待场景重新加载");
        }
        records.forEach((record) => {
          const instance = byId.get(record.id)!;
          record.wrapper.position.set(...instance.transform.position);
          record.wrapper.rotation.set(
            THREE.MathUtils.degToRad(instance.transform.rotation[0]),
            THREE.MathUtils.degToRad(instance.transform.rotation[1]),
            THREE.MathUtils.degToRad(instance.transform.rotation[2]),
          );
          record.wrapper.scale.set(...instance.transform.scale);
          record.wrapper.visible = instance.visible;
          record.wrapper.name = instance.label;
        });
        updateSceneBounds();
      };

      const restoreRecord = (record: InstanceRecord) => {
        disposeClonedMaterials(record);
        record.originals.forEach((original, object) => {
          object.position.copy(original.position);
          object.quaternion.copy(original.quaternion);
          object.scale.copy(original.scale);
        });
        record.originalVisibility.forEach((original, object) => {
          object.visible = original;
        });
      };

      const cloneMaterials = (record: InstanceRecord, owner: MaterialObject): Material[] => {
        const active = record.activeMaterialClones.get(owner);
        if (active) return active;
        const original = record.originalMaterials.get(owner);
        if (!original) return [];
        const clones = (Array.isArray(original) ? original : [original]).map((material) => material.clone());
        owner.material = Array.isArray(original) ? clones : clones[0];
        record.activeMaterialClones.set(owner, clones);
        return clones;
      };

      const applyAppearance = (record: InstanceRecord, overrides: Record<string, ModelNodeAppearance>) => {
        for (const [nodeName, appearance] of Object.entries(overrides)) {
          const matches = record.objectsByName.get(nodeName);
          if (!matches || matches.length === 0) throw new Error(`主模型中找不到已配置节点：${nodeName}`);
          if (matches.length > 1) throw new Error(`主模型节点名不唯一，不能应用外观：${nodeName}`);
          const object = matches[0]!;
          object.visible = appearance.visible;
          object.traverse((descendant) => {
            cloneMaterials(record, descendant as MaterialObject).forEach((material) => {
              const colorMaterial = material as ColorMaterial;
              colorMaterial.color?.set(appearance.color);
              material.opacity = appearance.opacity;
              material.transparent = appearance.opacity < 1;
              material.depthWrite = appearance.opacity === 1;
              material.needsUpdate = true;
            });
          });
        }
      };

      const applyModelState = (settings: Model3DProps) => {
        records.forEach(restoreRecord);
        const primary = records[0];
        if (!primary) throw new Error("批量场景缺少主模型实例");
        for (const [nodeName, transform] of Object.entries(settings.transformOverrides)) {
          const matches = primary.objectsByName.get(nodeName);
          if (!matches || matches.length === 0) throw new Error(`主模型中找不到已配置节点：${nodeName}`);
          matches.forEach((object) => {
            object.position.set(...transform.position);
            object.rotation.set(
              THREE.MathUtils.degToRad(transform.rotation[0]),
              THREE.MathUtils.degToRad(transform.rotation[1]),
              THREE.MathUtils.degToRad(transform.rotation[2]),
              object.rotation.order,
            );
            object.scale.set(...transform.scale);
          });
        }

        records.forEach((record) => {
          record.model.traverse((object) => {
            const offset = object.userData.explodeOffset as [number, number, number] | undefined;
            if (offset) {
              object.position.x += offset[0] * settings.presentation.explosion;
              object.position.y += offset[1] * settings.presentation.explosion;
              object.position.z += offset[2] * settings.presentation.explosion;
            }
            if (object.userData.inspectionShell === true) {
              if (settings.presentation.shellMode === "hidden") object.visible = false;
              if (settings.presentation.shellMode === "solid") {
                cloneMaterials(record, object as MaterialObject).forEach((material) => {
                  const physical = material as ColorMaterial;
                  physical.color?.set("#42637b");
                  physical.opacity = 1;
                  physical.transparent = false;
                  physical.depthWrite = true;
                  if (physical.metalness !== undefined) physical.metalness = 0.8;
                  if (physical.roughness !== undefined) physical.roughness = 0.32;
                  physical.needsUpdate = true;
                });
              }
            }
            if (
              (object.userData.category === "flow" || object.userData.category === "animation")
              && (!settings.presentation.showFlow || settings.presentation.explosion > 0)
            ) {
              object.visible = false;
            }
          });
        });
        applyAppearance(primary, {
          ...settings.appearanceOverrides,
          ...runtimeAppearanceOverridesRef.current,
        });
        updateSceneBounds();
      };

      const applySelection = (path: string | null) => {
        clearSelection();
        if (path === null) return;
        const selected = primaryObjectsByPath.get(path);
        if (!selected) throw new Error(`主模型中找不到当前选择路径：${path}`);
        if (new THREE.Box3().setFromObject(selected).isEmpty()) return;
        selectionHelper = new THREE.BoxHelper(selected, 0x5ad8ff);
        selectionHelper.material.depthTest = false;
        selectionHelper.material.transparent = true;
        selectionHelper.material.opacity = 0.95;
        selectionHelper.material.toneMapped = false;
        selectionHelper.renderOrder = 100000;
        scene.add(selectionHelper);
      };

      const isEffectivelyVisible = (object: Object3D) => {
        let current: Object3D | null = object;
        while (current) {
          if (!current.visible) return false;
          current = current.parent;
        }
        return true;
      };
      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      const pickScenePath = (clientX: number, clientY: number) => {
        const primary = records[0];
        if (!primary?.wrapper.visible) return null;
        const bounds = renderer.domElement.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.height <= 0) throw new Error("3D 视窗尺寸无效，无法执行对象命中测试");
        pointer.set(((clientX - bounds.left) / bounds.width) * 2 - 1, -((clientY - bounds.top) / bounds.height) * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObject(primary.model, true).find((intersection) =>
          primaryPathsByObject.has(intersection.object) && isEffectivelyVisible(intersection.object));
        return hit ? primaryPathsByObject.get(hit.object) ?? null : null;
      };

      const resize = () => {
        const width = Math.max(container.clientWidth, 1);
        const height = Math.max(container.clientHeight, 1);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        fitCameraToScene();
      };
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(container);
      resize();
      intersectionObserver = new IntersectionObserver(([entry]) => {
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
        const settings = settingsRef.current;
        if (settings?.playAnimations) {
          records.forEach((record) => record.mixer?.update(deltaSeconds * settings.animationSpeed));
        }
        if (settings?.autoRotate) rotationPivot.rotation.y += deltaSeconds * settings.rotationSpeed;
        selectionHelper?.update();
        controls.update();
        renderer.render(scene, camera);
      });

      const uniqueAssetIds = [...new Set(instances.map((instance) => instance.assetId))];
      const loader = new GLTFLoader();
      const results = await Promise.allSettled(uniqueAssetIds.map(async (assetId) => {
        try {
          const gltf = await loader.loadAsync(modelAssetContentUrl(projectId, assetId));
          return { assetId, animations: gltf.animations, scene: gltf.scene };
        } catch (reason) {
          throw new Error(`模型资源 ${assetId} 加载失败：${errorText(reason)}`);
        }
      }));
      const successfulSources = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      if (cancelled) {
        successfulSources.forEach((source) => disposeSourceResources(source.scene));
        return;
      }
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") {
        successfulSources.forEach((source) => disposeSourceResources(source.scene));
        throw failed.reason;
      }
      successfulSources.forEach((source) => sources.set(source.assetId, source));

      let primarySceneTree: ReturnType<typeof buildModelSceneTree> | null = null;
      let totalAnimationCount = 0;
      for (const [index, instance] of instances.entries()) {
        const source = sources.get(instance.assetId);
        if (!source) throw new Error(`已加载资源中缺少模型 ${instance.assetId}`);
        const model = clone(source.scene) as Object3D;
        const modelBounds = new THREE.Box3().setFromObject(model);
        if (modelBounds.isEmpty()) throw new Error(`模型实例“${instance.label}”没有可显示的几何边界`);
        const wrapper = new THREE.Group();
        wrapper.name = instance.label;
        wrapper.userData.modelInstanceId = instance.id;
        wrapper.userData.modelAssetId = instance.assetId;
        wrapper.add(model);
        contentOffset.add(wrapper);
        const mixer = source.animations.length > 0 ? new THREE.AnimationMixer(model) : null;
        source.animations.forEach((clip) => mixer?.clipAction(clip).play());
        totalAnimationCount += source.animations.length;
        const record = captureInstanceRecord(instance.assetId, instance.id, model, wrapper, mixer);
        records.push(record);
        if (index === 0) {
          primarySceneTree = buildModelSceneTree(model);
          const stack = model.children.map((object, childIndex) => ({ object, path: String(childIndex) })).reverse();
          while (stack.length > 0) {
            const entry = stack.pop()!;
            primaryObjectsByPath.set(entry.path, entry.object);
            primaryPathsByObject.set(entry.object, entry.path);
            for (let childIndex = entry.object.children.length - 1; childIndex >= 0; childIndex -= 1) {
              stack.push({ object: entry.object.children[childIndex]!, path: `${entry.path}/${childIndex}` });
            }
          }
        }
      }
      if (!primarySceneTree) throw new Error("批量场景没有可用的主模型");

      const latestSettings = settingsRef.current;
      if (!latestSettings) throw new Error("批量模型加载完成时场景配置不可用");
      applyInstances(resolveModelInstances(node.resourceRefs, latestSettings.modelInstances));
      applySceneSettings(latestSettings);
      applyModelState(latestSettings);
      applySelection(selectedSceneNodePathRef.current);

      runtimeController = { applyInstances, applyModelState, applySceneSettings, applySelection, pickScenePath };
      runtimeRef.current = runtimeController;
      const snapshot = { assetId: instances[0]!.assetId, ...primarySceneTree };
      setLoadedScene({ scene: snapshot, animationCount: totalAnimationCount });
      onSceneChange?.(node.id, snapshot);
      setLoadState({ status: "ready" });
      console.info("Loaded batched 3D scene with a shared renderer.", {
        canvasNodeId: node.id,
        instanceCount: instances.length,
        uniqueAssetCount: uniqueAssetIds.length,
        animationClipCount: totalAnimationCount,
      });
    }).catch((reason) => {
      if (!cancelled) {
        console.error("Failed to initialize batched 3D scene.", {
          canvasNodeId: node.id,
          instanceCount: instances.length,
          reason,
        });
        onSceneChange?.(node.id, null);
        setLoadState({ status: "error", message: `批量 3D 场景加载失败：${errorText(reason)}` });
        dispose?.();
        dispose = null;
      }
    });

    return () => {
      cancelled = true;
      onSceneChange?.(node.id, null);
      dispose?.();
    };
  }, [assetGraphSignature, node.id, onSceneChange, parsed.ok, projectId]);

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
      onSceneNodeSelect(node.id, runtimeRef.current?.pickScenePath(event.clientX, event.clientY) ?? null);
    } catch (reason) {
      console.error("Failed to pick a node in the primary batched model.", { canvasNodeId: node.id, reason });
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
