import { test, expect } from "@playwright/test";
import { createDemo,localApi } from "./demo";
import { login } from "./support";
import { createEditorState,executeEditorOperation } from "../shared/editor-operations";
import { projectDefinitionPatch } from "../shared/project-definition";
import { createCanvasNode } from "../apps/web/src/canvas/types";
import { DEFAULT_SCENE_SETTINGS,IDENTITY_TRANSFORM } from "../shared/scene-definition";

test("a stop action cancels a play request even before the viewport module is available", async ({ page }) => {
  const api = await localApi(); const demo = await createDemo(api,true); const path = `/api/v1/projects/${demo.projectId}`;
  let release!: () => void;
  try {
    const model = (await (await api.get(`${path}/model-assets`)).json()).modelAssets[0];
    let state = createEditorState((await (await api.get(`${path}/definition`)).json()).definition);
    state = executeEditorOperation(state,{ type: "scene.extract",nodeId: "demo-model",scene: { id: "scene",name: "Slow viewport",settings: DEFAULT_SCENE_SETTINGS,assetBindings: [],instances: [{ id: "instance",name: "Device",modelAssetId: model.id,transform: IDENTITY_TRANSFORM,visible: true,appearance: null,objectTransforms: {},objectAppearances: {} }],motions: [{ id: "path",name: "Path",version: 1,durationMs: 200,repeat: 1,fill: "hold",tracks: [{ id: "position",type: "object",target: { instanceId: "instance",objectId: null },property: "position",easing: "linear",keyframes: [{ timeMs: 0,value: [0,0,0] },{ timeMs: 200,value: [0,2,0] }] }] }] } });
    const button = { ...createCanvasNode("button",120,870,3),id: "stop" }; button.width = 400; button.props = { ...button.props,text: "停止待加载动画",href: "" };
    state = executeEditorOperation(state,{ type: "nodes.upsert",nodes: [button] });
    state = executeEditorOperation(state,{ type: "interactions.set",interactions: { states: [{ id: "result",name: "播放结果",pageId: null,valueType: "string",initial: "未播放" }],rules: [
      { id: "play",name: "自动播放",pageId: "main",enabled: true,reentry: "restart",trigger: { type: "page.enter" },condition: null,actions: [{ type: "motion.play",nodeId: "demo-model",motionId: "path" },{ type: "state.set",stateId: "result",value: { kind: "literal",value: "不应完成" } }] },
      { id: "stop",name: "停止",pageId: "main",enabled: true,reentry: "restart",trigger: { type: "node.click",sourceId: "stop" },condition: null,actions: [{ type: "motion.stop",nodeId: "demo-model",motionId: "path" }] },
    ] } });
    const saved = await api.patch(`${path}/definition`,{ data: projectDefinitionPatch(state.project,state.savedProject) }); expect(saved.status(),await saved.text()).toBe(200);
    await login(page); const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/scene-viewport-runtime.ts*",async (route) => { await gate; await route.continue(); });
    await page.goto(`/#/projects/${demo.projectId}/preview`);
    await page.getByRole("button",{ name: "交互调试",exact: true }).click();
    const debug = page.getByRole("complementary",{ name: "交互调试",exact: true });
    await expect(debug).toContainText("执行中 1");
    await debug.getByRole("button",{ name: "关闭调试",exact: true }).click();
    await page.getByRole("button",{ name: "停止待加载动画",exact: true }).click(); release();
    await expect(page.locator(".model-3d-edit-hint")).toBeVisible();
    await page.getByRole("button",{ name: "交互调试",exact: true }).click();
    await expect(debug).toContainText("执行中 0"); await expect(debug.locator("dd")).toHaveText('"未播放"');
    await expect(debug.locator(".is-cancelled")).not.toHaveCount(0);
    await page.waitForTimeout(350); // An accidentally resumed 200 ms motion would now have completed.
    await expect(debug.locator("dd")).toHaveText('"未播放"');
    const position = await page.evaluate(async () => { const url = performance.getEntriesByType("resource").map((entry) => entry.name).filter((url) => url.includes("/scene-viewport-runtime.ts")).at(-1)!; return (await import(/* @vite-ignore */ url)).sceneViewportDiagnostics()[0].instanceStates[0].position; });
    expect(position).toEqual([0,0,0]);
  } finally { release?.(); await api.delete(path); await api.dispose(); }
});

test("motion host deadline includes loading and a full 60 second timeline", async ({ page }) => {
  await login(page);
  const moduleResponse = await page.request.get("/src/interaction-session.tsx");
  const moduleUrl = (await moduleResponse.text()).match(/"([^"\n]*\/shared\/interaction-runtime\.ts[^"\n]*)"/)?.[1];
  expect(moduleUrl).toBeTruthy();
  await page.clock.install();
  await page.evaluate(async (url) => {
    const { InteractionRuntime } = await import(/* @vite-ignore */ url);
    const runtime = new InteractionRuntime({ states: [],rules: [{ id: "long",name: "Long motion",pageId: "main",enabled: true,reentry: "restart",condition: null,trigger: { type: "page.enter" },actions: [{ type: "motion.play",nodeId: "viewport",motionId: "long" }] }] },{ metric: () => undefined,perform: () => new Promise<void>((resolve) => setTimeout(resolve,65000)) });
    (window as any).__deadlineRuntime = runtime; runtime.setPage("main");
  },moduleUrl!);
  try {
    await page.clock.runFor(60001);
    expect(await page.evaluate(() => (window as any).__deadlineRuntime.getSnapshot().active)).toBe(1);
    await page.clock.runFor(5000);
    const result = await page.evaluate(() => (window as any).__deadlineRuntime.getSnapshot());
    expect(result.active).toBe(0); expect(result.traces.some((trace: { status: string }) => trace.status === "failed")).toBe(false);
  } finally { await page.evaluate(() => { (window as any).__deadlineRuntime?.dispose(); delete (window as any).__deadlineRuntime; }); }
});
