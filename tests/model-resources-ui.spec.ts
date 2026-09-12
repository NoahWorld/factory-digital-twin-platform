import { test, expect } from "@playwright/test";
import { createDemo, localApi } from "./demo";
import { login } from "./support";
import { DEFAULT_SCENE_SETTINGS, IDENTITY_TRANSFORM } from "../shared/scene-definition";

// Vite may version modules with ?t= after edits. Read the module actually loaded
// by this page rather than importing a second, empty copy for instrumentation.
const diagnostics = (page: import("@playwright/test").Page) => page.evaluate(async () => {
  const url = performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => name.includes("/src/canvas/model-resource-cache.ts")).at(-1);
  if (!url) throw new Error("The model resource module has not loaded.");
  return (await import(/* @vite-ignore */ url)).modelResourceDiagnostics();
});

test("two rendered model consumers share a resource and repeated exits release all leases", async ({ page }, testInfo) => {
  const api = await localApi(); const demo = await createDemo(api, true);
  const path = `/api/v1/projects/${demo.projectId}`;
  try {
    const original = demo.canvas.nodes.find((node: { type: string }) => node.type === "model-3d");
    const updated = await api.patch(`${path}/canvas`, { data: { expectedRevision: demo.canvas.revision,
      upsertNodes: [{ ...original, x: 40, y: 140, width: 880, height: 340 }, { ...original, id: "second-model-view", x: 40, y: 510, width: 880, height: 340,
        props: { ...original.props, appearanceOverrides: { DemoDevice001: { color: "#ff0000", opacity: 1, visible: true } } } }], deleteNodeIds: [] } });
    expect(updated.status(), await updated.text()).toBe(200);
    await login(page);
    let loads = 0;
    page.on("request", (request) => { if (request.url().includes("/model-assets/") && request.url().endsWith("/content")) loads++; });
    for (let index = 0; index < 3; index++) {
      await page.goto(`/#/projects/${demo.projectId}/canvas`);
      await expect(page.locator(".model-3d-edit-hint")).toHaveCount(2);
      await expect.poll(async () => (await diagnostics(page)).leases).toBe(2);
      expect((await diagnostics(page)).resources).toBe(1);
      expect(loads).toBe(index + 1);
      if (index === 0) {
        await page.screenshot({ path: testInfo.outputPath("independent-model-materials.png") });
        await page.locator('[data-node-id="second-model-view"]').click();
        await page.getByRole("button", { name: "删除组件", exact: true }).click();
        await expect.poll(async () => (await diagnostics(page)).leases).toBe(1);
        await expect(page.locator(".model-3d-edit-hint")).toHaveCount(1);
        await page.getByRole("button", { name: "撤销", exact: true }).click();
        await expect.poll(async () => (await diagnostics(page)).leases).toBe(2);
        expect(loads).toBe(1);
      }
      await page.getByRole("link", { name: "返回项目列表", exact: true }).click();
      await expect.poll(async () => await diagnostics(page)).toMatchObject({ resources: 0, leases: 0, pending: 0 });
    }
  } finally { await api.delete(path); await api.dispose(); }
});

test("shared texture, material, geometry and ImageBitmap dispose once", async ({ page }) => {
  await login(page);
  const result = await page.evaluate(async () => {
    const cachePath = "/src/canvas/model-resource-cache.ts";
    const threePath = "/node_modules/.vite/deps/three.js";
    const { disposeObjectResources } = await import(/* @vite-ignore */ cachePath);
    const THREE = await import(/* @vite-ignore */ threePath);
    const canvas = document.createElement("canvas"); canvas.width = 2; canvas.height = 2;
    const bitmap = await createImageBitmap(canvas);
    const texture = new THREE.Texture(bitmap);
    const geometry = new THREE.BoxGeometry(); const material = new THREE.MeshBasicMaterial({ map: texture });
    const calls = { texture: 0, geometry: 0, material: 0 };
    texture.addEventListener("dispose", () => calls.texture++); geometry.addEventListener("dispose", () => calls.geometry++); material.addEventListener("dispose", () => calls.material++);
    const root = new THREE.Group(); root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
    disposeObjectResources([root]);
    return { ...calls, bitmapWidth: bitmap.width };
  });
  expect(result).toEqual({ texture: 1, geometry: 1, material: 1, bitmapWidth: 0 });
});

