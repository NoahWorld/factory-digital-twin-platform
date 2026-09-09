import * as THREE from "three";
import type { Material, Object3D } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { buildModelSceneTree, type ModelSceneSnapshot } from "../canvas/model-scene";
import type { Model3DProps, ModelAssetInstance, ModelNodeAppearance } from "../canvas/types";
import { ResourceManager } from "./resource-manager";
import { InstanceManager, disposeClonedMaterials, type InstanceRecord, type MaterialObject } from "./instance-manager";
import { createSceneModelLoader, disposeModelResources } from "./model-loader";
import { createPickingService } from "./picking-service";

type ColorMaterial = Material & { color?: { set: (value: string) => unknown }; metalness?: number; roughness?: number };
export type SceneStatus = { status: "empty" | "loading" | "ready" } | { status: "error"; message: string };
export type SceneSnapshot = { scene: ModelSceneSnapshot; animationCount: number };
export type SceneInput = {
  instances: ModelAssetInstance[];
  settings: Model3DProps;
  appearanceOverrides: Record<string, ModelNodeAppearance>;
  selectedPath: string | null;
  selectedInstanceId: string | null;
  controlsEnabled: boolean;
};
export type SceneDiagnostics = {
  activeLoads: number; queuedLoads: number; resources: number; instanceCount: number;
  cameraPosition: number[]; cameraTarget: number[];
  frameMs: number; drawCalls: number; triangles: number; geometries: number; textures: number;
};
export type SceneRuntime = ReturnType<typeof createSceneRuntime>;

