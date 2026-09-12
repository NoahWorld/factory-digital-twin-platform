import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SceneDefinition } from "../../../../shared/scene-definition";
import type { ModelNodeAppearance } from "./types";
import type { ModelAsset } from "./model-assets";
import type { ModelSceneSnapshot } from "./model-scene";
import { modelAssetContentUrl, modelAssetsPath } from "./model-assets";
import { request } from "../api";
import { acquireModelResource, disposeObjectResources } from "./model-resource-cache";
import { createModelInstance, type ObjectTarget, type ModelInstanceController } from "./model-instance";
import { ViewportResources } from "./viewport-resources";
import { ResourcePool } from "../../../../shared/resource-pool";
import type { ModelObject } from "../../../../shared/model-inspection";

export type ViewportState = { status: "loading" | "ready" | "error"; loaded: number; total: number; message?: string };
export type SceneViewportOptions = {
  projectId: string; scene: SceneDefinition; legacyNames?: boolean; cameraControlsEnabled: boolean;
  selectedTarget?: ObjectTarget | null; selectedTargets?: ObjectTarget[]; selectedLegacyPath?: string | null;
  runtimeAppearances?: Record<string, Record<string, ModelNodeAppearance>>;
  onState: (state: ViewportState) => void;
  onSnapshot: (instanceId: string, snapshot: ModelSceneSnapshot | null) => void;
};
type RecordEntry = { assetId: string; lease: ReturnType<typeof acquireModelResource>; manifestLease?: ReturnType<ResourcePool<ModelObject[]>["acquire"]>; controller?: ModelInstanceController; releaseResources?: () => void; error?: string; signature?: string; pending: boolean; cancelled: boolean };
const diagnostics = new Map<string, () => unknown>();
const objectInspections = new Map<string, (target: ObjectTarget) => unknown>();
export const sceneViewportDiagnostics = () => [...diagnostics.values()].map((read) => read());
export const inspectSceneViewportObject = (viewportId: string, target: ObjectTarget) => objectInspections.get(viewportId)?.(target) ?? null;

