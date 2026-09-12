import { test, expect } from "@playwright/test";
import { createDemo, localApi } from "./demo";
import { login } from "./support";

const diagnostics = (page: import("@playwright/test").Page) => page.evaluate(`import('/src/canvas/model-resource-cache.ts').then(m => m.modelResourceDiagnostics())`);

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
