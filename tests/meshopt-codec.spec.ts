import { test,expect,request as apiRequest } from "@playwright/test";
import { MeshoptDecoder } from "meshoptimizer/decoder";
import { randomBytes } from "node:crypto";
import { inspectMeshoptDocument } from "../shared/gltf-meshopt";
import { inspectModelDetails } from "../apps/api/src/model-inspection";
import { inspectLegacyModelNames } from "../apps/api/src/legacy-model-names";
import { nodeRuntimeFixture } from "./node-runtime-fixture";
import { localApi } from "./demo";
import { createCanvasNode } from "../apps/web/src/canvas/types";
import { createEditorState,executeEditorOperation } from "../shared/editor-operations";
import { projectDefinitionPatch } from "../shared/project-definition";
import { meshoptFixture,packGlb } from "./meshopt-fixture";

test("Meshopt layout and decoded allocations are checked before invoking a codec",async () => {
  const fixture = await meshoptFixture();expect(inspectMeshoptDocument(fixture.document,true)).toMatchObject({ codec:"meshopt",views:2,decodedBytes:168 });
  const invalids = [
    (value:any) => { value.bufferViews[0].extensions.EXT_meshopt_compression.count = 1000000000;value.bufferViews[0].byteLength = 12000000000;value.buffers[1].byteLength = 12000000000; },
    (value:any) => { value.bufferViews[0].extensions.EXT_meshopt_compression.byteStride = 3; },
    (value:any) => { value.bufferViews[1].extensions.EXT_meshopt_compression.filter = "OCTAHEDRAL"; },
    (value:any) => { value.bufferViews[0].extensions.EXT_meshopt_compression.byteOffset = value.buffers[0].byteLength; },
    (value:any) => { value.bufferViews[0].byteLength--; },
    (value:any) => { value.buffers[0].byteLength += 1000;value.bufferViews[0].extensions.EXT_meshopt_compression.byteOffset = fixture.binary.length+100; },
    (value:any) => { value.extensionsRequired = []; },
  ];
  let invoked = false;const decoder = { ...MeshoptDecoder,decodeGltfBuffer:() => { invoked = true;throw new Error("Decoder should not be invoked"); },decodeGltfBufferAsync:async () => { invoked = true;throw new Error("Decoder should not be invoked"); } };
  for (const change of invalids) { const value = structuredClone(fixture.document);change(value);await expect(inspectModelDetails(packGlb(value,fixture.binary),"glb","budget-fixture",{meshopt:decoder})).rejects.toThrow(); }
  const embedded = structuredClone(fixture.document);embedded.buffers[0].uri = `data:application/octet-stream;base64,${fixture.binary.toString("base64")}`;
  expect((await inspectModelDetails(new TextEncoder().encode(JSON.stringify(embedded)),"gltf","embedded",{meshopt:MeshoptDecoder})).triangleCount).toBe(12);
  expect(invoked).toBe(false);const report = await inspectModelDetails(fixture.bytes,"glb","fixture",{meshopt:MeshoptDecoder});expect(report.triangleCount).toBe(12);expect(report.compression?.decodedBytes).toBe(168);expect((await inspectLegacyModelNames(fixture.bytes,{meshopt:MeshoptDecoder})).names).toHaveProperty("MeshoptDevice");
});

test("Node inspects and renders a compressed model in a frozen version while Worker fails explicitly",async ({ browser },testInfo) => {
  const fixture = await meshoptFixture(),runtime = await nodeRuntimeFixture(testInfo),api = await apiRequest.newContext({ baseURL:runtime.url });let context:Awaited<ReturnType<typeof browser.newContext>>|undefined;
  try {
    expect((await api.post("/api/v1/auth/bootstrap",{ headers:{ "x-bootstrap-token":runtime.bootstrap },data:{ email:"meshopt@example.invalid",password:randomBytes(24).toString("hex"),displayName:"Meshopt fixture" } })).status()).toBe(201);const created = await api.post("/api/v1/projects",{ data:{ name:"Meshopt模型（模拟）" } });expect(created.status()).toBe(201);const id = (await created.json()).project.id,base = `/api/v1/projects/${id}`;
    const uploaded = await api.post(`${base}/model-assets?filename=meshopt.glb`,{ data:fixture.bytes,headers:{ "content-type":"model/gltf-binary" } });expect(uploaded.status(),await uploaded.text()).toBe(201);const model = (await uploaded.json()).modelAsset;expect(model.inspection.compression.codec).toBe("meshopt");
    const definition = (await (await api.get(`${base}/definition`)).json()).definition,node = { ...createCanvasNode("model-3d",100,100,1),id:"compressed-model",width:1500,height:800,resourceRefs:[model.id] },state = executeEditorOperation(createEditorState(definition),{type:"nodes.upsert",nodes:[node]});expect((await api.patch(`${base}/definition`,{data:projectDefinitionPatch(state.project,state.savedProject)})).status()).toBe(200);
    const draft = (await (await api.get(`${base}/publication-draft`)).json()).draft,freeze = await api.post(`${base}/versions`,{data:{expectedRuntimeRevision:draft.runtimeRevision,label:"Compressed model"}});expect(freeze.status(),await freeze.text()).toBe(201);const version = (await freeze.json()).version;const activation = await api.post(`${base}/versions/${version.id}/activate`,{data:{expectedPublicationRevision:0}});expect(activation.status(),await activation.text()).toBe(200);
    context = await browser.newContext({storageState:await api.storageState()});const page = await context.newPage();await page.goto(`${runtime.url}/#/projects/${id}/versions/${version.id}/run`);await expect(page.locator(".model-3d-edit-hint")).toBeVisible();await page.screenshot({path:testInfo.outputPath("meshopt-frozen-runtime.png")});
    const exported = await api.get(`${base}/versions/${version.id}/package`);expect(exported.status()).toBe(200);const inspected = await api.post("/api/v1/project-packages",{data:await exported.body(),headers:{"content-type":"application/zip"}});expect(inspected.status(),await inspected.text()).toBe(201);
    const worker = await localApi();let workerId:string|undefined;
    try { const created = await worker.post("/api/v1/projects",{data:{name:"Worker Meshopt unsupported fixture"}});expect(created.status()).toBe(201);workerId=(await created.json()).project.id;const response = await worker.post(`/api/v1/projects/${workerId}/model-assets?filename=meshopt.glb`,{data:fixture.bytes,headers:{"content-type":"model/gltf-binary"}});expect(response.status(),await response.text()).toBe(503);expect((await response.json()).error).toBe("model_codec_unavailable");expect((await (await worker.get(`/api/v1/projects/${workerId}/model-assets`)).json()).modelAssets).toEqual([]); } finally {if(workerId) await worker.delete(`/api/v1/projects/${workerId}`);await worker.dispose();}
  } finally {await context?.close();await api.dispose();await runtime.dispose();}
});
