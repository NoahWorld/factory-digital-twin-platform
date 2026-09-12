import { test, expect } from "@playwright/test";
import { createDemo, localApi } from "./demo";
import { login } from "./support";
import { createMockGltf } from "../scripts/mock-model.mjs";

async function diagnostics(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const url = performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => name.includes("/src/canvas/scene-viewport-runtime.ts")).at(-1);
    if (!url) throw new Error("Scene renderer has not loaded."); return (await import(/* @vite-ignore */ url)).sceneViewportDiagnostics();
  });
}

test("convert, compose independent model instances, preserve camera and reuse or copy scenes across pages", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const api = await localApi(); const demo = await createDemo(api, true); const path = `/api/v1/projects/${demo.projectId}`;
  const number = async (label: string, value: string) => { await page.getByLabel(label, { exact: true }).fill(value); await page.getByLabel(label, { exact: true }).press("Enter"); };
  const openEditor = async () => { await page.locator(".canvas-node.is-model-3d").click(); await page.getByRole("button", { name: "进入 3D 编辑器", exact: true }).click(); };
  try {
    const original = (await (await api.get(`${path}/model-assets`)).json()).modelAssets[0];
    const upload = await api.post(`${path}/model-assets?filename=second-machine.gltf`, { data: createMockGltf([{ mesh: 0, name: "DemoDevice001", scale: [.5,2,.5] }]), headers: { "content-type": "model/gltf+json" } });
    expect(upload.status(), await upload.text()).toBe(201); const other = (await upload.json()).modelAsset;
    await login(page); await page.goto(`/#/projects/${demo.projectId}/canvas`); await openEditor();
    await expect(page.locator(".model-3d-edit-hint")).toBeVisible();
    await page.getByRole("button", { name: "创建可复用场景", exact: true }).click();
    await expect(page.getByRole("heading", { name: "场景与实例", exact: true })).toBeVisible();
    await page.getByLabel("场景名称", { exact: true }).fill("共享工厂场景");
    await page.getByLabel("添加模型资源", { exact: true }).selectOption(original.id);
    await page.getByRole("button", { name: "添加模型实例", exact: true }).click();
    await expect(page.locator(".scene-instance-list button")).toHaveCount(2);
    await number("实例位置 X", "6");
    await page.getByLabel("实例颜色", { exact: true }).fill("#dd6655");
    await page.locator(".scene-object-tree button").filter({ hasText: "DemoDevice001" }).click();
    await page.getByLabel("对象绑定资产", { exact: true }).selectOption("DEVICE-002");
    await page.getByRole("button", { name: "保存对象绑定", exact: true }).click();
    await page.getByLabel("添加模型资源", { exact: true }).selectOption(other.id);
    await page.getByRole("button", { name: "添加模型实例", exact: true }).click();
    await expect(page.locator(".scene-instance-list button")).toHaveCount(3);
    await number("实例位置 X", "-6");
    await expect.poll(async () => (await diagnostics(page))[0]?.instances).toBe(3);
    expect(await diagnostics(page)).toHaveLength(1); await expect(page.locator(".model-3d-renderer canvas")).toHaveCount(1);
    await page.getByRole("button", { name: "查看全部", exact: true }).click();
    const box = await page.locator(".model-3d-renderer canvas").boundingBox();
    await page.mouse.move(box!.x + box!.width * .5, box!.y + box!.height * .5); await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * .5 + 80, box!.y + box!.height * .5 + 30, { steps: 8 }); await page.mouse.up();
    await page.evaluate(() => new Promise<void>((resolve) => { let count = 0; const frame = () => ++count >= 100 ? resolve() : requestAnimationFrame(frame); requestAnimationFrame(frame); }));
    const before = (await diagnostics(page))[0];
    await number("实例位置 X", "-7");
    const after = (await diagnostics(page))[0];
    before.camera.forEach((value: number, index: number) => expect(after.camera[index]).toBeCloseTo(value, 3));
    before.target.forEach((value: number, index: number) => expect(after.target[index]).toBeCloseTo(value, 3));
    await page.screenshot({ path: testInfo.outputPath("three-instances-one-renderer.png") });
    await page.getByRole("button", { name: "保存并返回", exact: true }).click();
    await expect(page.locator(".canvas-document-meta")).toContainText("已保存");
    let current = (await (await api.get(`${path}/definition`)).json()).definition;
    expect(current.scenes).toHaveLength(1); const sharedId = current.scenes[0].id;
    expect(current.scenes[0].instances.map((instance: { transform: { position: number[] } }) => instance.transform.position[0])).toEqual([0,6,-7]);
    expect(current.scenes[0].assetBindings).toHaveLength(3);
    await page.getByRole("button", { name: "复制页面", exact: true }).click();
    await openEditor(); await page.locator(".scene-instance-list button").first().click(); await number("实例位置 X", "-8");
    await page.getByRole("button", { name: "保存并返回", exact: true }).click();
    await expect(page.locator(".canvas-document-meta")).toContainText("已保存");
    current = (await (await api.get(`${path}/definition`)).json()).definition;
    expect(current.scenes).toHaveLength(1); expect(current.scenes[0].instances[0].transform.position[0]).toBe(-8);
    for (const document of current.pages) expect(document.nodes.find((node: { type: string }) => node.type === "model-3d").sceneId).toBe(sharedId);
    await openEditor(); await page.getByRole("button", { name: "创建独立场景副本", exact: true }).click();
    await expect(page.getByLabel("场景名称", { exact: true })).toHaveValue("共享工厂场景 副本");
    await number("实例位置 X", "8"); await page.getByRole("button", { name: "保存并返回", exact: true }).click();
    await expect(page.locator(".canvas-document-meta")).toContainText("已保存"); await page.reload();
    await expect(page.locator(".model-3d-edit-hint")).toBeVisible();
    current = (await (await api.get(`${path}/definition`)).json()).definition;
    expect(current.scenes).toHaveLength(2); expect(current.scenes.find((scene: { id: string }) => scene.id === sharedId).instances[0].transform.position[0]).toBe(-8);
    expect(current.scenes.find((scene: { id: string }) => scene.id !== sharedId).instances[0].transform.position[0]).toBe(8);
  } finally { await api.delete(path); await api.dispose(); }
});
