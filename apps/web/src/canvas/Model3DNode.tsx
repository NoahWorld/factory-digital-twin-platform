import {
  memo,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { BufferGeometry, Material, Object3D, Texture } from "three";
import {
  componentLabels,
  parseModel3DProps,
  type CanvasNode,
  type Model3DProps,
  type ModelNodeAppearance,
  type ModelNodeTransform,
} from "./types";
import { ModelPresentationPanel } from "./ModelPresentationPanel";
import { BatchModel3DNode } from "./BatchModel3DNode";
import { modelAssetContentUrl } from "./model-assets";
import { buildModelSceneTree, type ModelSceneSnapshot } from "./model-scene";

export type Model3DNodeProps = {
  cameraControlsEnabled?: boolean;
  runtimeControlsEnabled?: boolean;
  editable: boolean;
  interactive?: boolean;
  maximumModelInstances?: number;
  node: CanvasNode;
  onModelInstanceSelect?: (canvasNodeId: string, instanceId: string | null) => void;
  onSceneChange?: (canvasNodeId: string, snapshot: ModelSceneSnapshot | null) => void;
  onSceneNodeSelect: (canvasNodeId: string, sceneNodePath: string | null) => void;
  projectId: string;
  runtimeAppearanceOverrides?: Record<string, ModelNodeAppearance>;
  selectedModelInstanceId?: string | null;
  selectedSceneNodePath: string | null;
};

type LoadState =
  | { status: "empty" }
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

type ModelRuntime = {
  applyAppearances: (overrides: Record<string, ModelNodeAppearance>) => void;
  applySelection: (sceneNodePath: string | null) => void;
  applyPresentation: (settings: Model3DProps) => void;
  applySceneSettings: (settings: Model3DProps) => void;
  applyTransforms: (overrides: Record<string, ModelNodeTransform>) => void;
  pickScenePath: (clientX: number, clientY: number) => string | null;
};

type MaterialObject = Object3D & {
  material?: Material | Material[];
};

type ColorMaterial = Material & {
  color?: { set: (value: string) => unknown };
};

const errorText = (reason: unknown): string =>
  reason instanceof Error ? reason.message : String(reason);

const disposeSceneResources = (root: Object3D) => {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  root.traverse((object) => {
    const owner = object as MaterialObject & { geometry?: BufferGeometry };
    if (owner.geometry) geometries.add(owner.geometry);
    if (owner.material) (Array.isArray(owner.material) ? owner.material : [owner.material]).forEach((material) => materials.add(material));
  });
  materials.forEach((material) => {
    Object.values(material).forEach((value: unknown) => {
      if (value && typeof value === "object" && "isTexture" in value && value.isTexture) textures.add(value as Texture);
    });
    material.dispose();
  });
  textures.forEach((texture) => {
    if (typeof ImageBitmap !== "undefined" && texture.image instanceof ImageBitmap) texture.image.close();
    texture.dispose();
  });
  geometries.forEach((geometry) => geometry.dispose());
};

const SingleModel3DNode = memo(function SingleModel3DNode({
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
  const runtimeRef = useRef<ModelRuntime | null>(null);
  const modelPropsRef = useRef<Model3DProps | null>(null);
  const runtimeAppearanceOverridesRef = useRef(runtimeAppearanceOverrides);
  runtimeAppearanceOverridesRef.current = runtimeAppearanceOverrides;
  const pointerStartRef = useRef<{
    clientX: number;
    clientY: number;
    pointerId: number;
  } | null>(null);
  const selectedSceneNodePathRef = useRef(selectedSceneNodePath);
  selectedSceneNodePathRef.current = selectedSceneNodePath;
  const settingsRef = useRef({
    autoRotate: true,
    rotationSpeed: 0.35,
    playAnimations: true,
    animationSpeed: 1,
  });
  const [loadState, setLoadState] = useState<LoadState>(
    node.resourceRefs[0] ? { status: "loading" } : { status: "empty" },
  );
  const saved = parseModel3DProps(node.props);
  const runtimePanelEnabled = !editable && runtimeControlsEnabled && saved.ok && saved.value.showControlPanel;
  // Scope temporary view changes to this component, asset and saved configuration.
  const viewKey = JSON.stringify([projectId, node.id, node.resourceRefs[0], saved.ok ? saved.value : null, runtimePanelEnabled]);
  const [viewOverride, setViewOverride] = useState<{ key: string; patch: Partial<Model3DProps> } | null>(null);
  const [loadedScene, setLoadedScene] = useState<{ scene: ModelSceneSnapshot; animationCount: number } | null>(null);
  const parsed = saved.ok && runtimePanelEnabled && viewOverride?.key === viewKey
    ? { ok: true as const, value: { ...saved.value, ...viewOverride.patch } }
    : saved;
  modelPropsRef.current = parsed.ok ? parsed.value : null;
  const assetId = node.resourceRefs[0] ?? null;
  const transformOverridesSignature = parsed.ok
    ? JSON.stringify(parsed.value.transformOverrides)
    : "";
  const appearanceOverridesSignature = parsed.ok
    ? JSON.stringify([parsed.value.appearanceOverrides, runtimeAppearanceOverrides])
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
        parsed.value.modelScale,
        parsed.value.showGrid,
        parsed.value.presentation.lighting,
      ])
    : "";

  useEffect(() => {
    if (!parsed.ok) return;
    settingsRef.current = {
      autoRotate: parsed.value.autoRotate,
      rotationSpeed: parsed.value.rotationSpeed,
      playAnimations: parsed.value.playAnimations,
      animationSpeed: parsed.value.animationSpeed,
    };
  }, [
    parsed.ok ? parsed.value.animationSpeed : null,
    parsed.ok ? parsed.value.autoRotate : null,
    parsed.ok ? parsed.value.playAnimations : null,
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

  const presentationSignature = parsed.ok ? JSON.stringify(parsed.value.presentation) : "";
  useEffect(() => {
    if (!parsed.ok || !runtimeRef.current) return;
    try {
      runtimeRef.current.applyPresentation(parsed.value);
    } catch (reason) {
      console.error("Failed to apply model presentation.", { assetId, canvasNodeId: node.id, reason });
      setLoadState({ status: "error", message: `模型检查设置应用失败：${errorText(reason)}` });
    }
  }, [assetId, node.id, parsed.ok, presentationSignature]);

  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.enabled = cameraControlsEnabled ?? !editable;
    }
  }, [cameraControlsEnabled, editable]);

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
    if (!parsed.ok || !runtimeRef.current) return;
    try {
      runtimeRef.current.applyAppearances({
        ...parsed.value.appearanceOverrides,
        ...runtimeAppearanceOverridesRef.current,
      });
      setLoadState({ status: "ready" });
    } catch (reason) {
      console.error("Failed to apply model node appearances.", {
        assetId,
        canvasNodeId: node.id,
        reason,
      });
      setLoadState({
        status: "error",
        message: `节点外观应用失败：${errorText(reason)}`,
      });
    }
  }, [appearanceOverridesSignature, assetId, node.id, parsed.ok]);

  useEffect(() => {
    if (!runtimeRef.current) return;
    try {
      runtimeRef.current.applySelection(selectedSceneNodePath);
      setLoadState({ status: "ready" });
    } catch (reason) {
      console.error("Failed to highlight the selected model node.", {
        assetId,
        canvasNodeId: node.id,
        reason,
        selectedSceneNodePath,
      });
      setLoadState({
        status: "error",
        message: `节点高亮失败：${errorText(reason)}`,
      });
    }
  }, [assetId, node.id, selectedSceneNodePath]);

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
    let restoreRuntimeAppearanceState: (() => void) | null = null;
    let clearRuntimeSelectionState: (() => void) | null = null;
    runtimeRef.current = null;
    onSceneChange?.(node.id, null);
    setLoadState({ status: "loading" });

    void Promise.all([
      import("three"),
      import("../scene/model-loader"),
      import("three/examples/jsm/controls/OrbitControls.js"),
      import("three/examples/jsm/environments/RoomEnvironment.js"),
      import("three/examples/jsm/postprocessing/EffectComposer.js"),
      import("three/examples/jsm/postprocessing/RenderPass.js"),
      import("three/examples/jsm/postprocessing/UnrealBloomPass.js"),
      import("three/examples/jsm/postprocessing/OutputPass.js"),
    ]).then(([THREE, { createModelLoader }, { OrbitControls }, { RoomEnvironment }, { EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }]) => {
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
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
      const rimLight = new THREE.DirectionalLight(0x8cc9ff, 1.3);
      rimLight.position.set(1, 5, -5);
      const warmLight = new THREE.DirectionalLight(0xffbd85, 0.7);
      warmLight.position.set(-6, 3, 0);
      scene.add(rimLight, warmLight);
      // Generated locally: no HDR/CDN request and no shared material mutation.
      let environmentTarget: ReturnType<InstanceType<typeof THREE.PMREMGenerator>["fromScene"]> | null = null;
      let composer: InstanceType<typeof EffectComposer> | null = null;
      let bloom: InstanceType<typeof UnrealBloomPass> | null = null;
      let outputPass: InstanceType<typeof OutputPass> | null = null;
      let renderPass: InstanceType<typeof RenderPass> | null = null;
      const ensureStudio = () => {
        if (environmentTarget) return;
        const room = new RoomEnvironment();
        const pmrem = new THREE.PMREMGenerator(renderer);
        environmentTarget = pmrem.fromScene(room, 0.04);
        room.dispose();
        pmrem.dispose();
        const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: Math.min(4, renderer.capabilities.maxSamples) });
        composer = new EffectComposer(renderer, target);
        renderPass = new RenderPass(scene, camera);
        bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.18, 0.35, 1.65);
        outputPass = new OutputPass();
        composer.addPass(renderPass);
        composer.addPass(bloom);
        composer.addPass(outputPass);
        composer.setSize(Math.max(container.clientWidth, 1), Math.max(container.clientHeight, 1));
      };

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enabled = cameraControlsEnabled ?? !editable;
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controlsRef.current = controls;

      const grid = new THREE.GridHelper(10, 20, 0x2a7590, 0x163d50);
      grid.visible = parsed.value.showGrid;
      scene.add(grid);

      let modelRoot: Object3D | null = null;
      let modelRadius: number | null = null;
      let animationMixer: InstanceType<typeof THREE.AnimationMixer> | null = null;
      let animationRoot: Object3D | null = null;
      let selectionHelper: InstanceType<typeof THREE.BoxHelper> | null = null;
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
            : settings.cameraView === "isometric-left"
              ? new THREE.Vector3(-1.35, 0.78, 1.78)
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
        const studio = settings.presentation.lighting === "studio";
        if (studio) ensureStudio();
        scene.environment = studio ? environmentTarget!.texture : null;
        scene.environmentIntensity = 0.8;
        renderer.toneMappingExposure = studio ? 0.9 : 1.15;
        rimLight.visible = studio;
        warmLight.visible = studio;
        // RenderPass clears before drawing. An opaque scene background forces a clear in
        // the active render target's color space, avoiding a bright clear color from the previous pass.
        scene.background = settings.backgroundOpacity === 1 ? new THREE.Color(settings.backgroundColor) : null;
        renderer.setClearColor(settings.backgroundColor, settings.backgroundOpacity);
        environmentLight.color.set(settings.environmentLightColor);
        environmentLight.intensity = settings.environmentLightIntensity;
        keyLight.color.set(settings.keyLightColor);
        keyLight.intensity = settings.keyLightIntensity;
        grid.visible = settings.showGrid;
        camera.fov = settings.cameraFov;
        camera.zoom = settings.modelScale;
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
        composer?.setSize(width, height);
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
        if (settingsRef.current.playAnimations) {
          animationMixer?.update(deltaSeconds * settingsRef.current.animationSpeed);
        }
        if (modelRoot && settingsRef.current.autoRotate) {
          modelRoot.rotation.y += deltaSeconds * settingsRef.current.rotationSpeed;
        }
        selectionHelper?.update();
        controls.update();
        // Bloom writes opaque pixels; preserve 2D compositing for transparent canvases.
        const currentSettings = modelPropsRef.current;
        if (composer && currentSettings?.presentation.lighting === "studio" && currentSettings.backgroundOpacity === 1) composer.render();
        else renderer.render(scene, camera);
      });

      const decoders = createModelLoader(renderer);
      const loader = decoders.loader;
      let modelLoadSettled = false;
      loader.load(
        modelAssetContentUrl(projectId, assetId),
        (gltf) => {
          modelLoadSettled = true;
          if (cancelled) {
            decoders.dispose();
            disposeSceneResources(gltf.scene);
            return;
          }

          let sceneTree: ReturnType<typeof buildModelSceneTree>;
          try {
            sceneTree = buildModelSceneTree(gltf.scene);
          } catch (reason) {
            console.error("Invalid model scene metadata.", { assetId, canvasNodeId: node.id, reason });
            setLoadState({ status: "error", message: `模型元数据无效：${errorText(reason)}` });
            disposeSceneResources(gltf.scene);
            return;
          }
          const originals = new Map<Object3D, {
            position: InstanceType<typeof THREE.Vector3>;
            quaternion: InstanceType<typeof THREE.Quaternion>;
            scale: InstanceType<typeof THREE.Vector3>;
          }>();
          const originalVisibility = new Map<Object3D, boolean>();
          const originalMaterials = new Map<MaterialObject, Material | Material[]>();
          const activeMaterialClones = new Map<MaterialObject, {
            clones: Material[];
            original: Material | Material[];
          }>();
          const objectsByName = new Map<string, Object3D[]>();
          const objectsByPath = new Map<string, Object3D>();
          const pathsByObject = new Map<Object3D, string>();
          const pathStack = gltf.scene.children
            .map((object, index) => ({ object, path: String(index) }))
            .reverse();
          while (pathStack.length > 0) {
            const entry = pathStack.pop()!;
            objectsByPath.set(entry.path, entry.object);
            pathsByObject.set(entry.object, entry.path);
            for (let index = entry.object.children.length - 1; index >= 0; index -= 1) {
              pathStack.push({
                object: entry.object.children[index]!,
                path: `${entry.path}/${index}`,
              });
            }
          }
          gltf.scene.traverse((object) => {
            originals.set(object, {
              position: object.position.clone(),
              quaternion: object.quaternion.clone(),
              scale: object.scale.clone(),
            });
            originalVisibility.set(object, object.visible);
            const materialOwner = object as MaterialObject;
            if (materialOwner.material) {
              originalMaterials.set(materialOwner, materialOwner.material);
            }
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

          const restoreAppearanceState = () => {
            activeMaterialClones.forEach(({ clones, original }, object) => {
              const originalMaterial = original;
              object.material = originalMaterial;
              clones.forEach((material) => material.dispose());
            });
            activeMaterialClones.clear();
            originalVisibility.forEach((visibleValue, object) => {
              object.visible = visibleValue;
            });
          };
          restoreRuntimeAppearanceState = restoreAppearanceState;

          const clearSelectionState = () => {
            if (!selectionHelper) return;
            scene.remove(selectionHelper);
            selectionHelper.geometry.dispose();
            selectionHelper.material.dispose();
            selectionHelper = null;
          };
          clearRuntimeSelectionState = clearSelectionState;

          const applySelection = (sceneNodePath: string | null) => {
            clearSelectionState();
            if (sceneNodePath === null) return;
            const selectedObject = objectsByPath.get(sceneNodePath);
            if (!selectedObject) {
              throw new Error(`模型中找不到当前选择路径：${sceneNodePath}`);
            }
            const selectedBounds = new THREE.Box3().setFromObject(selectedObject);
            if (selectedBounds.isEmpty()) {
              // Groups, cameras and bones are valid scene-tree selections even
              // when they do not own renderable geometry.
              return;
            }
            const helper = new THREE.BoxHelper(selectedObject, 0x5ad8ff);
            helper.material.depthTest = false;
            helper.material.transparent = true;
            helper.material.opacity = 0.95;
            helper.material.toneMapped = false;
            helper.renderOrder = 100000;
            selectionHelper = helper;
            scene.add(helper);
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
            const bounds = renderer.domElement.getBoundingClientRect();
            if (bounds.width <= 0 || bounds.height <= 0) {
              throw new Error("3D 视窗尺寸无效，无法执行对象命中测试");
            }
            pointer.set(
              ((clientX - bounds.left) / bounds.width) * 2 - 1,
              -((clientY - bounds.top) / bounds.height) * 2 + 1,
            );
            raycaster.setFromCamera(pointer, camera);
            const hit = raycaster
              .intersectObject(gltf.scene, true)
              .find((intersection) =>
                pathsByObject.has(intersection.object)
                && isEffectivelyVisible(intersection.object)
                && intersection.object.userData.category !== "flow"
                && !(intersection.object.userData.inspectionShell === true
                  && modelPropsRef.current?.presentation.shellMode === "original"));
            return hit ? pathsByObject.get(hit.object) ?? null : null;
          };

          const cloneObjectMaterials = (object: MaterialObject) => {
            const original = originalMaterials.get(object);
            if (!original) return [];
            const active = activeMaterialClones.get(object);
            if (active) return active.clones;
            const clones = (Array.isArray(original) ? original : [original]).map((material) => material.clone());
            object.material = Array.isArray(original) ? clones : clones[0]!;
            activeMaterialClones.set(object, { original, clones });
            return clones;
          };

          const applyAppearances = (
            overrides: Record<string, ModelNodeAppearance>,
          ) => {
            const targets = Object.entries(overrides).map(([nodeName, appearance]) => {
              const matches = objectsByName.get(nodeName);
              if (!matches || matches.length === 0) {
                throw new Error(`模型中找不到已配置节点：${nodeName}`);
              }
              if (matches.length > 1) {
                throw new Error(`模型节点名不唯一，不能应用外观：${nodeName}`);
              }
              return { appearance, nodeName, object: matches[0] };
            });

            restoreAppearanceState();
            const presentation = modelPropsRef.current!.presentation;
            try {
              gltf.scene.traverse((object) => {
                if (object.userData.inspectionShell !== true) return;
                if (presentation.shellMode === "hidden") object.visible = false;
                for (const material of cloneObjectMaterials(object as MaterialObject)) {
                  material.depthWrite = false;
                  if (presentation.shellMode === "solid") {
                    material.opacity = 1;
                    material.transparent = false;
                    material.depthWrite = true;
                    (material as ColorMaterial).color?.set("#42637b");
                    const physical = material as Material & { metalness?: number; roughness?: number };
                    if (physical.metalness !== undefined) physical.metalness = 0.8;
                    if (physical.roughness !== undefined) physical.roughness = 0.32;
                  }
                  material.needsUpdate = true;
                }
              });
              for (const { appearance, object } of targets) {
                object.visible = appearance.visible;
                object.traverse((descendant) => {
                  const materialOwner = descendant as MaterialObject;
                  const originalMaterial = originalMaterials.get(materialOwner);
                  if (!originalMaterial) return;

                  const clones = cloneObjectMaterials(materialOwner);
                  clones.forEach((clone) => {
                    const colorMaterial = clone as ColorMaterial;
                    colorMaterial.color?.set(appearance.color);
                    clone.opacity = appearance.opacity;
                    clone.transparent = appearance.opacity < 1;
                    clone.depthWrite = appearance.opacity === 1;
                    clone.needsUpdate = true;
                  });
                });
              }
              gltf.scene.traverse((object) => {
                if ((object.userData.category === "flow" || object.userData.category === "animation")
                  && (!presentation.showFlow || presentation.explosion > 0)) object.visible = false;
              });
            } catch (reason) {
              restoreAppearanceState();
              throw reason;
            }
          };

          let appliedExplosion = 0;
          const applyExplosionOffset = (explosion: number) => {
            gltf.scene.traverse((object) => {
              const offset = object.userData.explodeOffset as [number, number, number] | undefined;
              if (offset) {
                object.position.x += offset[0] * explosion;
                object.position.y += offset[1] * explosion;
                object.position.z += offset[2] * explosion;
              }
            });
          };
          const updateModelBounds = () => {
            contentOffset.position.set(0, 0, 0);
            // Refresh the changed parent offset before measuring world-space bounds.
            gltf.scene.updateWorldMatrix(true, true);
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

            // The centering offset is local to the turntable, including while auto-rotating.
            contentOffset.position.copy(rotationPivot.worldToLocal(center)).multiplyScalar(-1);
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

            appliedExplosion = modelPropsRef.current!.presentation.explosion;
            applyExplosionOffset(appliedExplosion);
            updateModelBounds();
          };

          const applyPresentation = (settings: Model3DProps) => {
            if (settings.presentation.explosion !== appliedExplosion) {
              // Move only assembly parents: a paused rotor or particle keeps its current pose.
              applyExplosionOffset(settings.presentation.explosion - appliedExplosion);
              appliedExplosion = settings.presentation.explosion;
              updateModelBounds();
            }
            applyAppearances({ ...settings.appearanceOverrides, ...runtimeAppearanceOverridesRef.current });
          };

          try {
            const latestSettings = modelPropsRef.current;
            if (!latestSettings) {
              throw new Error("模型加载完成时 3D 场景配置不可用");
            }
            applySceneSettings(latestSettings);
            applyTransforms(latestSettings.transformOverrides);
            applyAppearances({
              ...latestSettings.appearanceOverrides,
              ...runtimeAppearanceOverridesRef.current,
            });
            applySelection(selectedSceneNodePathRef.current);
            if (gltf.animations.length > 0) {
              animationMixer = new THREE.AnimationMixer(gltf.scene);
              animationRoot = gltf.scene;
              gltf.animations.forEach((clip) => animationMixer?.clipAction(clip).play());
              console.info("Loaded embedded 3D model animations.", {
                animationClipCount: gltf.animations.length,
                animationClipNames: gltf.animations.map((clip) => clip.name || "(unnamed)"),
                assetId,
                canvasNodeId: node.id,
              });
            }
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

          runtimeController = {
            applyAppearances,
            applyPresentation,
            applySelection,
            applySceneSettings,
            applyTransforms,
            pickScenePath,
          };
          runtimeRef.current = runtimeController;
          setLoadedScene({ scene: { assetId, ...sceneTree }, animationCount: gltf.animations.length });
          onSceneChange?.(node.id, { assetId, ...sceneTree });
          setLoadState({ status: "ready" });
        },
        undefined,
        (reason) => {
          modelLoadSettled = true;
          if (cancelled) decoders.dispose();
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
        if (animationMixer && animationRoot) {
          animationMixer.stopAllAction();
          animationMixer.uncacheRoot(animationRoot);
        }
        animationMixer = null;
        animationRoot = null;
        clearRuntimeSelectionState?.();
        clearRuntimeSelectionState = null;
        restoreRuntimeAppearanceState?.();
        restoreRuntimeAppearanceState = null;
        disposeSceneResources(scene);
        bloom?.dispose();
        outputPass?.dispose();
        renderPass?.dispose();
        composer?.dispose();
        environmentTarget?.dispose();
        if (modelLoadSettled) decoders.dispose();
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
  }, [assetId, cameraControlsEnabled, node.id, onSceneChange, parsed.ok, projectId]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((!editable && !interactive) || event.button !== 0) return;
    pointerStartRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
    };
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if ((!editable && !interactive) || !start || start.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) > 4) {
      return;
    }
    try {
      const sceneNodePath = runtimeRef.current?.pickScenePath(
        event.clientX,
        event.clientY,
      ) ?? null;
      onSceneNodeSelect(node.id, sceneNodePath);
    } catch (reason) {
      console.error("Failed to pick a model node.", {
        assetId,
        canvasNodeId: node.id,
        clientX: event.clientX,
        clientY: event.clientY,
        reason,
      });
      setLoadState({
        status: "error",
        message: `节点选择失败：${errorText(reason)}`,
      });
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
      {runtimePanelEnabled && loadState.status === "ready" && loadedScene?.scene.assetId === assetId ? (
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
      {loadState.status === "loading" ? <div className="model-3d-message"><span className="model-loading-spinner" /><strong>正在加载 3D 模型</strong></div> : null}
      {loadState.status === "error" ? <div className="model-3d-message is-error" role="alert"><strong>3D 模型不可用</strong><span>{loadState.message}</span></div> : null}
    </div>
  );
});

export const Model3DNode = memo(function Model3DNode(props: Model3DNodeProps) {
  const parsed = parseModel3DProps(props.node.props, props.maximumModelInstances);
  if (parsed.ok && (parsed.value.modelInstances.length > 0 || props.maximumModelInstances !== undefined)) {
    return <BatchModel3DNode {...props} />;
  }
  return <SingleModel3DNode {...props} />;
});
