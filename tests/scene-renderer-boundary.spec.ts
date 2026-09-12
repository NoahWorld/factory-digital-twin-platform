import { test, expect } from "@playwright/test";
import { createDemo, localApi } from "./demo";
import { login } from "./support";
import { DEFAULT_SCENE_SETTINGS, IDENTITY_TRANSFORM } from "../shared/scene-definition";

test("failed instance updates roll back to the previous valid configuration", async ({ page }) => {
  const api = await localApi(); const demo = await createDemo(api, true);
  try {
    const model = (await (await api.get(`/api/v1/projects/${demo.projectId}/model-assets`)).json()).modelAssets[0];
    await login(page);
    const scene = { id: "boundary-scene", name: "Boundary", settings: DEFAULT_SCENE_SETTINGS, assetBindings: [], instances: [{ id: "instance", name: "Device", modelAssetId: model.id, transform: IDENTITY_TRANSFORM, visible: true, appearance: null, objectTransforms: {}, objectAppearances: {} }] };
    const result = await page.evaluate(async ({ projectId, scene }) => {
      const modulePath = "/src/canvas/scene-viewport-runtime.ts";
      const { createSceneViewport, sceneViewportDiagnostics } = await import(/* @vite-ignore */ modulePath);
      const container = document.createElement("div"); container.style.cssText = "width:800px;height:600px"; document.body.append(container);
      let resolveReady!: () => void; const ready = new Promise<void>((resolve) => { resolveReady = resolve; }); const states: string[] = [];
      const options = { projectId, scene, cameraControlsEnabled: false, onSnapshot: () => {}, onState: (state: { status: string; loaded: number }) => { states.push(state.status); if (state.loaded === 1) resolveReady(); } };
      const engine = createSceneViewport(container, options); engine.update(options); await ready;
      try {
        const broken = structuredClone(scene); broken.instances[0].transform.position[0] = 8;
        broken.instances[0].objectTransforms = { missing: { position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] } };
        engine.update({ ...options, scene: broken });
        const failed = sceneViewportDiagnostics()[0];
        engine.update(options); const recovered = sceneViewportDiagnostics()[0];
        return { failed, recovered, states };
      } finally { engine.dispose(); container.remove(); }
    }, { projectId: demo.projectId, scene });
    expect(result.states).toContain("error");
    expect(result.failed.instanceStates[0].position[0]).toBe(0);
    expect(result.recovered.instanceStates[0]).toMatchObject({ position: [0,0,0], error: null });
  } finally { await api.delete(`/api/v1/projects/${demo.projectId}`); await api.dispose(); }
});

test("retry recreates the renderer after temporary WebGL initialization failure", async ({ page }) => {
  const api = await localApi(); const demo = await createDemo(api, true);
  try {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      (window as unknown as { blockSceneWebGL: boolean }).blockSceneWebGL = true;
      HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
        if (type === "webgl2" && (window as unknown as { blockSceneWebGL: boolean }).blockSceneWebGL) return null;
        return original.call(this, type, ...args);
      } as typeof original;
    });
    await login(page); await page.goto(`/#/projects/${demo.projectId}/preview`);
    await expect(page.getByRole("button", { name: "重新加载模型", exact: true })).toBeVisible();
    await page.evaluate(() => { (window as unknown as { blockSceneWebGL: boolean }).blockSceneWebGL = false; });
    await page.getByRole("button", { name: "重新加载模型", exact: true }).click();
    await expect(page.locator(".model-3d-edit-hint")).toBeVisible();
    await expect(page.locator(".model-3d-renderer canvas")).toBeVisible();
  } finally { await api.delete(`/api/v1/projects/${demo.projectId}`); await api.dispose(); }
});

test("legacy primitive paths select the exact child while new object targets select the logical node", async ({ page }) => {
  await login(page);
  const result = await page.evaluate(async () => {
    const modulePath = "/src/canvas/model-instance.ts"; const threePath = "/node_modules/.vite/deps/three.js";
    const { createModelInstance } = await import(/* @vite-ignore */ modulePath); const THREE = await import(/* @vite-ignore */ threePath);
    const source = new THREE.Group(), group = new THREE.Group(); group.name = "logical-node";
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); mesh.name = "primitive-one"; group.add(mesh); source.add(group);
    const instance = { id: "instance", name: "Device", modelAssetId: "resource", transform: { position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] }, visible: true, appearance: null, objectTransforms: {}, objectAppearances: {} };
    const controller = createModelInstance(instance, { scene: source, nodesByIndex: new Map([[0,group]]) }, [{ objectId: "object", nodeIndex: 0 }], true);
    try { return { exact: controller.objectAtPath("0/0")?.name, pickedPath: controller.pathForObject(mesh), logical: controller.resolveTarget(controller.targetAtPath("0/0"))?.name }; }
    finally { controller.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); }
  });
  expect(result).toEqual({ exact: "primitive-one", pickedPath: "0/0", logical: "logical-node" });
});

test("retry after a module fetch failure reloads the engine and preserves the local draft", async ({ page }) => {
  const api = await localApi(); const demo = await createDemo(api, true);
  try {
    await login(page);
    await page.route("**/scene-viewport-runtime.ts*", (route) => route.abort("failed"));
    await page.goto(`/#/projects/${demo.projectId}/canvas`);
    await expect(page.getByRole("button", { name: "重新加载模型", exact: true })).toBeVisible();
    await page.getByLabel("页面名称", { exact: true }).fill("模块恢复时保留草稿"); await page.getByLabel("页面名称", { exact: true }).press("Enter");
    await page.unroute("**/scene-viewport-runtime.ts*");
    await page.getByRole("button", { name: "重新加载模型", exact: true }).click();
    await expect(page.getByLabel("页面名称", { exact: true })).toHaveValue("模块恢复时保留草稿");
    await expect(page.locator(".model-3d-edit-hint")).toBeVisible();
  } finally { await api.delete(`/api/v1/projects/${demo.projectId}`); await api.dispose(); }
});
