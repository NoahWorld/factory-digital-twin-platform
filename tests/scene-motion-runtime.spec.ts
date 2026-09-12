import { test, expect } from "@playwright/test";
import { createDemo, localApi } from "./demo";
import { login } from "./support";
import { DEFAULT_SCENE_SETTINGS, IDENTITY_TRANSFORM } from "../shared/scene-definition";

test("scene frame loop plays object and camera paths, holds results, restores on stop and cancels disposed jobs", async ({ page }) => {
  const api = await localApi(); const demo = await createDemo(api,true); const path = `/api/v1/projects/${demo.projectId}`;
  try {
    const model = (await (await api.get(`${path}/model-assets`)).json()).modelAssets[0];
    await login(page);
    const motion = { id: "motion", name: "设备与镜头路径", version: 1, durationMs: 300, repeat: 1, fill: "hold", tracks: [
      { id: "move", type: "object", target: { instanceId: "device", objectId: null }, property: "position", easing: "linear", keyframes: [{ timeMs: 0, value: [0,0,0] }, { timeMs: 300, value: [0,2,0] }] },
      { id: "camera-position", type: "camera", property: "position", easing: "linear", keyframes: [{ timeMs: 0, value: [8,8,8] }, { timeMs: 300, value: [5,5,5] }] },
      { id: "camera-target", type: "camera", property: "target", easing: "smooth", keyframes: [{ timeMs: 0, value: [0,0,0] }, { timeMs: 300, value: [0,2,0] }] },
    ] };
    const scene = { id: "motion-scene", name: "Motion", settings: DEFAULT_SCENE_SETTINGS, assetBindings: [], motions: [motion], instances: [{ id: "device", name: "Device", modelAssetId: model.id, transform: IDENTITY_TRANSFORM, visible: true, appearance: null, objectTransforms: {}, objectAppearances: {} }] };
    const result = await page.evaluate(async ({ projectId, scene }) => {
      const modulePath = "/src/canvas/scene-viewport-runtime.ts";
      const { createSceneViewport,sceneViewportDiagnostics } = await import(/* @vite-ignore */ modulePath);
      const element = document.createElement("div"); element.style.cssText = "width:600px;height:400px;position:fixed;left:0;top:0"; document.body.append(element);
      let ready!: () => void; const wait = new Promise<void>((resolve) => { ready = resolve; });
      const options = { projectId, scene, cameraControlsEnabled: false, onSnapshot: () => {}, onState: (state: { status: string }) => { if (state.status === "ready") ready(); } };
      const engine = createSceneViewport(element,options); engine.update(options); await wait;
      const read = () => sceneViewportDiagnostics().find((entry: { sceneId: string }) => entry.sceneId === scene.id);
      const before = read();
      try {
        await engine.playMotion("motion",new AbortController().signal);
        const complete = read(); engine.stopMotion("motion"); const stopped = read();
        const controller = new AbortController(); const pending = engine.playMotion("motion",controller.signal).then(() => "completed", (reason: Error) => reason.name);
        await Promise.resolve(); await Promise.resolve(); engine.dispose(); const cancelled = await pending;
        return { before, complete, stopped, cancelled, remaining: sceneViewportDiagnostics().length };
      } finally { engine.dispose(); element.remove(); }
    },{ projectId: demo.projectId,scene });
    expect(result.complete.instanceStates[0].position).toEqual([0,2,0]); expect(result.complete.camera).toEqual([5,5,5]); expect(result.complete.target).toEqual([0,2,0]);
    expect(result.complete.motion).toEqual({ active: 0,heldChannels: 3 }); expect(result.stopped.instanceStates[0].position).toEqual([0,0,0]); expect(result.stopped.camera).toEqual(result.before.camera);
    expect(result.stopped.motion).toEqual({ active: 0,heldChannels: 0 }); expect(result.cancelled).toBe("AbortError"); expect(result.remaining).toBe(0);
  } finally { await api.delete(path); await api.dispose(); }
});

test("stop cancels loading requests and camera-only motion waits for the initial fitted view", async ({ page }) => {
  const api = await localApi(); const demo = await createDemo(api,true); const path = `/api/v1/projects/${demo.projectId}`;
  let release!: () => void;
  try {
    const model = (await (await api.get(`${path}/model-assets`)).json()).modelAssets[0];
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await login(page); await page.route(`**/model-assets/${model.id}/content`,async (route) => { await gate; await route.continue(); });
    await page.evaluate(async ({ projectId,modelId,settings,transform }) => {
      const modulePath = "/src/canvas/scene-viewport-runtime.ts"; const mod = await import(/* @vite-ignore */ modulePath);
      const element = document.createElement("div"); element.style.cssText = "width:600px;height:400px;position:fixed;left:0;top:0"; document.body.append(element);
      const scene = { id: "late",name: "Late camera",settings,assetBindings: [],instances: [{ id: "device",name: "Device",modelAssetId: modelId,transform,visible: true,appearance: null,objectTransforms: {},objectAppearances: {} }],motions: [{ id: "camera",name: "Camera",version: 1,durationMs: 200,repeat: 1,fill: "restore",tracks: [{ id: "track",type: "camera",property: "position",easing: "linear",keyframes: [{ timeMs: 0,value: [8,8,8] },{ timeMs: 200,value: [5,5,5] }] }] }] };
      let ready!: () => void; const loaded = new Promise<void>((resolve) => { ready = resolve; });
      const options = { projectId,scene,cameraControlsEnabled: false,onSnapshot: () => {},onState: (state: { status: string }) => { if (state.status === "ready") ready(); } };
      const engine = mod.createSceneViewport(element,options); engine.update(options);
      const result = engine.playMotion("camera",new AbortController().signal).then(() => "finished",(reason: Error) => reason.name);
      (window as any).__lateMotion = { engine,element,result,loaded,read: () => mod.sceneViewportDiagnostics().find((item: { sceneId: string }) => item.sceneId === "late") };
    },{ projectId: demo.projectId,modelId: model.id,settings: DEFAULT_SCENE_SETTINGS,transform: IDENTITY_TRANSFORM });
    const before = await page.evaluate(() => (window as any).__lateMotion.read()); expect(before.pending).toBe(1); expect(before.motion.active).toBe(0);
    const cancelled = await page.evaluate(async () => { const value = (window as any).__lateMotion; value.engine.stopMotion("camera"); return value.result; }); expect(cancelled).toBe("AbortError");
    release();
    const after = await page.evaluate(async () => {
      const value = (window as any).__lateMotion; await value.loaded; const fitted = value.read();
      await value.engine.playMotion("camera",new AbortController().signal); const restored = value.read();
      value.engine.dispose(); value.element.remove(); delete (window as any).__lateMotion; return { fitted,restored };
    });
    expect(after.fitted.camera).not.toEqual([0,0,0]); expect(after.restored.camera).toEqual(after.fitted.camera); expect(after.restored.motion.active).toBe(0);
  } finally { release?.(); await page.evaluate(() => { const value = (window as any).__lateMotion; value?.engine.dispose(); value?.element.remove(); delete (window as any).__lateMotion; }); await api.delete(path); await api.dispose(); }
});