test("a failed model load releases its lease and the visible retry recovers", async ({ page }) => {
  const api = await localApi(); const demo = await createDemo(api, true);
  try {
    await login(page);
    await page.route("**/model-assets/*/content", (route) => route.abort("failed"));
    await page.goto(`/#/projects/${demo.projectId}/preview`);
    await expect(page.getByRole("button", { name: "重新加载模型", exact: true })).toBeVisible();
    await expect.poll(async () => await diagnostics(page)).toMatchObject({ resources: 0, leases: 0, pending: 0 });
    await page.unroute("**/model-assets/*/content");
    await page.getByRole("button", { name: "重新加载模型", exact: true }).click();
    await expect(page.locator(".model-3d-edit-hint")).toHaveCount(1);
    await expect.poll(async () => (await diagnostics(page)).leases).toBe(1);
    await page.getByRole("link", { name: "返回项目列表", exact: true }).click();
    await expect.poll(async () => await diagnostics(page)).toMatchObject({ resources: 0, leases: 0, pending: 0 });
  } finally { await api.delete(`/api/v1/projects/${demo.projectId}`); await api.dispose(); }
});

test("closing additional viewports cannot retain renderer listeners on a shared live model", async ({ page }) => {
  const api = await localApi(); const demo = await createDemo(api, true);
  try {
    await login(page);
    const model = demo.canvas.nodes.find((node: { type: string }) => node.type === "model-3d");
    const scene = { id: "listener-scene", name: "Listener check", settings: DEFAULT_SCENE_SETTINGS, assetBindings: [], instances: [{ id: "instance", name: "Device", modelAssetId: model.resourceRefs[0], transform: IDENTITY_TRANSFORM, visible: true, appearance: null, objectTransforms: {}, objectAppearances: {} }] };
    const counts = await page.evaluate(async ({ scene, projectId }) => {
      const runtimePath = "/src/canvas/scene-viewport-runtime.ts"; const { createSceneViewport } = await import(/* @vite-ignore */ runtimePath);
      const cachePath = performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => name.includes("/src/canvas/model-resource-cache.ts")).at(-1)!;
      const { acquireModelResource } = await import(/* @vite-ignore */ cachePath);
      const url = `/api/v1/projects/${projectId}/model-assets/${scene.instances[0].modelAssetId}/content`;
      const probe = acquireModelResource(url); const model = await probe.ready;
      let geometry: any; model.scene.traverse((object: any) => { if (object.geometry) geometry = object.geometry; });
      const frames = () => new Promise<void>((resolve) => { let count = 0; const frame = () => ++count === 3 ? resolve() : requestAnimationFrame(frame); requestAnimationFrame(frame); });
      const open = async () => {
        const container = document.createElement("div"); container.style.cssText = "position:fixed;left:0;top:0;width:400px;height:300px;z-index:9999"; document.body.append(container);
        let ready!: () => void; const loaded = new Promise<void>((resolve) => { ready = resolve; });
        const options = { projectId, scene, legacyNames: true, cameraControlsEnabled: false, onSnapshot() {}, onState(state: { loaded: number }) { if (state.loaded === 1) ready(); } };
        const engine = createSceneViewport(container, options); engine.update(options); await loaded; await frames();
        return () => { engine.dispose(); container.remove(); };
      };
      const closeFirst = await open();
      const counts = [geometry._listeners?.dispose?.length ?? 0];
      try { for (let index = 0; index < 3; index++) { const close = await open(); close(); counts.push(geometry._listeners?.dispose?.length ?? 0); } }
      finally { closeFirst(); probe.release(); }
      return counts;
    }, { scene, projectId: demo.projectId });
    console.log(JSON.stringify({ check: "shared-model-renderer-dispose-listeners", counts }));
    expect(counts).toEqual(counts.map(() => counts[0]));
  } finally { await api.delete(`/api/v1/projects/${demo.projectId}`); await api.dispose(); }
});
