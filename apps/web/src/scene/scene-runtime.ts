import * as THREE from "three";
import { sceneCameraClipping } from "./camera-clipping";
import { applyOrbitViewLimits } from "./orbit-view-limits";
import { focusSceneObject } from "./focus-model";
import { EMPTY_SCENE_GRID_SIZE, fitEmptySceneCamera } from "./empty-scene-view";
import { registerCoverSurface } from "../covers/render-surfaces";
import type { Material, Object3D } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { buildModelSceneTree, type ModelSceneSnapshot } from "../canvas/model-scene";
import type { Model3DProps, ModelAssetInstance, ModelNodeAppearance, ModelNodeTransform } from "../canvas/types";
import { ResourceManager } from "./resource-manager";
import { InstanceManager, disposeClonedMaterials, type InstanceRecord, type MaterialObject } from "./instance-manager";
import { createSceneModelLoader, disposeModelResources } from "./model-loader";
import { createSceneObjectPickingService } from "./picking-service";
import { FluidManager } from "./fluid-manager";
import { SceneFrameClock } from "./frame-clock";
import { FluidPathGuide, fluidPointOnPlane, type FluidEditorState } from "./fluid-path-editor";
import type { FluidDefinition } from "../../../../shared/fluids";
import { createWalkPhysics, type WalkPhysics, type WalkSceneConfig } from "./walk-physics";
import { createWalkControls } from "./walk-controls";
import {
  constrainEditableInstanceScale,
  readEditableInstanceTransform,
  type InstanceTransformMode,
} from "./instance-transform";

type ColorMaterial = Material & { color?: { set: (value: string) => unknown }; metalness?: number; roughness?: number };
export type SceneStatus = { status: "empty" | "loading" | "ready" } | { status: "error"; message: string };
export type NavigationStatus = { mode: "orbit" | "loading" | "walk"; message?: string } | { mode: "error"; message: string };
export type SceneSnapshot = { scene: ModelSceneSnapshot; animationCount: number };
export type SceneSelectionStyle = "editor" | "runtime" | "none";
export type SceneInput = {
  fluids?: FluidDefinition[];
  selectedFluidId?: string | null;
  fluidEditor?: FluidEditorState | null;
  instances: ModelAssetInstance[];
  settings: Model3DProps;
  appearanceOverrides: Record<string, ModelNodeAppearance>;
  selectedPath: string | null;
  selectedInstanceId: string | null;
  selectionStyle: SceneSelectionStyle;
  controlsEnabled: boolean;
  instanceTransformMode: InstanceTransformMode | null;
  modelFocusRequest?: { instanceId: string; requestId: string } | null;
};
export type SceneDiagnostics = {
  fluids: ReturnType<FluidManager["diagnostics"]>;
  activeLoads: number; queuedLoads: number; resources: number; instanceCount: number;
  cameraPosition: number[]; cameraTarget: number[];
  navigation: NavigationStatus; physics: ReturnType<WalkPhysics["diagnostics"]> | null;
  frameMs: number; drawCalls: number; triangles: number; geometries: number; textures: number;
};
export type SceneRuntime = ReturnType<typeof createSceneRuntime>;

