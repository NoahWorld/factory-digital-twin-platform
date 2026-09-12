import { test,expect } from "@playwright/test";
import { createDemo,localApi } from "./demo";
import { login } from "./support";
import { createAnimatedMockGltf,createDeformedMockGltf } from "../scripts/mock-model.mjs";
import { DEFAULT_SCENE_SETTINGS,IDENTITY_TRANSFORM } from "../shared/scene-definition";

test("native clip timelines animate one clone, combine with its root path and restore mixers and pose", async ({ page }) => {
  const api = await localApi(); const demo = await createDemo(api,false); const path = `/api/v1/projects/${demo.projectId}`;
  try {
    const response = await api.post(`${path}/model-assets?filename=native.gltf`,{ data: createAnimatedMockGltf(),headers: { "content-type": "model/gltf+json" } }); expect(response.status()).toBe(201); const model = (await response.json()).modelAsset;
    await login(page);
    const result = await page.evaluate(async ({ projectId,model,settings,transform }) => {
      const url = "/src/canvas/scene-viewport-runtime.ts"; const mod = await import(/* @vite-ignore */ url);
      const instance = { id: "one",name: "One",modelAssetId: model.id,transform,visible: true,appearance: null,objectTransforms: {},objectAppearances: {} };
      const scene = { id: "native-scene",name: "Native",settings,assetBindings: [],instances: [instance,{ ...instance,id: "two",transform: { ...transform,position: [4,0,0] } }],motions: [{ id: "lift",name: "Lift",version: 1,durationMs: 300,repeat: 1,fill: "hold",tracks: [
        { id: "clip",type: "clip",target: { instanceId: "one",objectId: null },property: "clip",clipId: model.inspection.clips[0].clipId,easing: "linear",keyframes: [{ timeMs: 0,value: 0 },{ timeMs: 300,value: 1 }] },
        { id: "root-path",type: "object",target: { instanceId: "one",objectId: null },property: "position",easing: "linear",keyframes: [{ timeMs: 0,value: [0,0,0] },{ timeMs: 300,value: [0,1,0] }] },
      ] }] };
      const container = document.createElement("div"); container.style.cssText = "width:800px;height:600px;position:fixed;left:0;top:0"; document.body.append(container);
      let ready!: () => void; const wait = new Promise<void>((resolve) => { ready = resolve; });
      const options = { projectId,scene,cameraControlsEnabled: false,onSnapshot: () => {},onState: (state: { status: string }) => { if (state.status === "ready") ready(); } };
      const engine = mod.createSceneViewport(container,options); engine.update(options); await wait;
      const read = () => mod.sceneViewportDiagnostics().find((item: { sceneId: string }) => item.sceneId === scene.id);
      const object = model.inspection.objects[0].objectId;
      try {
        await engine.playMotion("lift",new AbortController().signal);
        const playing = read(), position = mod.inspectSceneViewportObject(playing.id,{ instanceId: "one",objectId: object }).center;
        const other = mod.inspectSceneViewportObject(playing.id,{ instanceId: "two",objectId: object }).center;
        engine.update({ ...options,runtimeAppearances: { one: { [object]: { color: "#ff0000",opacity: 1,visible: true } } } });
        const afterColor = mod.inspectSceneViewportObject(playing.id,{ instanceId: "one",objectId: object });
        engine.stopMotion("lift"); const stopped = read(), restored = mod.inspectSceneViewportObject(playing.id,{ instanceId: "one",objectId: object }).center;
        return { playing,position,other,afterColor,stopped,restored };
      } finally { engine.dispose(); container.remove(); }
    },{ projectId: demo.projectId,model,settings: DEFAULT_SCENE_SETTINGS,transform: IDENTITY_TRANSFORM });
    expect(result.position[1]).toBeCloseTo(3); expect(result.other[1]).toBeCloseTo(0); expect(result.afterColor.center[1]).toBeCloseTo(3); expect(result.afterColor.colors).toContain("#ff0000");
    expect(result.playing.instanceStates[0].nativeClip.time).toBe(1); expect(result.playing.instanceStates[1].nativeClip).toBeNull();
    expect(result.stopped.instanceStates[0].nativeClip).toBeNull(); expect(result.restored[1]).toBeCloseTo(0); expect(result.stopped.motion).toEqual({ active: 0,heldChannels: 0 });
  } finally { await api.delete(path); await api.dispose(); }
});

test("native skin joints and morph weights are independent per cloned instance and return to their original pose", async ({ page }) => {
  const api = await localApi(); const demo = await createDemo(api,false); const path = `/api/v1/projects/${demo.projectId}`;
  try {
    await login(page);
    for (const kind of ["skin","morph"]) {
      const upload = await api.post(`${path}/model-assets?filename=${kind}.gltf`,{ data: createDeformedMockGltf(kind),headers: { "content-type": "model/gltf+json" } }); expect(upload.status(),await upload.text()).toBe(201); const model = (await upload.json()).modelAsset;
      const result = await page.evaluate(async ({ model,projectId,settings,transform }) => {
        const url = "/src/canvas/scene-viewport-runtime.ts"; const mod = await import(/* @vite-ignore */ url);
        const instance = { id: "a",name: "A",modelAssetId: model.id,transform,visible: true,appearance: null,objectTransforms: {},objectAppearances: {} };
        const scene = { id: "deformed",name: "Deformed",settings,assetBindings: [],instances: [instance,{ ...instance,id: "b",transform: { ...transform,position: [4,0,0] } }],motions: [{ id: "clip",name: "Clip",version: 1,durationMs: 150,repeat: 1,fill: "hold",tracks: [{ id: "track",type: "clip",property: "clip",target: { instanceId: "a",objectId: null },clipId: model.inspection.clips[0].clipId,easing: "linear",keyframes: [{ timeMs: 0,value: 0 },{ timeMs: 150,value: 1 }] }] }] };
        const element = document.createElement("div"); element.style.cssText = "width:800px;height:600px;position:fixed;left:0;top:0"; document.body.append(element);
        let ready!: () => void; const loaded = new Promise<void>((resolve) => { ready = resolve; });
        const options = { projectId,scene,cameraControlsEnabled: false,onSnapshot: () => {},onState: (state: { status: string }) => { if (state.status === "ready") ready(); } };
        const engine = mod.createSceneViewport(element,options); engine.update(options); await loaded;
        const target = model.inspection.clips[0].channels[0].objectId;
        const viewport = mod.sceneViewportDiagnostics().find((item: { sceneId: string }) => item.sceneId === scene.id);
        try {
          await engine.playMotion("clip",new AbortController().signal);
          const a = mod.inspectSceneViewportObject(viewport.id,{ instanceId: "a",objectId: target }), b = mod.inspectSceneViewportObject(viewport.id,{ instanceId: "b",objectId: target });
          engine.stopMotion(); const restored = mod.inspectSceneViewportObject(viewport.id,{ instanceId: "a",objectId: target });
          return { a,b,restored };
        } finally { engine.dispose(); element.remove(); }
      },{ model,projectId: demo.projectId,settings: DEFAULT_SCENE_SETTINGS,transform: IDENTITY_TRANSFORM });
      if (kind === "skin") { expect(result.a.position[1]).toBe(2); expect(result.b.position[1]).toBe(0); expect(result.restored.position[1]).toBe(0); }
      else { expect(result.a.morphWeights).toEqual([1]); expect(result.b.morphWeights).toEqual([0]); expect(result.restored.morphWeights).toEqual([0]); }
    }
  } finally { await api.delete(path); await api.dispose(); }
});
