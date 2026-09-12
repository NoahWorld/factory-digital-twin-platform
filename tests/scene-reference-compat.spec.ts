import { test, expect } from "@playwright/test";
import { createDemo, localApi } from "./demo";
import { login } from "./support";
import { createMockGltf } from "../scripts/mock-model.mjs";
import { DEFAULT_SCENE_SETTINGS, IDENTITY_TRANSFORM } from "../shared/scene-definition";
import { createEditorState, executeEditorOperation } from "../shared/editor-operations";
import { projectDefinitionPatch } from "../shared/project-definition";

test("objects outside the model default scene cannot become live scene bindings", async () => {
  const api = await localApi(); const demo = await createDemo(api, true); const path = `/api/v1/projects/${demo.projectId}`;
  try {
    const source = JSON.parse(createMockGltf([{ mesh: 0, name: "Visible" }, { mesh: 0, name: "OtherScene" }]));
    source.scenes = [{ nodes: [0] }, { nodes: [1] }];
    const uploaded = await api.post(`${path}/model-assets?filename=two-source-scenes.gltf`, { data: JSON.stringify(source), headers: { "content-type": "model/gltf+json" } });
    expect(uploaded.status(), await uploaded.text()).toBe(201); const model = (await uploaded.json()).modelAsset;
    expect(model.inspection.objects.map((object: { inDefaultScene: boolean }) => object.inDefaultScene)).toEqual([true, false]);
    const instance = { id: "instance", name: "Device", modelAssetId: model.id, transform: IDENTITY_TRANSFORM, visible: true, appearance: null, objectTransforms: {}, objectAppearances: {} };
    const before = (await (await api.get(`${path}/definition`)).json()).definition;
    let state = createEditorState(before);
    state = executeEditorOperation(state, { type: "scene.extract", nodeId: "demo-model", scene: { id: "scene", name: "Scene", settings: DEFAULT_SCENE_SETTINGS, instances: [instance], assetBindings: [
      { id: "binding", assetId: "DEVICE-001", instanceId: instance.id, objectId: model.inspection.objects[1].objectId },
    ] } });
    const response = await api.patch(`${path}/definition`, { data: projectDefinitionPatch(state.project, state.savedProject) });
    expect(response.status(), await response.text()).toBe(400);
    expect((await response.json()).error).toBe("invalid_scene_object");
    expect((await (await api.get(`${path}/definition`)).json()).definition).toEqual(before);
  } finally { await api.delete(path); await api.dispose(); }
});

test("v2 conflict drafts acquire stable queue IDs and can be restored then dismissed", async ({ page }) => {
  const api = await localApi(); const demo = await createDemo(api); const path = `/api/v1/projects/${demo.projectId}`;
  try {
    await login(page); await page.goto(`/#/projects/${demo.projectId}/canvas`);
    await page.getByLabel("页面名称", { exact: true }).fill("旧版草稿内容"); await page.getByLabel("页面名称", { exact: true }).press("Enter");
    const before = (await (await api.get(`${path}/definition`)).json()).definition;
    const state = executeEditorOperation(createEditorState(before), { type: "page.rename", pageId: "main", name: "服务器新内容" });
    expect((await api.patch(`${path}/definition`, { data: projectDefinitionPatch(state.project, state.savedProject) })).status()).toBe(200);
    await page.reload(); await expect(page.getByRole("button", { name: "恢复草稿到编辑器", exact: true })).toBeVisible();
    await page.evaluate((projectId) => {
      const key = Object.keys(localStorage).find((key) => key.startsWith("newpower:draft:") && key.endsWith(`${projectId}:conflicts`))!;
      const drafts = JSON.parse(localStorage.getItem(key)!);
      for (const draft of drafts) { delete draft.id; delete draft.content.scenes; draft.schemaVersion = 2; }
      localStorage.setItem(key, JSON.stringify(drafts));
    }, demo.projectId);
    await page.reload(); await page.getByRole("button", { name: "恢复草稿到编辑器", exact: true }).click();
    await expect(page.getByLabel("页面名称", { exact: true })).toHaveValue("旧版草稿内容");
    await page.reload(); await expect(page.getByLabel("页面名称", { exact: true })).toHaveValue("旧版草稿内容");
    await expect(page.getByRole("button", { name: "恢复草稿到编辑器", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "使用服务器内容", exact: true }).click();
    await page.reload(); await expect(page.getByLabel("页面名称", { exact: true })).toHaveValue("服务器新内容");
  } finally { await api.delete(path); await api.dispose(); }
});
