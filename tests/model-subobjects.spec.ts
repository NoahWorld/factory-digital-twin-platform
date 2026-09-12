import { test, expect } from "@playwright/test";
import { createDemo, localApi } from "./demo";
import { login } from "./support";
import { createMultiPrimitiveGltf } from "../scripts/mock-model.mjs";
import { createCanvasNode } from "../apps/web/src/canvas/types";
import { modelEditorRoutePath } from "../apps/web/src/canvas/routes";

test("legacy primitive overrides and asset mappings survive conversion and reordered model versions", async ({ page }, testInfo) => {
  const api = await localApi(); const demo = await createDemo(api); const path = `/api/v1/projects/${demo.projectId}`;
  try {
    const uploaded = await api.post(`${path}/model-assets?filename=multi-material.gltf`, { data: createMultiPrimitiveGltf(), headers: { "content-type": "model/gltf+json" } });
    expect(uploaded.status(), await uploaded.text()).toBe(201); const model = (await uploaded.json()).modelAsset;
    expect(model.inspection.objectManifestVersion).toBe(2); expect(model.inspection.objects).toHaveLength(3);
    const partA = model.inspection.objects.find((object: { primitiveSourceId: string }) => object.primitiveSourceId === "part-a");
    const partB = model.inspection.objects.find((object: { primitiveSourceId: string }) => object.primitiveSourceId === "part-b");
    const canvasNode = { ...createCanvasNode("model-3d", 80, 100, 3), id: "primitive-model", resourceRefs: [model.id] };
    expect((await api.patch(`${path}/canvas`, { data: { expectedRevision: demo.canvas.revision, upsertNodes: [canvasNode], deleteNodeIds: [] } })).status()).toBe(200);
    await login(page); await page.goto(`/${modelEditorRoutePath(demo.projectId, "primitive-model")}`);
    await page.getByLabel("搜索模型节点", { exact: true }).fill("MachineMesh");
    const rows = page.locator(".model-scene-tree-select").filter({ hasText: "MachineMesh" });
    await expect(rows).toHaveCount(2);
    const names = await rows.locator("span:nth-child(2)").allTextContents();
    await rows.first().click(); await page.getByLabel("材质颜色", { exact: true }).fill("#cc3366");
    expect((await api.patch(`${path}/assets/${demo.assets[0].id}`, { data: { modelNode: names[0] } })).status()).toBe(200);
    expect((await api.patch(`${path}/assets/${demo.assets[1].id}`, { data: { modelNode: names[1] } })).status()).toBe(200);
    await page.getByRole("button", { name: "创建可复用场景", exact: true }).click();
    await expect(page.getByRole("heading", { name: "场景与实例", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.locator(".canvas-document-meta")).toContainText("已同步到画布");
    const original = (await (await api.get(`${path}/definition`)).json()).definition;
    expect(original.scenes[0].instances[0].objectAppearances[partA.objectId].color).toBe("#cc3366");
    expect(original.scenes[0].assetBindings.find((binding: { assetId: string }) => binding.assetId === "DEVICE-001").objectId).toBe(partA.objectId);
    await page.getByRole("button", { name: "模型版本与替换", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "模型版本与映射修复", exact: true }); await expect(dialog).toBeVisible();
    await dialog.locator('input[type="file"]').setInputFiles({ name: "reordered.gltf", mimeType: "model/gltf+json", buffer: Buffer.from(createMultiPrimitiveGltf(true)) });
    await expect(dialog.locator(".model-reference-list")).toContainText("稳定标识保留");
    await dialog.getByRole("button", { name: "应用替换与修复", exact: true }).click(); await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "保存", exact: true }).click(); await expect(page.locator(".canvas-document-meta")).toContainText("已同步到画布");
    const current = (await (await api.get(`${path}/definition`)).json()).definition;
    const instance = current.scenes[0].instances[0]; expect(instance.modelAssetId).not.toBe(model.id);
    const replacement = (await (await api.get(`${path}/model-assets/${instance.modelAssetId}`)).json()).modelAsset;
    expect(replacement.inspection.objects.find((object: { objectId: string }) => object.objectId === partA.objectId).primitiveIndex).toBe(1);
    expect(replacement.inspection.objects.find((object: { objectId: string }) => object.objectId === partB.objectId).primitiveIndex).toBe(0);
    await expect(page.locator(".model-3d-edit-hint")).toBeVisible();
    const appearance = await page.evaluate(async ({ instanceId, objectId }) => {
      const url = performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => name.includes("/src/canvas/scene-viewport-runtime.ts")).at(-1)!;
      const runtime = await import(/* @vite-ignore */ url); const viewport = runtime.sceneViewportDiagnostics()[0];
      return runtime.inspectSceneViewportObject(viewport.id, { instanceId, objectId });
    }, { instanceId: instance.id, objectId: partA.objectId });
    expect(appearance.name).toBe(names[1]); expect(appearance.colors).toEqual(["#cc3366"]); expect(appearance.center[0]).toBeCloseTo(0, 6);
    await page.screenshot({ path: testInfo.outputPath("primitive-identity-after-reorder.png") });
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await page.getByRole("button", { name: "保存", exact: true }).click(); await expect(page.locator(".canvas-document-meta")).toContainText("已同步到画布");
    expect((await (await api.get(`${path}/definition`)).json()).definition.scenes[0].instances[0].modelAssetId).toBe(model.id);
  } finally { await api.delete(path); await api.dispose(); }
});