/** Owns one renderer per scene. React passes configuration, never Three.js objects. */
export function createSceneRuntime({ container, projectId, canvasNodeId, initial, onStatus, onSnapshot, onDiagnostics }: {
  container: HTMLElement;
  projectId: string;
  canvasNodeId: string;
  initial: SceneInput;
  onStatus: (status: SceneStatus) => void;
  onSnapshot: (snapshot: SceneSnapshot | null) => void;
  onDiagnostics?: (diagnostics: SceneDiagnostics) => void;
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.replaceChildren(renderer.domElement);

    const environmentLight = new THREE.HemisphereLight(initial.settings.environmentLightColor, 0x14202a, initial.settings.environmentLightIntensity);
    const keyLight = new THREE.DirectionalLight(initial.settings.keyLightColor, initial.settings.keyLightIntensity);
    keyLight.position.set(4, 8, 6);
    const rimLight = new THREE.DirectionalLight(0x8cc9ff, 1.3);
    rimLight.position.set(1, 5, -5);
    const warmLight = new THREE.DirectionalLight(0xffbd85, 0.7);
    warmLight.position.set(-6, 3, 0);
    scene.add(environmentLight, keyLight, rimLight, warmLight);

    const grid = new THREE.GridHelper(10, 20, 0x2a7590, 0x163d50);
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
    let records: InstanceRecord[] = [];
    let desired = initial;
    let revision = 0;
    let appliedGraph = "";
    let appliedInput: SceneInput | null = null;
    let contextLost = false;
    let cameraInitialized = false;
    let previousView = initial.settings.cameraView;
    const sceneCenter = new THREE.Vector3();
    let frameCount = 0;
    let frameTotal = 0;
    let sampleAt = performance.now();
    let lastDiagnostics: SceneDiagnostics | null = null;
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
      contextLost = true;
      renderer.setAnimationLoop(null);
      console.error("Batched 3D scene lost its WebGL context.", {
        canvasNodeId,
        instanceCount: records.length,
        uniqueAssetCount: new Set(records.map((instance) => instance.assetId)).size,
      });
      onStatus({ status: "error", message: "3D 图形上下文已丢失，请减少模型复杂度后重新打开场景。" });
    };

    const clearSelection = () => {
      if (!selectionHelper) return;
      scene.remove(selectionHelper);
      selectionHelper.geometry.dispose();
      selectionHelper.material.dispose();
      selectionHelper = null;
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
      document.removeEventListener("visibilitychange", updateLoop);
      manager.dispose();
      resources.dispose();
      modelLoader.dispose();
      grid.geometry.dispose();
      if (Array.isArray(grid.material)) grid.material.forEach((material) => material.dispose());
      else grid.material.dispose();
      environmentTarget?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (container.contains(renderer.domElement)) container.replaceChildren();
    };
    constructionCleanup.splice(0, constructionCleanup.length, disposeRuntime);
    renderer.domElement.addEventListener("webglcontextlost", handleContextLost);

    const fitCameraToScene = () => {
      if (modelRadius === null) return;
      const settings = desired.settings;
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
      camera.position.copy(direction.normalize().multiplyScalar(distance).add(sceneCenter));
      controls.target.copy(sceneCenter);
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
      if (!hasVisibleGeometry) {
        rotationPivot.rotation.y = priorRotation;
        modelRadius = null;
        return;
      }
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      if (![center.x, center.y, center.z, size.x, size.y, size.z].every(Number.isFinite)) {
        rotationPivot.rotation.y = priorRotation;
        throw new Error("模型实例变换产生了无效的场景边界");
      }
      sceneCenter.copy(center);
      if (!cameraInitialized) {
        rotationPivot.position.copy(center);
        contentOffset.position.copy(center).multiplyScalar(-1);
      }
      rotationPivot.rotation.y = priorRotation;
      scene.updateMatrixWorld(true);
      modelRadius = Math.max(size.length() / 2, 0.01);
      grid.scale.setScalar(Math.max(modelRadius / 2.5, 0.2));
      grid.position.set(center.x, box.min.y, center.z);
      camera.near = 0.01;
      camera.far = Math.max(modelRadius * 100, 100);
      camera.updateProjectionMatrix();
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
      applyAppearance(primary, {
        ...settings.appearanceOverrides,
        ...desired.appearanceOverrides,
      });
      updateSceneBounds();
    };

    const applySelection = (path: string | null, instanceId: string | null) => {
      clearSelection();
      let selected: Object3D | undefined;
      if (path !== null) {
        selected = primaryObjectsByPath.get(path);
        if (!selected) throw new Error(`主模型中找不到当前选择路径：${path}`);
      } else if (instanceId !== null) {
        selected = records.find((record) => record.id === instanceId)?.wrapper;
        if (!selected) throw new Error(`场景中找不到当前模型实例：${instanceId}`);
      }
      if (!selected) return;
      if (new THREE.Box3().setFromObject(selected).isEmpty()) return;
      selectionHelper = new THREE.BoxHelper(selected, 0x5ad8ff);
      selectionHelper.material.depthTest = false;
      selectionHelper.material.transparent = true;
      selectionHelper.material.opacity = 0.95;
      selectionHelper.material.toneMapped = false;
      selectionHelper.renderOrder = 100000;
      scene.add(selectionHelper);
    };

    const pick = createPickingService(camera, renderer.domElement);
    const pickSceneTarget = (x: number, y: number) => pick(x, y, records, primaryPathsByObject);

    const resize = () => {
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();
    const animate = (now: number) => {
      const frameMs = now - lastFrame;
      const deltaSeconds = Math.min(frameMs / 1000, 0.1);
      lastFrame = now;
      const settings = desired.settings;
      if (settings.playAnimations) records.forEach((record) => {
        if (record.wrapper.visible) record.mixer?.update(deltaSeconds * settings.animationSpeed);
      });
      if (settings.autoRotate) rotationPivot.rotation.y += deltaSeconds * settings.rotationSpeed;
      selectionHelper?.update();
      controls.update();
      renderer.render(scene, camera);
      frameCount++;
      frameTotal += frameMs;
      if (now - sampleAt >= 2000) {
        lastDiagnostics = {
          ...resources.stats, instanceCount: records.length,
          cameraPosition: camera.position.toArray(), cameraTarget: controls.target.toArray(),
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
      lastFrame = performance.now();
      frameCount = 0; frameTotal = 0; sampleAt = lastFrame;
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
      desired = next;
      controls.enabled = next.controlsEnabled;
      const version = ++revision;
      const graph = JSON.stringify(next.instances.map(({ id, assetId }) => [id, assetId]));
      try {
        if (contextLost) throw new Error("WebGL 上下文已丢失，请重新打开场景");
        const graphChanged = graph !== appliedGraph;
        if (graphChanged) {
          onStatus({ status: "loading" });
          if (!await manager.reconcile(next.instances) || disposed || version !== revision) return;
          records = manager.records;
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
        const modelKey = (value: SceneInput | null) => JSON.stringify(value && [value.settings.presentation, value.settings.transformOverrides, value.settings.appearanceOverrides, value.appearanceOverrides]);
        const modelChanged = graphChanged || modelKey(appliedInput) !== modelKey(next);
        if (instancesChanged) applyInstances(next.instances);
        if (settingsChanged) applySceneSettings(next.settings);
        if (modelChanged) applyModelState(next.settings);
        if (instancesChanged || modelChanged || appliedInput?.selectedPath !== next.selectedPath || appliedInput?.selectedInstanceId !== next.selectedInstanceId) {
          applySelection(next.selectedPath, next.selectedInstanceId);
        }
        if (!cameraInitialized) fitCameraToScene();
        appliedInput = next;
        onStatus({ status: records.length ? "ready" : "empty" });
      } catch (reason) {
        if (disposed || version !== revision) return;
        appliedInput = null;
        console.error("Failed to update 3D scene runtime.", { projectId, canvasNodeId, revision: version, graph, reason });
        onStatus({ status: "error", message: `3D 场景更新失败：${reason instanceof Error ? reason.message : String(reason)}` });
      }
    };
    return { update, pickSceneTarget, dispose: disposeRuntime, diagnostics: () => lastDiagnostics };
  } catch (reason) {
    for (const cleanup of constructionCleanup.reverse()) cleanup();
    throw reason;
  }
}
