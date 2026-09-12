import { test, expect } from "@playwright/test";
import { createDemo, localApi } from "./demo";
import { login, control } from "./support";
import { createMockGltf } from "../scripts/mock-model.mjs";
import { createEditorState, executeEditorOperation } from "../shared/editor-operations";
import { projectDefinitionPatch } from "../shared/project-definition";
import { DEFAULT_SCENE_SETTINGS, IDENTITY_TRANSFORM, type SceneDefinition } from "../shared/scene-definition";

async function diagnostics(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const url = performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => name.includes("/src/canvas/scene-viewport-runtime.ts")).at(-1);
    return url ? (await import(/* @vite-ignore */ url)).sceneViewportDiagnostics() : [];
  });
}

test("same-name model instances bind different assets and share bidirectional runtime selection", async ({ page }, testInfo) => {
  const api = await localApi(); const demo = await createDemo(api, true); const path = `/api/v1/projects/${demo.projectId}`;
  try {
    const upload = await api.post(`${path}/model-assets?filename=shared-pump.gltf`, { data: createMockGltf([{ mesh: 0, name: "SharedPump" }]), headers: { "content-type": "model/gltf+json" } });
    expect(upload.status(), await upload.text()).toBe(201); const model = (await upload.json()).modelAsset;
    const objectId = model.inspection.objects[0].objectId;
    const scene: SceneDefinition = { id: "shared-scene", name: "同名设备实例（模拟）", settings: { ...DEFAULT_SCENE_SETTINGS, cameraView: "front" }, instances: [
      { id: "pump-one", name: "设备一", modelAssetId: model.id, transform: { ...structuredClone(IDENTITY_TRANSFORM), position: [-2,0,0] }, visible: true, appearance: null, objectTransforms: {}, objectAppearances: {} },
      { id: "pump-two", name: "设备二", modelAssetId: model.id, transform: { ...structuredClone(IDENTITY_TRANSFORM), position: [2,0,0] }, visible: true, appearance: null, objectTransforms: {}, objectAppearances: {} },
    ], assetBindings: [
      { id: "bind-one", assetId: "DEVICE-001", instanceId: "pump-one", objectId },
      { id: "bind-two", assetId: "DEVICE-002", instanceId: "pump-two", objectId },
    ] };
    let state = createEditorState((await (await api.get(`${path}/definition`)).json()).definition);
    state = executeEditorOperation(state, { type: "scene.extract", nodeId: "demo-model", scene });
    const saved = await api.patch(`${path}/definition`, { data: projectDefinitionPatch(state.project, state.savedProject) });
    expect(saved.status(), await saved.text()).toBe(200);
    await login(page);
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/model-assets/*/content", async (route) => { await gate; await route.continue(); });
    await page.goto(`/#/projects/${demo.projectId}/preview`);
    await page.getByRole("button", { name: "选择设备 DEVICE-002", exact: true }).click(); release();
    await expect(page.locator(".model-3d-renderer")).toHaveAttribute("data-selected-instance", "pump-two");
    await expect.poll(async () => (await diagnostics(page))[0]?.selectedCount).toBe(1);
    const canvas = page.locator(".model-3d-renderer canvas"); const size = await canvas.boundingBox();
    await canvas.click({ position: { x: size!.width * .3, y: size!.height * .5 } });
    await expect(page.getByLabel("当前设备", { exact: true })).toHaveValue("DEVICE-001");
    await expect(page.locator('[data-node-id="selected-metric"] .dashboard-metric-value')).toContainText(/4\d/);
    await control(page, "/control/state", { status: "alarm" });
    await expect.poll(async () => (await diagnostics(page))[0]?.instanceStates.find((instance: { instanceId: string }) => instance.instanceId === "pump-one")?.materialColors).toContain("#ff4d5f");
    expect((await diagnostics(page))[0].instanceStates.find((instance: { instanceId: string }) => instance.instanceId === "pump-two").materialColors).not.toContain("#ff4d5f");
    await page.screenshot({ path: testInfo.outputPath("independent-instance-data-states.png") });
    await control(page, "/control/state", { status: "running" });
    await expect.poll(async () => (await diagnostics(page))[0]?.instanceStates.find((instance: { instanceId: string }) => instance.instanceId === "pump-one")?.materialColors).not.toContain("#ff4d5f");
    const current = (await (await api.get(`${path}/definition`)).json()).definition;
    scene.assetBindings[1].assetId = "DEVICE-001";
    const changed = await api.patch(`${path}/definition`, { data: { expectedRevision: current.revision, upsertPages: [], deletePageIds: [], upsertNodes: [], deleteNodeIds: [], upsertScenes: [scene] } });
    expect(changed.status()).toBe(200); await page.reload();
    await page.getByRole("button", { name: "选择设备 DEVICE-001", exact: true }).click();
    await expect.poll(async () => (await diagnostics(page))[0]?.selectedCount).toBe(2);
  } finally { await control(page, "/control/state", { status: "running" }); await api.delete(path); await api.dispose(); }
});
