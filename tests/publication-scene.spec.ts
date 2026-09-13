import { test,expect,request as apiRequest } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { nodeRuntimeFixture } from "./node-runtime-fixture";
import { createDemo } from "./demo";
import { createAnimatedMockGltf } from "../scripts/mock-model.mjs";
import { createEditorState,executeEditorOperation } from "../shared/editor-operations";
import { projectDefinitionPatch } from "../shared/project-definition";
import { createCanvasNode } from "../apps/web/src/canvas/types";
import { DEFAULT_SCENE_SETTINGS,IDENTITY_TRANSFORM } from "../shared/scene-definition";

test("a frozen reusable scene executes native animation and page navigation with its own model report and interaction definition",async ({ browser },testInfo) => {
  const runtime = await nodeRuntimeFixture(testInfo),api = await apiRequest.newContext({ baseURL:runtime.url }); let context:Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    expect((await api.post("/api/v1/auth/bootstrap",{ headers:{ "x-bootstrap-token":runtime.bootstrap },data:{ email:"scene-release@example.invalid",password:randomBytes(24).toString("hex"),displayName:"Scene publisher" } })).status()).toBe(201);
    const demo = await createDemo(api,true),path = `/api/v1/projects/${demo.projectId}`;
    const uploaded = await api.post(`${path}/model-assets?filename=animated.gltf`,{ data:createAnimatedMockGltf(),headers:{ "content-type":"model/gltf+json" } }); expect(uploaded.status()).toBe(201); const model = (await uploaded.json()).modelAsset;
    let state = createEditorState((await (await api.get(`${path}/definition`)).json()).definition);
    state = executeEditorOperation(state,{ type:"scene.extract",nodeId:"demo-model",scene:{ id:"scene",name:"Published animated scene",settings:DEFAULT_SCENE_SETTINGS,assetBindings:[],instances:[{ id:"device",name:"Animated device",modelAssetId:model.id,transform:IDENTITY_TRANSFORM,visible:true,appearance:null,objectTransforms:{},objectAppearances:{} }],motions:[{ id:"motion",name:"Native clip",version:1,durationMs:500,repeat:1,fill:"hold",tracks:[{ id:"clip",type:"clip",property:"clip",target:{ instanceId:"device",objectId:null },clipId:model.inspection.clips[0].clipId,easing:"linear",keyframes:[{ timeMs:0,value:0 },{ timeMs:500,value:1 }] }] }] } });
    const button = { ...createCanvasNode("button",100,880,4),id:"play",width:350 }; button.props = { ...button.props,text:"播放冻结的动画",href:"" };
    state = executeEditorOperation(state,{ type:"nodes.upsert",nodes:[button] });
    state = executeEditorOperation(state,{ type:"page.add",name:"版本内详情" }); const otherPage = state.pageId;
    state = executeEditorOperation(state,{ type:"interactions.set",interactions:{ states:[{ id:"result",name:"动画结果",pageId:null,valueType:"string",initial:"未执行" }],rules:[{ id:"play-rule",name:"动画完成后翻页",pageId:"main",enabled:true,reentry:"restart",trigger:{ type:"node.click",sourceId:"play" },condition:null,actions:[{ type:"motion.play",nodeId:"demo-model",motionId:"motion" },{ type:"state.set",stateId:"result",value:{ kind:"literal",value:"已按冻结配置完成" } },{ type:"page.navigate",pageId:otherPage }] }] } });
    const saved = await api.patch(`${path}/definition`,{ data:projectDefinitionPatch(state.project,state.savedProject) }); expect(saved.status(),await saved.text()).toBe(200);
    const draftResponse = await api.get(`${path}/publication-draft`); expect(draftResponse.status(),await draftResponse.text()).toBe(200); const draft = (await draftResponse.json()).draft;
    const created = await api.post(`${path}/versions`,{ data:{ expectedRuntimeRevision:draft.runtimeRevision,label:"Animated fixed version" } }); expect(created.status(),await created.text()).toBe(201); const version = (await created.json()).version;
    let changed = createEditorState((await saved.json()).definition); changed = executeEditorOperation(changed,{ type:"interactions.set",interactions:{ states:[],rules:[] } }); expect((await api.patch(`${path}/definition`,{ data:projectDefinitionPatch(changed.project,changed.savedProject) })).status()).toBe(200);
    context = await browser.newContext({ storageState:await api.storageState() }); const page = await context.newPage(),requests:string[] = []; page.on("request",(request) => requests.push(new URL(request.url()).pathname));
    await page.goto(`${runtime.url}/#/projects/${demo.projectId}/versions/${version.id}/run?page=main`); await expect(page.locator(".model-3d-edit-hint")).toBeVisible();
    expect(requests).toContain(`${path}/versions/${version.id}/model-assets/${model.id}`); expect(requests).not.toContain(`${path}/model-assets/${model.id}`);
    await page.getByRole("button",{ name:"播放冻结的动画",exact:true }).click(); await expect(page).toHaveURL(new RegExp(`/versions/${version.id}/run\\?page=${otherPage}`));
    await page.getByRole("button",{ name:"交互调试",exact:true }).click(); const debug = page.getByRole("complementary",{ name:"交互调试",exact:true }); await expect(debug).toContainText("已按冻结配置完成"); await expect(debug).toContainText("motion.play"); await expect(debug).toContainText("执行中 0");
    await page.screenshot({ path:testInfo.outputPath("frozen-native-animation-and-navigation.png") });
  } finally { await context?.close(); await api.dispose(); await runtime.dispose(); }
});
