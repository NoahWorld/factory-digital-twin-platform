import { test, expect } from "@playwright/test";
import { createDemo, localApi } from "./demo";
import { login } from "./support";
import { createMockGltf } from "../scripts/mock-model.mjs";

test("uploading a version leaves the scene unchanged until explicit repairs, and saved replacement can be undone", async ({ page }, testInfo) => {
  const api = await localApi(); const demo = await createDemo(api, true); const path = `/api/v1/projects/${demo.projectId}`;
  try {
    await login(page); await page.goto(`/#/projects/${demo.projectId}/canvas`);
    await page.locator('[data-node-id="demo-model"]').click(); await page.getByRole("button", { name: "进入 3D 编辑器", exact: true }).click();
    await expect(page.getByRole("button", { name: "创建可复用场景", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "创建可复用场景", exact: true }).click();
    await page.getByRole("button", { name: "复制实例", exact: true }).click();
    await page.getByRole("button", { name: "保存", exact: true }).click(); await expect(page.locator(".canvas-document-meta")).toContainText("已同步到画布");
    const before = (await (await api.get(`${path}/definition`)).json()).definition;
    const oldId = before.scenes[0].instances[0].modelAssetId;
    await page.getByRole("button", { name: "模型版本与替换", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "模型版本与映射修复", exact: true }); await expect(dialog).toBeVisible();
    const contentRequests: string[] = []; page.on("request", (request) => { if (request.url().includes("/model-assets/") && request.url().endsWith("/content")) contentRequests.push(request.url()); });
    await dialog.locator('input[type="file"]').setInputFiles({ name: "renamed-machine.gltf", mimeType: "model/gltf+json", buffer: Buffer.from(createMockGltf([
      { mesh: 0, name: "PumpRenamed", translation: [-1.6,0,0] }, { mesh: 0, name: "SensorRenamed", translation: [1.6,0,0] },
    ])) });
    await expect(dialog).toContainText("2 个对象仍需选择");
    await expect(dialog.getByRole("button", { name: "应用替换与修复", exact: true })).toBeDisabled();
    expect((await (await api.get(`${path}/definition`)).json()).definition).toEqual(before);
    const versions = (await (await api.get(`${path}/model-assets/${oldId}/versions`)).json()).modelAssets;
    expect(versions.map((model: { versionNumber: number }) => model.versionNumber)).toEqual([2,1]); const next = versions[0];
    await dialog.getByRole("button", { name: "取消", exact: true }).click(); await expect(dialog).toHaveCount(0);
    expect((await (await api.get(`${path}/definition`)).json()).definition).toEqual(before);
    contentRequests.length = 0;
    await page.getByRole("button", { name: "模型版本与替换", exact: true }).click(); await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("2 个对象仍需选择");
    await dialog.locator(".model-reference-list button").filter({ hasText: "DemoDevice001" }).click();
    await dialog.getByLabel("新对象映射", { exact: true }).selectOption(next.inspection.objects.find((object: { name: string }) => object.name === "PumpRenamed").objectId);
    await dialog.locator(".model-reference-list button").filter({ hasText: "DemoDevice002" }).click();
    await dialog.getByLabel("新对象映射", { exact: true }).selectOption(next.inspection.objects.find((object: { name: string }) => object.name === "SensorRenamed").objectId);
    await expect(dialog.locator(".model-3d-edit-hint")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("model-version-repair-preview.png") });
    await dialog.getByRole("button", { name: "应用替换与修复", exact: true }).click(); await expect(dialog).toHaveCount(0);
    await expect(page.locator(".model-3d-edit-hint")).toBeVisible();
    expect(contentRequests.filter((url) => url.includes(next.id))).toHaveLength(1);
    expect((await (await api.get(`${path}/definition`)).json()).definition).toEqual(before);
    await page.getByRole("button", { name: "保存", exact: true }).click(); await expect(page.locator(".canvas-document-meta")).toContainText("已同步到画布");
    const changed = (await (await api.get(`${path}/definition`)).json()).definition;
    expect(changed.scenes[0].instances[0].modelAssetId).toBe(next.id); expect(changed.scenes[0].instances[1].modelAssetId).toBe(oldId);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await page.getByRole("button", { name: "保存", exact: true }).click(); await expect(page.locator(".canvas-document-meta")).toContainText("已同步到画布");
    await page.reload(); await expect(page.locator(".model-3d-edit-hint")).toBeVisible();
    const restored = (await (await api.get(`${path}/definition`)).json()).definition;
    expect(restored.scenes).toEqual(before.scenes); expect((await api.get(`${path}/model-assets/${oldId}/content`)).status()).toBe(200);
  } finally { await api.delete(path); await api.dispose(); }
});
