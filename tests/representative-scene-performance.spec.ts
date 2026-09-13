import { test,expect,request as apiRequest } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { nodeRuntimeFixture } from "./node-runtime-fixture";
import { representativeModel } from "./representative-model";
import { createCanvasNode } from "../apps/web/src/canvas/types";
import { createEditorState,executeEditorOperation } from "../shared/editor-operations";
import { projectDefinitionPatch } from "../shared/project-definition";
import { DEFAULT_SCENE_SETTINGS,IDENTITY_TRANSFORM,type SceneDefinition } from "../shared/scene-definition";
import type { ScenePerformanceSnapshot } from "../apps/web/src/canvas/scene-viewport-runtime";

test("representative fixed scenes measure 100k and 1m submitted triangles across 1, 10 and 100 instances",async ({ browser },testInfo) => {
  test.setTimeout(240000);const runtime = await nodeRuntimeFixture(testInfo),api = await apiRequest.newContext({ baseURL:runtime.url }),results:unknown[] = [];
  try {
    expect((await api.post("/api/v1/auth/bootstrap",{ headers:{ "x-bootstrap-token":runtime.bootstrap },data:{ email:"representative-scenes@example.invalid",password:randomBytes(24).toString("hex"),displayName:"Representative scenes" } })).status()).toBe(201);const identity = await api.storageState();
    for (const targetTriangles of [100000,1000000]) for (const count of [1,10,100]) {
      const model = representativeModel(targetTriangles/count),created = await api.post("/api/v1/projects",{ data:{ name:`M7 ${targetTriangles}面 ${count}实例（生成模型）` } });expect(created.status()).toBe(201);const projectId = (await created.json()).project.id,base = `/api/v1/projects/${projectId}`;
      const uploadStarted = performance.now(),upload = await api.post(`${base}/model-assets?filename=representative-${targetTriangles}-${count}.glb`,{ data:model.bytes,headers:{ "content-type":"model/gltf-binary" } });expect(upload.status(),await upload.text()).toBe(201);const asset = (await upload.json()).modelAsset,uploadMs = performance.now()-uploadStarted;
      expect(asset.inspection.triangleCount).toBe(model.triangles);await writeFile(testInfo.outputPath(`representative-${targetTriangles}-${count}.glb`),model.bytes);
      const columns = Math.ceil(Math.sqrt(count)),scene:SceneDefinition = { id:"representative-scene",name:"可见曲面网格",settings:{ ...DEFAULT_SCENE_SETTINGS,autoRotate:true,showGrid:false },assetBindings:[],instances:Array.from({ length:count },(_,index) => ({ id:`instance-${index}`,name:`曲面 ${index+1}`,modelAssetId:asset.id,transform:{ ...structuredClone(IDENTITY_TRANSFORM),position:[(index%columns)*1.4,0,Math.floor(index/columns)*1.4] },visible:true,appearance:null,objectTransforms:{},objectAppearances:{} })) };
      const node = { ...createCanvasNode("model-3d",40,40,1),id:"representative-model",width:1840,height:1000,resourceRefs:[asset.id] };let state = createEditorState((await (await api.get(`${base}/definition`)).json()).definition);state = executeEditorOperation(state,{ type:"nodes.upsert",nodes:[node] });state = executeEditorOperation(state,{ type:"scene.extract",nodeId:node.id,scene });
      const saved = await api.patch(`${base}/definition`,{ data:projectDefinitionPatch(state.project,state.savedProject) });expect(saved.status(),await saved.text()).toBe(200);const draft = (await (await api.get(`${base}/publication-draft`)).json()).draft,versionResponse = await api.post(`${base}/versions`,{ data:{ expectedRuntimeRevision:draft.runtimeRevision,label:"Representative baseline" } });expect(versionResponse.status(),await versionResponse.text()).toBe(201);const version = (await versionResponse.json()).version;
      const activated = await api.post(`${base}/versions/${version.id}/activate`,{ data:{ expectedPublicationRevision:0 } });expect(activated.status(),await activated.text()).toBe(200);
      const context = await browser.newContext({ storageState:identity,viewport:{ width:1440,height:1000 } }),page = await context.newPage(),requests:string[] = [];page.on("request",(request) => { if (request.url().includes(`/model-assets/${asset.id}`)) requests.push(request.url()); });
      try {
        const samples = [];
        for (const cache of ["fresh-context","reload-cache"] as const) {
          requests.length = 0;const started = performance.now();if (cache === "fresh-context") await page.goto(`${runtime.url}/#/projects/${projectId}/versions/${version.id}/run`);else await page.reload();
          await expect(page.locator(".model-3d-edit-hint")).toBeVisible();const loadedMs = performance.now()-started;await page.getByRole("button",{ name:"场景性能",exact:true }).click();const panel = page.getByRole("dialog",{ name:"场景性能",exact:true }),row = panel.locator("[data-renderer-diagnostics]");
          const read = async ():Promise<ScenePerformanceSnapshot> => { await panel.getByRole("button",{ name:"刷新统计",exact:true }).click();return JSON.parse((await row.getAttribute("data-renderer-diagnostics"))!); };
          await expect(row).toHaveCount(1);await expect.poll(async () => (await read()).ready).toBe(true);const before = await read();
          await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve,4000)));const after = await read();
          const device = await page.evaluate(() => { const canvas = document.querySelector<HTMLCanvasElement>(".model-3d-renderer canvas")!,gl = canvas.getContext("webgl2")!,extension = gl.getExtension("WEBGL_debug_renderer_info");return { renderer:extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):"unavailable",userAgent:navigator.userAgent,heap:(performance as Performance & { memory?:{ usedJSHeapSize:number;totalJSHeapSize:number } }).memory ? { used:(performance as any).memory.usedJSHeapSize,total:(performance as any).memory.totalJSHeapSize }:null,resources:performance.getEntriesByType("resource").filter((entry) => entry.name.includes("/model-assets/")).map((entry) => ({ path:new URL(entry.name).pathname,transferSize:(entry as PerformanceResourceTiming).transferSize,decodedBodySize:(entry as PerformanceResourceTiming).decodedBodySize })) }; });
          const result = { cache,loadedMs,firstSubmittedFrameMs:after.firstFrameAt,renderedFrames:after.frame-before.frame,statistics:after,requests:requests.length,...device };samples.push(result);
          expect(after.instances).toBe(count);expect(after.triangles).toBe(count*model.triangles);expect(after.minTriangles).toBe(count*model.triangles);expect(after.maxTriangles).toBe(count*model.triangles);expect(after.ownedResources.geometries).toBe(1);expect(after.manifests.loads).toBe(1);expect(requests).toHaveLength(2);expect(after.samples).toBeGreaterThanOrEqual(110);expect.soft(after.p95FrameMs,`${targetTriangles} triangles / ${count} instances / ${cache}`).toBeLessThanOrEqual(1000/30+.1);
          await page.screenshot({ path:testInfo.outputPath(`performance-${targetTriangles}-${count}-${cache}.png`) });
          await panel.getByRole("button",{ name:"关闭场景性能",exact:true }).click();await page.screenshot({ path:testInfo.outputPath(`scene-${targetTriangles}-${count}-${cache}.png`) });
        }
        const result = { benchmark:"M7-representative-scene",targetTriangles,instances:count,trianglesPerResource:model.triangles,totalTriangles:count*model.triangles,vertices:model.vertices,modelBytes:model.bytes.length,modelSha256:asset.sha256,materials:model.materials,textures:model.textures,uploadAndInspectMs:uploadMs,projectId,versionId:version.id,samples };results.push(result);console.log(JSON.stringify(result));await writeFile(testInfo.outputPath("representative-results.json"),JSON.stringify(results,null,2)+"\n");
      } finally { await context.close();await api.delete(base); }
    }
  } finally { await api.dispose();await runtime.dispose(); }
});