export function createSceneViewport(container: HTMLElement, initial: SceneViewportOptions) {
  let options = initial, disposed = false, fitted = false;
  const id = crypto.randomUUID();
  const scene = new THREE.Scene();
  const content = new THREE.Group(); scene.add(content);
  const camera = new THREE.PerspectiveCamera(initial.scene.settings.cameraFov, 1, .001, 10000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  const entries = new Map<string, RecordEntry>();
  const resources = new ViewportResources();
  const manifests = new ResourcePool<ModelObject[]>(async (assetId, signal) => {
    const result = await request<{ modelAsset: ModelAsset }>(`${modelAssetsPath(initial.projectId)}/${encodeURIComponent(assetId)}`, { signal });
    if (!result.modelAsset.inspection.objects) throw new Error("模型缺少稳定对象清单，请补充资源检查。");
    return result.modelAsset.inspection.objects;
  }, () => {});
  const selections = new Map<THREE.Object3D, THREE.BoxHelper>();
  let selectionObject: THREE.Object3D | null = null;
  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = .08;
  const environment = new THREE.HemisphereLight(0xffffff, 0x14202a, 2); scene.add(environment);
  const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(4,8,6); scene.add(key);
  const grid = new THREE.GridHelper(10,20,0x2a7590,0x163d50); scene.add(grid);
  let visible = true;
  const bounds = () => new THREE.Box3().setFromObject(content);
  const refreshBounds = () => {
    content.updateMatrixWorld(true); const box = bounds(); if (box.isEmpty()) return;
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, .01);
    if (!Number.isFinite(radius)) throw new Error("场景模型边界无效");
    camera.near = Math.max(radius / 1000, .001); camera.far = Math.max(camera.position.distanceTo(box.getCenter(new THREE.Vector3())) + radius * 10, 100);
    camera.updateProjectionMatrix(); grid.scale.setScalar(Math.max(radius / 2.5, .2)); grid.position.y = box.min.y;
  };
  const fit = (instanceId?: string) => {
    const box = instanceId ? entries.get(instanceId)?.controller?.bounds() : bounds();
    if (!box || box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3()); const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, .01);
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const distance = radius / Math.sin(Math.max(Math.min(halfFov, Math.atan(Math.tan(halfFov) * camera.aspect)), .01)) * 1.15;
    const view = options.scene.settings.cameraView;
    const direction = view === "front" ? new THREE.Vector3(0,.12,1) : view === "top" ? new THREE.Vector3(.001,1,0) : new THREE.Vector3(1.35,.9,1.65);
    camera.up.set(0, view === "top" ? 0 : 1, view === "top" ? -1 : 0);
    camera.position.copy(center).add(direction.normalize().multiplyScalar(distance)); controls.target.copy(center); controls.update(); refreshBounds(); fitted = true;
  };
  const clearSelection = () => {
    for (const helper of selections.values()) { helper.removeFromParent(); helper.geometry.dispose(); helper.material.dispose(); }
    selections.clear(); selectionObject = null;
  };
  const isVisible = (object: THREE.Object3D) => { for (let current: THREE.Object3D | null = object; current; current = current.parent) if (!current.visible) return false; return true; };
  const updateSelection = () => {
    const first = entries.get(options.scene.instances[0]?.id)?.controller;
    const targets = options.selectedTargets ?? (options.selectedTarget ? [options.selectedTarget] : []);
    const objects = options.legacyNames && options.selectedLegacyPath
      ? [first?.objectAtPath(options.selectedLegacyPath)].filter((object): object is THREE.Object3D => !!object)
      : targets.map((target) => entries.get(target.instanceId)?.controller?.resolveTarget(target)).filter((object): object is THREE.Object3D => !!object);
    for (const [object, helper] of selections) if (!objects.includes(object) || !isVisible(object)) { helper.removeFromParent(); helper.geometry.dispose(); helper.material.dispose(); selections.delete(object); }
    selectionObject = objects[0] ?? null;
    for (const object of objects) if (isVisible(object) && !selections.has(object) && !new THREE.Box3().setFromObject(object).isEmpty()) {
      const helper = new THREE.BoxHelper(object, 0x5ad8ff);
      helper.material.depthTest = false; helper.material.transparent = true; helper.material.opacity = .95; helper.material.toneMapped = false; helper.renderOrder = 100000; scene.add(helper); selections.set(object, helper);
    }
  };
  const publish = () => {
    if (disposed) return;
    const values = [...entries.values()]; const errors = values.flatMap((entry) => entry.error ? [entry.error] : []);
    if (!values.some((entry) => entry.pending) && !fitted) fit();
    options.onState({ status: errors.length ? "error" : values.some((entry) => entry.pending) ? "loading" : "ready", loaded: values.filter((entry) => entry.controller).length, total: options.scene.instances.length, message: errors.length ? errors.slice(0,5).join("；") + (errors.length > 5 ? `；另有 ${errors.length - 5} 个实例错误。` : "") : undefined });
  };
  const release = (instanceId: string, entry: RecordEntry) => {
    entry.cancelled = true; entry.manifestLease?.release(); entry.controller?.dispose(); entry.releaseResources?.(); entry.lease.release(); options.onSnapshot(instanceId, null);
  };
  const apply = (instanceId: string, entry: RecordEntry) => {
    const definition = options.scene.instances.find((instance) => instance.id === instanceId);
    if (!definition || !entry.controller) return;
    const runtime = options.runtimeAppearances?.[instanceId] ?? {};
    const signature = JSON.stringify([definition, runtime]);
    if (signature !== entry.signature) { entry.signature = undefined; entry.controller.apply(definition, runtime); refreshBounds(); entry.signature = signature; }
  };
  const update = (next: SceneViewportOptions) => {
    if (disposed) return;
    const oldSceneId = options.scene.id, oldView = options.scene.settings.cameraView, oldLegacy = options.legacyNames;
    options = next;
    if (oldSceneId !== next.scene.id) fitted = false;
    const settings = next.scene.settings;
    renderer.setClearColor(settings.backgroundColor, settings.backgroundOpacity);
    environment.color.set(settings.environmentLightColor); environment.intensity = settings.environmentLightIntensity;
    key.color.set(settings.keyLightColor); key.intensity = settings.keyLightIntensity; grid.visible = settings.showGrid;
    camera.fov = settings.cameraFov; camera.updateProjectionMatrix(); controls.enabled = next.cameraControlsEnabled;
    controls.autoRotate = settings.autoRotate; controls.autoRotateSpeed = settings.rotationSpeed * 60 / (2 * Math.PI);
    // Acquire replacements before releasing old leases, keeping shared immutable resources alive.
    for (const definition of next.scene.instances) {
      const previous = entries.get(definition.id);
      if (previous?.assetId === definition.modelAssetId && oldLegacy === next.legacyNames) {
        if (previous.controller) { try { apply(definition.id, previous); previous.error = undefined; } catch (reason) { previous.error = String(reason); } }
        continue;
      }
      const entry: RecordEntry = { assetId: definition.modelAssetId, lease: acquireModelResource(modelAssetContentUrl(next.projectId, definition.modelAssetId)), manifestLease: next.legacyNames ? undefined : manifests.acquire(definition.modelAssetId), pending: true, cancelled: false };
      entries.set(definition.id, entry);
      if (previous) release(definition.id, previous);
      const manifest = entry.manifestLease?.ready ?? Promise.resolve([]);
      void Promise.all([entry.lease.ready, manifest]).then(([model, objects]) => {
        if (disposed || entry.cancelled) return;
        entry.releaseResources = resources.acquire(model.scene);
        entry.controller = createModelInstance(definition, model, objects, next.legacyNames); content.add(entry.controller.root);
        apply(definition.id, entry); entry.pending = false;
        options.onSnapshot(definition.id, entry.controller.snapshot); updateSelection(); publish();
      }).catch((reason) => {
        if (disposed || entry.cancelled) return;
        entry.pending = false; entry.error = `实例「${definition.name}」加载失败：${reason instanceof Error ? reason.message : String(reason)}`;
        entry.controller?.dispose(); entry.controller = undefined; entry.releaseResources?.(); entry.manifestLease?.release(); entry.lease.release(); publish();
      });
    }
    for (const [instanceId, entry] of entries) if (!next.scene.instances.some((instance) => instance.id === instanceId)) { release(instanceId, entry); entries.delete(instanceId); }
    if (oldView !== settings.cameraView) fit();
    updateSelection(); publish();
  };
  const resize = () => { renderer.setSize(Math.max(container.clientWidth, 1), Math.max(container.clientHeight, 1), false); camera.aspect = Math.max(container.clientWidth, 1) / Math.max(container.clientHeight, 1); camera.updateProjectionMatrix(); };
  const resizeObserver = new ResizeObserver(resize); const intersectionObserver = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? false; });
  container.replaceChildren(renderer.domElement); resizeObserver.observe(container); intersectionObserver.observe(container); resize();
  let lastFrame = performance.now();
  renderer.setAnimationLoop((now) => { const delta = Math.min((now - lastFrame) / 1000, .1); lastFrame = now; if (disposed || !visible || document.hidden) return; controls.update(delta); selections.forEach((helper) => helper.update()); renderer.render(scene, camera); });
  diagnostics.set(id, () => ({ id, sceneId: options.scene.id, instances: [...entries.values()].filter((entry) => entry.controller).length,
    ownedResources: resources.snapshot(), manifests: manifests.snapshot(), frame: renderer.info.render.frame,
    instanceStates: [...entries].map(([instanceId, entry]) => ({ instanceId, position: entry.controller?.root.position.toArray(), visible: entry.controller?.root.visible, materialColors: entry.controller?.materialColors(), error: entry.error ?? null })),
    selectedObjectName: selectionObject?.name ?? null, selectedCount: selections.size,
    pending: [...entries.values()].filter((entry) => entry.pending).length, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
    calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, camera: camera.position.toArray(), target: controls.target.toArray() }));
  objectInspections.set(id, (target) => entries.get(target.instanceId)?.controller?.inspectObject(target.objectId));
  const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2();
  return {
    update, fit,
    retry: () => { for (const [instanceId, entry] of entries) if (entry.error) { release(instanceId, entry); entries.delete(instanceId); } update(options); },
    pick: (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect(); pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1); raycaster.setFromCamera(pointer, camera);
      for (const hit of raycaster.intersectObject(content, true)) {
        if (!isVisible(hit.object)) continue;
        for (const entry of entries.values()) { const target = entry.controller?.targetFor(hit.object); if (target) return { target, ancestors: entry.controller?.targetsForObject(hit.object) ?? [], path: options.legacyNames ? entry.controller?.pathForObject(hit.object) ?? null : entry.controller?.pathFor(target) ?? null }; }
      }
      return null;
    },
    dispose: () => {
      if (disposed) return; disposed = true; renderer.setAnimationLoop(null); resizeObserver.disconnect(); intersectionObserver.disconnect(); controls.dispose(); clearSelection();
      for (const [instanceId, entry] of entries) release(instanceId, entry); entries.clear(); disposeObjectResources([scene]); renderer.dispose(); renderer.forceContextLoss(); diagnostics.delete(id); objectInspections.delete(id);
      if (container.contains(renderer.domElement)) container.replaceChildren();
    },
  };
}
export type SceneViewportRuntime = ReturnType<typeof createSceneViewport>;