/** Owns one renderer per scene. React passes configuration, never Three.js objects. */
export function createSceneRuntime({ container, projectId, canvasNodeId, initial, onStatus, onSnapshot, onDiagnostics, onNavigation, onInstanceTransform, onTransformDragging }: {
  container: HTMLElement;
  projectId: string;
  canvasNodeId: string;
  initial: SceneInput;
  onStatus: (status: SceneStatus) => void;
  onSnapshot: (snapshot: SceneSnapshot | null) => void;
  onDiagnostics?: (diagnostics: SceneDiagnostics) => void;
  onNavigation?: (status: NavigationStatus) => void;
  onInstanceTransform?: (instanceId: string, transform: ModelNodeTransform) => void;
  onTransformDragging?: (dragging: boolean) => void;
}) {
  const constructionCleanup: Array<() => void> = [];
  try {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(initial.settings.cameraFov, 1, 0.01, 10000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    constructionCleanup.push(() => { renderer.setAnimationLoop(null); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.replaceChildren(renderer.domElement);

    const environmentLight = new THREE.HemisphereLight(initial.settings.environmentLightColor, 0x14202a, initial.settings.environmentLightIntensity);
    const keyLight = new THREE.DirectionalLight(initial.settings.keyLightColor, initial.settings.keyLightIntensity);
    keyLight.position.set(4, 8, 6);
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.bias = -0.00015;
    keyLight.shadow.normalBias = 0.02;
    constructionCleanup.push(() => keyLight.shadow.dispose());
    const rimLight = new THREE.DirectionalLight(0x8cc9ff, 1.3);
    rimLight.position.set(1, 5, -5);
    const warmLight = new THREE.DirectionalLight(0xffbd85, 0.7);
    warmLight.position.set(-6, 3, 0);
    scene.add(environmentLight, keyLight, keyLight.target, rimLight, warmLight);

    const grid = new THREE.GridHelper(EMPTY_SCENE_GRID_SIZE, 20, 0x2a7590, 0x163d50);
    constructionCleanup.push(() => { grid.geometry.dispose(); (Array.isArray(grid.material) ? grid.material : [grid.material]).forEach((m) => m.dispose()); });
    scene.add(grid);
    const rotationPivot = new THREE.Group();
    const contentOffset = new THREE.Group();
    rotationPivot.add(contentOffset);
    scene.add(rotationPivot);

    const controls = new OrbitControls(camera, renderer.domElement);
    constructionCleanup.push(() => controls.dispose());
    controls.enabled = initial.controlsEnabled;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    const transformControls = new TransformControls(camera, renderer.domElement);
    const transformHelper = transformControls.getHelper();
    transformControls.setSize(0.85);
    scene.add(transformHelper);
    constructionCleanup.push(() => {
      scene.remove(transformHelper);
      transformControls.dispose();
    });


    let environmentTarget: ReturnType<InstanceType<typeof THREE.PMREMGenerator>["fromScene"]> | null = null;
    const ensureStudio = () => {
      if (environmentTarget) return;
      const room = new RoomEnvironment();
      const pmrem = new THREE.PMREMGenerator(renderer);
      environmentTarget = pmrem.fromScene(room, 0.04);
      room.dispose();
      pmrem.dispose();
    };

    const modelLoader = createSceneModelLoader(projectId, renderer);
    constructionCleanup.push(modelLoader.dispose);
    const resources = new ResourceManager(modelLoader.load, (source) => disposeModelResources(source.scene));
    constructionCleanup.push(() => resources.dispose());
    const manager = new InstanceManager(resources, contentOffset);
    constructionCleanup.push(() => manager.dispose());
    const fluids = new FluidManager(contentOffset);
    constructionCleanup.push(() => fluids.dispose());
    const fluidGuide = new FluidPathGuide(contentOffset);
    constructionCleanup.push(() => fluidGuide.dispose());
    let records: InstanceRecord[] = [];
    let desired = initial;
    let desiredInstancesById = new Map(initial.instances.map((instance) => [instance.id, instance]));
    let revision = 0;
    let appliedGraph = "";
    let appliedInput: SceneInput | null = null;
    let appliedFocusRequestId: string | null = null;
    let contextLost = false;
    let status: SceneStatus = { status: "loading" };
    const notifyStatus = (next: SceneStatus) => { status = next; onStatus(next); };
    let cameraInitialized = false;
    let emptyCameraInitialized = false;
    let previousView = initial.settings.cameraView;
    const sceneCenter = new THREE.Vector3();
    const clippingCenter = new THREE.Vector3();
    let frameCount = 0;
    let frameTotal = 0;
    let sampleAt: number | null = null;
    let lastDiagnostics: SceneDiagnostics | null = null;
    let primaryPathsByObject = new Map<Object3D, string>();
    let primaryObjectsByPath = new Map<string, Object3D>();
    let selectionHelper: InstanceType<typeof THREE.BoxHelper> | null = null;
    let selectionRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> | null = null;
    let selectionTarget: Object3D | null = null;
    const selectionBounds = new THREE.Box3();
    const selectionSize = new THREE.Vector3();
    const selectionCenter = new THREE.Vector3();
    let transformRecord: InstanceRecord | null = null;
    let transformDragging = false;
    let modelRadius: number | null = null;
    let visible = true;
    const frameClock = new SceneFrameClock();
    let disposed = false;
    let unregisterCoverSurface: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let intersectionObserver: IntersectionObserver | null = null;

    let navigation: NavigationStatus = { mode: "orbit" };
    let walk: { physics: WalkPhysics; controls: ReturnType<typeof createWalkControls>; camera: THREE.PerspectiveCamera; target: THREE.Vector3; rotation: number } | null = null;
    let navigationRevision = 0;
    const notifyNavigation = (status: NavigationStatus) => { navigation = status; onNavigation?.(status); };
    const exitWalk = (message?: string) => {
      navigationRevision++;
      if (walk) {
        walk.controls.dispose();
        walk.physics.dispose();
        camera.copy(walk.camera);
        controls.target.copy(walk.target);
        rotationPivot.rotation.y = walk.rotation;
        walk = null;
      }
      controls.enabled = desired.controlsEnabled && !transformDragging;
      syncTransformControl(desired);
      notifyNavigation({ mode: "orbit", ...(message ? { message } : {}) });
    };
    const navigationError = (reason: unknown) => {
      exitWalk();
      console.error("Rapier scene navigation failed.", { projectId, canvasNodeId, reason });
      notifyNavigation({ mode: "error", message: `行走失败：${reason instanceof Error ? reason.message : String(reason)}` });
    };
    const enterWalk = async (input: WalkSceneConfig) => {
      if (disposed) throw new Error("场景运行层已释放");
      exitWalk();
      const version = navigationRevision;
      let physics: WalkPhysics | null = null;
      try {
        if (contextLost || !appliedInput || appliedInput !== desired || !records.length) throw new Error("场景未就绪，不能进入行走");
        if (!desired.controlsEnabled) throw new Error("当前视窗未开放相机交互");
        if (desired.settings.autoRotate || desired.settings.playAnimations || desired.settings.presentation.explosion !== 0 || desired.settings.presentation.shellMode === "hidden") {
          throw new Error("行走前请关闭整场旋转、模型动画和拆解，并显示外壳；当前碰撞体仅支持静态场景");
        }
        const config = structuredClone(input);
        notifyNavigation({ mode: "loading" });
        physics = await createWalkPhysics(config);
        if (disposed || version !== navigationRevision) { physics.dispose(); return false; }
        // Drain OrbitControls damping before giving exclusive camera ownership to walking.
        controls.enableDamping = false; controls.update(); controls.enableDamping = true;
        const saved = camera.clone();
        const target = controls.target.clone();
        const rotation = rotationPivot.rotation.y;
        detachTransformControl();
        controls.enabled = false;
        rotationPivot.rotation.y = 0;
        camera.up.set(0, 1, 0); camera.zoom = 1; camera.near = 0.05;
        camera.far = Math.max(camera.far, new THREE.Vector3(...config.bounds.max).distanceTo(new THREE.Vector3(...config.bounds.min)) * 2);
        camera.updateProjectionMatrix();
        walk = { physics, camera: saved, target, rotation, controls: createWalkControls(renderer.domElement, camera, physics, config.yaw, () => exitWalk()) };
        notifyNavigation({ mode: "walk" });
        return true;
      } catch (reason) {
        if (physics && walk?.physics !== physics) physics.dispose();
        if (disposed || version !== navigationRevision) return false;
        navigationError(reason);
        return false; // The error is surfaced through the separate navigation status channel.
      }
    };

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      contextLost = true;
      exitWalk("图形上下文丢失，已退出行走");
      renderer.setAnimationLoop(null);
      console.error("Batched 3D scene lost its WebGL context.", {
        canvasNodeId,
        instanceCount: records.length,
        uniqueAssetCount: new Set(records.map((instance) => instance.assetId)).size,
      });
      notifyStatus({ status: "error", message: "3D 图形上下文已丢失，请减少模型复杂度后重新打开场景。" });
    };

    const clearSelection = () => {
      if (selectionHelper) {
        scene.remove(selectionHelper);
        selectionHelper.geometry.dispose();
        selectionHelper.material.dispose();
        selectionHelper = null;
      }
      if (selectionRing) {
        scene.remove(selectionRing);
        selectionRing.geometry.dispose();
        selectionRing.material.dispose();
        selectionRing = null;
      }
      selectionTarget = null;
    };

    const detachTransformControl = () => {
      transformControls.detach();
      transformControls.enabled = false;
      transformRecord = null;
    };

    function syncTransformControl(input: SceneInput) {
      if (transformControls.dragging) return;
      const record = input.selectedPath === null && input.selectedInstanceId !== null
        ? records.find((candidate) => candidate.id === input.selectedInstanceId)
        : undefined;
      if (!input.instanceTransformMode || !record?.wrapper.visible || walk || input.fluidEditor?.active) {
        detachTransformControl();
        return;
      }
      transformControls.enabled = true;
      transformControls.setMode(input.instanceTransformMode);
      transformControls.setSpace(input.instanceTransformMode === "translate" ? "world" : "local");
      if (transformRecord !== record) {
        transformControls.attach(record.wrapper);
        transformRecord = record;
      }
    }

    const reportTransformError = (reason: unknown) => {
      console.error("Failed to edit a 3D model instance with transform controls.", {
        projectId,
        canvasNodeId,
        instanceId: transformRecord?.id ?? null,
        reason,
      });
      notifyStatus({ status: "error", message: `模型拖拽失败：${reason instanceof Error ? reason.message : String(reason)}` });
    };

    transformControls.addEventListener("objectChange", () => {
      if (!transformRecord) return;
      try {
        constrainEditableInstanceScale(transformRecord.wrapper);
      } catch (reason) {
        transformControls.reset();
        reportTransformError(reason);
      }
    });
    transformControls.addEventListener("mouseUp", () => {
      if (!transformRecord) return;
      try {
        constrainEditableInstanceScale(transformRecord.wrapper);
        const transform = readEditableInstanceTransform(transformRecord.wrapper);
        updateSceneBounds();
        onInstanceTransform?.(transformRecord.id, transform);
      } catch (reason) {
        transformControls.reset();
        updateSceneBounds();
        reportTransformError(reason);
      }
    });
    transformControls.addEventListener("dragging-changed", (event) => {
      transformDragging = event.value === true;
      controls.enabled = desired.controlsEnabled && !walk && !transformDragging;
      onTransformDragging?.(transformDragging);
    });

    const disposeRuntime = () => {
      if (disposed) return;
      disposed = true;
      unregisterCoverSurface?.();
      unregisterCoverSurface = null;
      exitWalk();
      renderer.setAnimationLoop(null);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      renderer.domElement.removeEventListener("webglcontextlost", handleContextLost);
      controls.dispose();
      scene.remove(transformHelper);
      transformControls.dispose();
      clearSelection();
      document.removeEventListener("visibilitychange", updateLoop);
      fluidGuide.dispose();
      fluids.dispose();
      manager.dispose();
      resources.dispose();
      modelLoader.dispose();
      grid.geometry.dispose();
      if (Array.isArray(grid.material)) grid.material.forEach((material) => material.dispose());
      else grid.material.dispose();
      environmentTarget?.dispose();
      keyLight.shadow.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (container.contains(renderer.domElement)) container.replaceChildren();
    };
    constructionCleanup.splice(0, constructionCleanup.length, disposeRuntime);
    renderer.domElement.addEventListener("webglcontextlost", handleContextLost);

    const currentSceneCenter = (target: THREE.Vector3) => target.copy(sceneCenter)
      .sub(rotationPivot.position).applyQuaternion(rotationPivot.quaternion).add(rotationPivot.position);

    const fitCameraToScene = () => {
      if (modelRadius === null) {
        fitEmptySceneCamera(camera, controls.target, desired.settings.cameraView);
        controls.update();
        emptyCameraInitialized = true;
        return;
      }
      const settings = desired.settings;
      if (!settings) throw new Error("当前批量 3D 场景配置不可用");
      const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov / 2);
      const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * camera.aspect);
      const limitingHalfFov = Math.max(Math.min(verticalHalfFov, horizontalHalfFov), 0.01);
      const distance = (modelRadius / Math.sin(limitingHalfFov)) * 1.15;
      const direction = settings.cameraView === "front"
        ? new THREE.Vector3(0, 0.12, 1)
        : settings.cameraView === "top"
          ? new THREE.Vector3(0, 1, 0.001)
          : settings.cameraView === "isometric-left"
            ? new THREE.Vector3(-1.35, 0.78, 1.78)
            : new THREE.Vector3(1.35, 0.9, 1.65);
      camera.up.set(0, 1, 0);
      const center = currentSceneCenter(new THREE.Vector3());
      camera.position.copy(direction.normalize().multiplyScalar(distance).add(center));
      controls.target.copy(center);
      cameraInitialized = true;
      controls.update();
    };

    const updateSceneBounds = () => {
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
      const fluidBounds = fluids.getBounds();
      if (!fluidBounds.isEmpty()) { box.union(fluidBounds); hasVisibleGeometry = true; }
      if (!hasVisibleGeometry) {
        rotationPivot.rotation.y = priorRotation;
        if (modelRadius !== null) emptyCameraInitialized = false;
        if (records.length === 0) cameraInitialized = false;
        modelRadius = null;
        grid.position.set(0, 0, 0);
        grid.scale.setScalar(1);
        return;
      }
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      if (![center.x, center.y, center.z, size.x, size.y, size.z].every(Number.isFinite)) {
        rotationPivot.rotation.y = priorRotation;
        throw new Error("模型实例变换产生了无效的场景边界");
      }
      rotationPivot.rotation.y = priorRotation;
      if (!cameraInitialized) {
        // Move the rotation origin without moving any scene-local point. The
        // presentation may already be rotated when the first path is drawn.
        const localCenter = center.clone().sub(rotationPivot.position).sub(contentOffset.position);
        center.sub(rotationPivot.position).applyQuaternion(rotationPivot.quaternion).add(rotationPivot.position);
        rotationPivot.position.copy(center);
        contentOffset.position.copy(localCenter).negate();
      }
      sceneCenter.copy(center);
      scene.updateMatrixWorld(true);
      modelRadius = Math.max(size.length() / 2, 0.01);
      // A single bounded shadow map covers the scene, including rotation about its center.
      const shadowRadius = Math.max(modelRadius * 1.1, 0.1);
      keyLight.position.copy(new THREE.Vector3(4, 8, 6).normalize().multiplyScalar(shadowRadius * 2).add(center));
      keyLight.target.position.copy(center);
      Object.assign(keyLight.shadow.camera, {
        left: -shadowRadius, right: shadowRadius, top: shadowRadius, bottom: -shadowRadius,
        near: 0.01, far: shadowRadius * 4,
      });
      keyLight.shadow.camera.updateProjectionMatrix();
      grid.scale.setScalar(Math.max(modelRadius / 2.5, 0.2));
      grid.position.set(center.x, box.min.y, center.z);

    };

    const applySceneSettings = (settings: Model3DProps) => {
      const studio = settings.presentation.lighting === "studio";
      if (studio) ensureStudio();
      renderer.shadowMap.enabled = studio;
      keyLight.castShadow = studio;
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
      applyOrbitViewLimits(controls, settings.preventBottomView);
      if (navigation.mode === "orbit") controls.update();
      camera.fov = settings.cameraFov;
      camera.zoom = settings.modelScale;
      camera.updateProjectionMatrix();
      if (previousView !== settings.cameraView) fitCameraToScene();
      previousView = settings.cameraView;
    };

    const applyInstances = (nextInstances: ModelAssetInstance[]) => {
      const byId = new Map(nextInstances.map((instance) => [instance.id, instance]));
      if (byId.size !== records.length || records.some((record) => byId.get(record.id)?.assetId !== record.assetId)) {
        throw new Error("运行实例与配置资源结构不一致");
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

    const applyInstanceAppearance = (
      record: InstanceRecord,
      appearance: ModelAssetInstance["appearance"],
    ) => {
      if (!appearance || (appearance.color === null && appearance.opacity === 1)) return;
      record.model.traverse((object) => {
        cloneMaterials(record, object as MaterialObject).forEach((material) => {
          const colorMaterial = material as ColorMaterial;
          if (appearance.color !== null) colorMaterial.color?.set(appearance.color);
          material.opacity *= appearance.opacity;
          if (appearance.opacity < 1) {
            material.transparent = true;
            material.depthWrite = false;
          }
          material.needsUpdate = true;
        });
      });
    };

    const applyModelState = (settings: Model3DProps) => {
      records.forEach(restoreRecord);
      const primary = records[0];
      if (!primary) return;
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
      records.forEach((record) => {
        const instance = desiredInstancesById.get(record.id);
        if (!instance) throw new Error(`场景中缺少模型实例配置：${record.id}`);
        applyInstanceAppearance(record, instance.appearance);
      });
      applyAppearance(primary, {
        ...settings.appearanceOverrides,
        ...desired.appearanceOverrides,
      });
      updateSceneBounds();
    };

    const updateRuntimeSelectionRing = (now: number) => {
      if (!selectionRing || !selectionTarget) return;
      selectionBounds.setFromObject(selectionTarget);
      if (selectionBounds.isEmpty()) {
        selectionRing.visible = false;
        return;
      }
      selectionRing.visible = true;
      selectionBounds.getSize(selectionSize);
      selectionBounds.getCenter(selectionCenter);
      const radius = Math.max(selectionSize.x, selectionSize.z, 0.12) * 0.68;
      const pulse = 1 + Math.sin(now * 0.005) * 0.07;
      selectionRing.position.set(selectionCenter.x, selectionBounds.min.y + Math.max(selectionSize.y * 0.01, 0.008), selectionCenter.z);
      selectionRing.scale.setScalar(radius * pulse);
      selectionRing.material.opacity = 0.68 + Math.sin(now * 0.005) * 0.16;
    };

    const applySelection = (path: string | null, instanceId: string | null, style: SceneSelectionStyle) => {
      clearSelection();
      let selected: Object3D | undefined;
      if (path !== null) {
        selected = primaryObjectsByPath.get(path);
        if (!selected) throw new Error(`主模型中找不到当前选择路径：${path}`);
      } else if (instanceId !== null) {
        selected = records.find((record) => record.id === instanceId)?.wrapper;
        if (!selected) throw new Error(`场景中找不到当前模型实例：${instanceId}`);
      }
      if (!selected || style === "none") return;
      if (new THREE.Box3().setFromObject(selected).isEmpty()) return;
      if (style === "editor") {
        selectionHelper = new THREE.BoxHelper(selected, 0x5ad8ff);
        selectionHelper.material.depthTest = false;
        selectionHelper.material.transparent = true;
        selectionHelper.material.opacity = 0.95;
        selectionHelper.material.toneMapped = false;
        selectionHelper.renderOrder = 100000;
        scene.add(selectionHelper);
        return;
      }
      selectionTarget = selected;
      selectionRing = new THREE.Mesh(
        new THREE.RingGeometry(0.76, 1, 64),
        new THREE.MeshBasicMaterial({
          color: 0x35d8ff,
          depthTest: false,
          depthWrite: false,
          opacity: 0.82,
          side: THREE.DoubleSide,
          toneMapped: false,
          transparent: true,
        }),
      );
      selectionRing.rotation.x = -Math.PI / 2;
      selectionRing.renderOrder = 100000;
      scene.add(selectionRing);
      updateRuntimeSelectionRing(performance.now());
    };

    const pick = createSceneObjectPickingService(camera, renderer.domElement);
    const pickSceneObject = (x: number, y: number) => pick(x, y, records, primaryPathsByObject, fluids);
    const pickSceneTarget = (x: number, y: number) => {
      const target = pickSceneObject(x, y);
      return target && "instanceId" in target ? target : null;
    };
    const pickFluidPoint = (x: number, y: number) => {
      if (!desired.fluidEditor?.active) throw new Error("请先开始编辑流体路径");
      const viewport = renderer.domElement.getBoundingClientRect();
      if (viewport.width <= 0 || viewport.height <= 0) throw new Error("3D 视窗尺寸无效，无法选点");
      camera.updateMatrixWorld();
      contentOffset.updateWorldMatrix(true, false);
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2((x - viewport.left) / viewport.width * 2 - 1, -(y - viewport.top) / viewport.height * 2 + 1), camera);
      return fluidPointOnPlane(raycaster.ray, contentOffset.matrixWorld, desired.fluidEditor);
    };

    const resize = () => {
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      if (walk) { walk.camera.aspect = camera.aspect; walk.camera.updateProjectionMatrix(); }
      camera.updateProjectionMatrix();
    };
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();
    const renderSceneFrame = () => {
      if (!walk) {
        camera.updateMatrixWorld();
        if (modelRadius === null) clippingCenter.copy(grid.position);
        else currentSceneCenter(clippingCenter);
        const centerDepth = -clippingCenter.applyMatrix4(camera.matrixWorldInverse).z;
        const clipping = sceneCameraClipping(centerDepth, modelRadius ?? EMPTY_SCENE_GRID_SIZE / Math.sqrt(2));
        if (camera.near !== clipping.near || camera.far !== clipping.far) {
          camera.near = clipping.near;
          camera.far = clipping.far;
          camera.updateProjectionMatrix();
        }
      }
      renderer.render(scene, camera);
    };
    unregisterCoverSurface = registerCoverSurface(renderer.domElement, () => {
      if (disposed || contextLost || renderer.getContext().isContextLost()) {
        throw new Error(`3D 场景已释放或 WebGL 上下文丢失，不能生成封面（项目 ${projectId}，节点 ${canvasNodeId}）`);
      }
      if ((status.status !== "ready" && status.status !== "empty") || appliedInput !== desired) {
        throw new Error(`3D 场景尚未就绪，不能生成封面（项目 ${projectId}，节点 ${canvasNodeId}，状态 ${status.status}）`);
      }
      // Do not advance animation, re-fit the camera or rely on a retained drawing buffer.
      renderSceneFrame();
      if (renderer.getContext().isContextLost()) throw new Error("3D 场景截图时 WebGL 上下文丢失");
      return renderer.domElement.toDataURL("image/png");
    });
    const animate = (now: number) => {
      const { frameMs, deltaSeconds } = frameClock.tick(now);
      if (sampleAt === null) sampleAt = now;
      const settings = desired.settings;
      if (settings.playAnimations) records.forEach((record) => {
        const animation = desiredInstancesById.get(record.id)?.animation;
        if (record.wrapper.visible && animation?.enabled !== false) {
          record.mixer?.update(deltaSeconds * settings.animationSpeed * (animation?.speed ?? 1));
        }
      });
      fluids.update(deltaSeconds, settings.playAnimations, settings.animationSpeed);
      if (settings.autoRotate && !desired.fluidEditor?.active) rotationPivot.rotation.y += deltaSeconds * settings.rotationSpeed;
      selectionHelper?.update();
      updateRuntimeSelectionRing(now);
      if (walk) {
        try { walk.controls.update(frameMs / 1000); }
        catch (reason) { navigationError(reason); }
      } else controls.update();
      renderSceneFrame();
      frameCount++;
      frameTotal += frameMs;
      if (now - sampleAt >= 2000) {
        lastDiagnostics = {
          ...resources.stats, instanceCount: records.length, fluids: fluids.diagnostics(),
          cameraPosition: camera.position.toArray(), cameraTarget: walk ? camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3())).toArray() : controls.target.toArray(),
          navigation, physics: walk?.physics.diagnostics() ?? null,
          frameMs: frameTotal / frameCount,
          drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
          geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
        };
        onDiagnostics?.(lastDiagnostics);
        frameCount = 0; frameTotal = 0; sampleAt = now;
      }
    };
    function updateLoop() {
      if (disposed || contextLost) return;
      const running = visible && !document.hidden;
      walk?.controls.pause();
      frameClock.reset();
      frameCount = 0; frameTotal = 0; sampleAt = null;
      renderer.setAnimationLoop(running ? animate : null);
    }
    intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      updateLoop();
    });
    intersectionObserver.observe(container);
    document.addEventListener("visibilitychange", updateLoop);
    updateLoop();

    const update = async (next: SceneInput) => {
      if (disposed) throw new Error("场景运行层已释放");
      const navigationKey = (value: SceneInput) => JSON.stringify([value.instances, value.settings, value.appearanceOverrides, value.controlsEnabled]);
      if ((walk || navigation.mode === "loading") && navigationKey(next) !== navigationKey(desired)) exitWalk("场景配置已变化，请核对碰撞体后重新进入行走");
      desired = next;
      desiredInstancesById = new Map(next.instances.map((instance) => [instance.id, instance]));
      controls.enabled = next.controlsEnabled && !walk && !transformDragging;
      const version = ++revision;
      const graph = JSON.stringify(next.instances.map(({ id, assetId }) => [id, assetId]));
      try {
        if (contextLost) throw new Error("WebGL 上下文已丢失，请重新打开场景");
        const graphChanged = graph !== appliedGraph;
        if (graphChanged) {
          detachTransformControl();
          notifyStatus({ status: "loading" });
          if (!await manager.reconcile(next.instances) || disposed || version !== revision) return;
          if (contextLost || renderer.getContext().isContextLost()) throw new Error("模型加载期间 WebGL 上下文已丢失，请重新打开场景");
          records = manager.records;
          records.forEach(record => record.model.traverse(object => {
            if (object instanceof THREE.Mesh) {
              object.castShadow = true;
              object.receiveShadow = true;
            }
          }));
          appliedGraph = graph;
          primaryPathsByObject = new Map();
          primaryObjectsByPath = new Map();
          const primary = records[0];
          if (primary) {
            const stack = primary.model.children.map((object, index) => ({ object, path: String(index) })).reverse();
            while (stack.length) {
              const { object, path } = stack.pop()!;
              primaryObjectsByPath.set(path, object);
              primaryPathsByObject.set(object, path);
              for (let i = object.children.length - 1; i >= 0; i--) stack.push({ object: object.children[i]!, path: `${path}/${i}` });
            }
            onSnapshot({ scene: { assetId: primary.assetId, ...buildModelSceneTree(primary.model) }, animationCount: records.reduce((sum, record) => sum + record.animationCount, 0) });
          } else onSnapshot(null);
        } else manager.cancelPending();
        const instancesChanged = graphChanged || JSON.stringify(appliedInput?.instances) !== JSON.stringify(next.instances);
        const settingsChanged = JSON.stringify(appliedInput?.settings) !== JSON.stringify(next.settings);
        const modelKey = (value: SceneInput | null) => JSON.stringify(value && [
          value.settings.presentation,
          value.settings.transformOverrides,
          value.settings.appearanceOverrides,
          value.appearanceOverrides,
          value.instances.map((instance) => [instance.id, instance.appearance]),
        ]);
        const modelChanged = graphChanged || modelKey(appliedInput) !== modelKey(next);
        const fluidsChanged = JSON.stringify(appliedInput?.fluids) !== JSON.stringify(next.fluids);
        if (fluidsChanged) fluids.reconcile(next.fluids ?? []);
        if (instancesChanged) applyInstances(next.instances);
        else if (fluidsChanged) updateSceneBounds();
        if (fluidsChanged || JSON.stringify(appliedInput?.fluidEditor) !== JSON.stringify(next.fluidEditor) || appliedInput?.selectedFluidId !== next.selectedFluidId || appliedInput?.selectionStyle !== next.selectionStyle) {
          const selected = next.fluids?.find(fluid => fluid.id === next.selectedFluidId && fluid.visible);
          const selectedPoints = selected?.direction === "reverse" ? [...selected.points].reverse() : selected?.points;
          if (next.selectionStyle === "editor") fluidGuide.update(next.fluidEditor ?? null, selectedPoints, selected?.radius);
          else fluidGuide.clear();
        }
        if (settingsChanged) applySceneSettings(next.settings);
        if (modelChanged) applyModelState(next.settings);
        if (instancesChanged || modelChanged || appliedInput?.selectedPath !== next.selectedPath || appliedInput?.selectedInstanceId !== next.selectedInstanceId || appliedInput?.selectionStyle !== next.selectionStyle) {
          applySelection(next.selectedPath, next.selectedInstanceId, next.selectionStyle);
        }
        syncTransformControl(next);
        if (!next.fluidEditor?.active && (modelRadius === null ? !emptyCameraInitialized : !cameraInitialized)) fitCameraToScene();
        if (next.modelFocusRequest && next.modelFocusRequest.requestId !== appliedFocusRequestId) {
          const record = records.find((candidate) => candidate.id === next.modelFocusRequest!.instanceId);
          if (!record?.wrapper.visible) throw new Error(`聚焦目标模型不存在或已隐藏：${next.modelFocusRequest.instanceId}`);
          if (walk || navigation.mode === "loading") exitWalk("已切换到模型聚焦视角");
          focusSceneObject(camera, controls, record.wrapper, next.settings.preventBottomView);
          appliedFocusRequestId = next.modelFocusRequest.requestId;
        }
        appliedInput = next;
        notifyStatus({ status: records.length || fluids.diagnostics().fluidCount ? "ready" : "empty" });
      } catch (reason) {
        if (disposed || version !== revision) return;
        appliedInput = null;
        console.error("Failed to update 3D scene runtime.", { projectId, canvasNodeId, revision: version, graph, reason });
        notifyStatus({ status: "error", message: `3D 场景更新失败：${reason instanceof Error ? reason.message : String(reason)}` });
      }
    };
    return { update, pickSceneTarget, pickSceneObject, pickFluidPoint, enterWalk, exitWalk, navigationStatus: () => navigation, dispose: disposeRuntime, diagnostics: () => lastDiagnostics };
  } catch (reason) {
    for (const cleanup of constructionCleanup.reverse()) cleanup();
    throw reason;
  }
}
