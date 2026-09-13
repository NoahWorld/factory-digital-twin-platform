import { test,expect } from "@playwright/test";
import { createMockGltf,createMultiPrimitiveGltf } from "../scripts/mock-model.mjs";
import { inspectLegacyModelNames } from "../apps/api/src/legacy-model-names";
import { createDemo,localApi } from "./demo";
import { createCanvasNode } from "../apps/web/src/canvas/types";

test("publication legacy names match the actual browser loader for sanitized nodes and multi-material children",async ({ page }) => {
  await page.goto("/");
  for (const bytes of [createMockGltf([{ mesh:0,name:"Pump.A" }]),createMultiPrimitiveGltf()]) {
    const headless = await inspectLegacyModelNames(new TextEncoder().encode(bytes));
    const browser = await page.evaluate(async (text) => {
      const module = await import(/* @vite-ignore */ "/src/canvas/model-resource-cache.ts");
      const url = URL.createObjectURL(new Blob([text],{ type:"model/gltf+json" })),lease = module.acquireModelResource(url);
      try {
        const model = await lease.ready,names:Record<string,string[]> = {};
        const byObject = new Map<any,string>();
        for (const [locator,object] of model.objectsByLocator) if (!byObject.has(object) || JSON.parse(locator)[1] === null && JSON.parse(locator)[2] === null) byObject.set(object,locator);
        model.scene.traverse((object:any) => { const locator = byObject.get(object); if (object.name && locator) (names[object.name] ??= []).push(locator); });
        return names;
      } finally { lease.release(); URL.revokeObjectURL(url); }
    },bytes);
    expect(headless.names).toEqual(browser); expect(headless.unstableNames).toEqual([]);
  }
});

test("Worker publication accepts saved sanitized and primitive overrides and rejects missing legacy asset names",async () => {
  const api = await localApi(),demo = await createDemo(api),path = `/api/v1/projects/${demo.projectId}`;
  try {
    const buffer = createMultiPrimitiveGltf(),uploaded = await api.post(`${path}/model-assets?filename=legacy.gltf`,{ data:buffer,headers:{ "content-type":"model/gltf+json" } }); expect(uploaded.status()).toBe(201); const model = (await uploaded.json()).modelAsset;
    const names = await inspectLegacyModelNames(new TextEncoder().encode(buffer)),children = Object.keys(names.names).filter((name) => name.startsWith("MachineMesh")); expect(children).toHaveLength(2);
    const node = createCanvasNode("model-3d",60,60,1); node.resourceRefs = [model.id]; node.props.appearanceOverrides = { [children[0]]:{ color:"#cc3366",opacity:1,visible:true } };
    expect((await api.patch(`${path}/canvas`,{ data:{ expectedRevision:demo.canvas.revision,upsertNodes:[node],deleteNodeIds:[] } })).status()).toBe(200);
    expect((await api.patch(`${path}/assets/${demo.assets[0].id}`,{ data:{ modelNode:children[0] } })).status()).toBe(200);
    const inspected = await api.get(`${path}/publication-draft`); expect(inspected.status(),await inspected.text()).toBe(200);
    expect((await api.patch(`${path}/assets/${demo.assets[0].id}`,{ data:{ modelNode:"Ghost" } })).status()).toBe(200);
    const failed = await api.get(`${path}/publication-draft`); expect(failed.status()).toBe(409); expect((await failed.json()).error).toBe("publication_dependencies_invalid");
  } finally { await api.delete(path); await api.dispose(); }
});


test("asynchronous materials cannot certify competing legacy mesh names as unique",async () => {
  const gltf = JSON.parse(createMockGltf([{ mesh:0 },{ mesh:1 }]));
  gltf.meshes[0].name = "Shared"; gltf.meshes.push(structuredClone(gltf.meshes[0]));
  const names = await inspectLegacyModelNames(new TextEncoder().encode(JSON.stringify(gltf)));
  expect(names.unstableNames.sort()).toEqual(["Shared","Shared_1"]);
  gltf.nodes[0].name = "StableA"; gltf.nodes[1].name = "StableB";
  const stable = await inspectLegacyModelNames(new TextEncoder().encode(JSON.stringify(gltf)));
  expect(stable.names.StableA).toHaveLength(1); expect(stable.names.StableB).toHaveLength(1); expect(stable.unstableNames).toEqual([]);
});
