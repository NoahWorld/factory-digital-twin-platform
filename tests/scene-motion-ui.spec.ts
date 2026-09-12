import { test, expect } from "@playwright/test";
import { createDemo, localApi } from "./demo";
import { login } from "./support";
import { createCanvasNode } from "../apps/web/src/canvas/types";
import { modelEditorRoutePath } from "../apps/web/src/canvas/routes";
import { createEditorState, executeEditorOperation } from "../shared/editor-operations";
import { projectDefinitionPatch } from "../shared/project-definition";
import { DEFAULT_SCENE_SETTINGS, IDENTITY_TRANSFORM } from "../shared/scene-definition";

async function motionStates(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const url = performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => name.includes("/src/canvas/scene-viewport-runtime.ts")).at(-1);
    return url ? (await import(/* @vite-ignore */ url)).sceneViewportDiagnostics() : [];
  });
}
test("author and preview object/camera keyframes, persist them and play through a saved sequential interaction", async ({ page },testInfo) => {
  const api = await localApi(); const demo = await createDemo(api,true); const path = `/api/v1/projects/${demo.projectId}`;
  try {
    const model = (await (await api.get(`${path}/model-assets`)).json()).modelAssets[0];
    let state = createEditorState((await (await api.get(`${path}/definition`)).json()).definition);
    state = executeEditorOperation(state,{ type: "scene.extract",nodeId: "demo-model",scene: { id: "motion-scene",name: "动画场景",settings: DEFAULT_SCENE_SETTINGS,instances: [{ id: "device",name: "演示设备",modelAssetId: model.id,transform: IDENTITY_TRANSFORM,visible: true,appearance: null,objectTransforms: {},objectAppearances: {} }],assetBindings: model.inspection.objects.map((object: { objectId: string },index: number) => ({ id: `binding-${index}`,instanceId: "device",objectId: object.objectId,assetId: `DEVICE-00${index+1}` })) } });
    const button = { ...createCanvasNode("button",120,870,3),id: "start-motion" }; button.width = 400; button.props = { ...button.props,text: "播放设备路径",href: "" };
    state = executeEditorOperation(state,{ type: "nodes.upsert",nodes: [button] });
    const result = await api.patch(`${path}/definition`,{ data: projectDefinitionPatch(state.project,state.savedProject) }); expect(result.status(),await result.text()).toBe(200);
    await login(page); await page.goto(`/${modelEditorRoutePath(demo.projectId,"demo-model")}`);
    await page.getByRole("button",{ name: "动画与路径",exact: true }).click();
    const dialog = page.getByRole("dialog",{ name: "场景动画与路径",exact: true });
    await dialog.getByRole("button",{ name: "添加动画",exact: true }).click();
    await dialog.getByLabel("动画名称",{ exact: true }).fill("设备抬升与镜头路径");
    await dialog.getByLabel("动画时长",{ exact: true }).fill("1000"); await dialog.getByLabel("动画时长",{ exact: true }).press("Enter");
    await dialog.getByLabel("动画结束方式",{ exact: true }).selectOption("hold");
    await dialog.getByRole("button",{ name: "添加镜头轨道",exact: true }).click();
    await dialog.getByRole("button",{ name: "播放动画",exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText("播放完成，保持末帧");
    await expect.poll(async () => (await motionStates(page)).some((state: { instanceStates: Array<{ position: number[] }> }) => state.instanceStates[0]?.position[1] === 2)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("scene-motion-editor.png") });
    await dialog.getByRole("button",{ name: "停止并恢复",exact: true }).click();
    await expect.poll(async () => (await motionStates(page)).every((state: { instanceStates: Array<{ position: number[] }> }) => state.instanceStates[0]?.position[1] === 0)).toBe(true);
    await dialog.getByRole("button",{ name: "应用场景动画",exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button",{ name: "保存并返回",exact: true }).click();
    await page.getByRole("button",{ name: "交互编排",exact: true }).click();
    const editor = page.getByRole("dialog",{ name: "交互编排",exact: true });
    await editor.getByRole("button",{ name: "添加规则",exact: true }).click();
    await editor.getByLabel("规则名称",{ exact: true }).fill("路径完成后选择设备");
    await editor.getByLabel("事件来源",{ exact: true }).selectOption("start-motion");
    await editor.getByRole("button",{ name: "添加动作",exact: true }).click();
    await editor.getByLabel("动作 1 类型",{ exact: true }).selectOption("motion.play");
    await editor.getByRole("button",{ name: "添加动作",exact: true }).click();
    await editor.getByLabel("选择目标设备",{ exact: true }).selectOption("DEVICE-002");
    await editor.getByRole("button",{ name: "应用交互配置",exact: true }).click();
    await page.getByRole("button",{ name: "保存画布",exact: true }).click();
    await expect(page.locator(".canvas-document-meta")).toContainText("已保存");
    const saved = (await (await api.get(`${path}/definition`)).json()).definition;
    expect(saved.scenes[0].motions[0].tracks).toHaveLength(2); expect(saved.interactions.rules[0].actions[0].motionId).toBe(saved.scenes[0].motions[0].id);
    await page.reload(); await page.getByRole("button",{ name: "预览",exact: true }).click();
    await expect(page.locator(".runtime-status-banner")).toContainText("在线 2 台");
    await page.getByRole("button",{ name: "播放设备路径",exact: true }).click();
    await expect(page.getByLabel("当前设备",{ exact: true })).toHaveValue("");
    await expect(page.getByLabel("当前设备",{ exact: true })).toHaveValue("DEVICE-002");
    await expect.poll(async () => (await motionStates(page))[0]?.instanceStates[0].position[1]).toBe(2);
    await page.getByRole("button",{ name: "交互调试",exact: true }).click();
    await expect(page.getByRole("complementary",{ name: "交互调试",exact: true })).toContainText("motion.play");
    await page.screenshot({ path: testInfo.outputPath("scene-motion-interaction.png") });
    expect((await (await api.get(`${path}/definition`)).json()).definition).toEqual(saved);
  } finally { await api.delete(path); await api.dispose(); }
});
