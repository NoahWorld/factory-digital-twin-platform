import { test, expect } from "@playwright/test";
import { createDemo,localApi } from "./demo";
import { createAnimatedMockGltf } from "../scripts/mock-model.mjs";
import { removeModelReportFields } from "./model-report-fixture";

test("native clip reports retain IDs across versions and upgrades while exposing exact source times and channels", async () => {
  const api = await localApi(); const demo = await createDemo(api,false); const path = `/api/v1/projects/${demo.projectId}`;
  try {
    const bytes = createAnimatedMockGltf({ start: 1,duplicateNames: true,interpolation: "CUBICSPLINE" });
    const response = await api.post(`${path}/model-assets?filename=clips.gltf`,{ data: bytes,headers: { "content-type": "model/gltf+json" } }); expect(response.status(),await response.text()).toBe(201);
    const original = (await response.json()).modelAsset;
    expect(original.inspection.animationManifestVersion).toBe(1); expect(original.inspection.clips).toHaveLength(2);
    const [first,second] = original.inspection.clips;
    expect(first.clipId).not.toBe(second.clipId); expect(first).toMatchObject({ name: "Lift",sourceId: "lift",startTime: 1,duration: 3,inDefaultScene: true });
    expect(first.channels[0]).toEqual({ objectId: original.inspection.objects[0].objectId,path: "translation",interpolation: "CUBICSPLINE" });
    const update = JSON.parse(bytes); update.animations.reverse(); update.animations[1].name = "LiftRenamed"; update.nodes[0].name = "MovingGroupRenamed";
    const next = await api.post(`${path}/model-assets/${original.id}/versions?filename=updated.gltf`,{ data: JSON.stringify(update),headers: { "content-type": "model/gltf+json" } }); expect(next.status(),await next.text()).toBe(201);
    const version = (await next.json()).modelAsset;
    expect(version.inspection.clips[0].clipId).toBe(second.clipId); expect(version.inspection.clips[1].clipId).toBe(first.clipId);
    expect(version.inspection.clips[1].channels[0].objectId).toBe(original.inspection.objects[0].objectId);
    expect(version.inspection.clips[1].animationIndex).toBe(1);
    const reinspect = await api.post(`${path}/model-assets/${version.id}/inspect`); expect(reinspect.status()).toBe(200); expect((await reinspect.json()).modelAsset.inspection.clips).toEqual(version.inspection.clips);
    const exact = await api.post(`${path}/model-assets/${version.id}/versions?filename=same.gltf`,{ data: JSON.stringify(update),headers: { "content-type": "model/gltf+json" } }); expect(exact.status()).toBe(201); expect((await exact.json()).modelAsset.inspection.clips).toEqual(version.inspection.clips);
  } finally { await api.delete(path); await api.dispose(); }
});

test("old animation reports upgrade once with stable clip and object IDs under concurrent inspection", async () => {
  const api = await localApi(); const demo = await createDemo(api,false); const path = `/api/v1/projects/${demo.projectId}`;
  try {
    const upload = await api.post(`${path}/model-assets?filename=legacy-animated.gltf`,{ data: createAnimatedMockGltf(),headers: { "content-type": "model/gltf+json" } }); expect(upload.status()).toBe(201);
    const source = (await upload.json()).modelAsset;
    removeModelReportFields(demo.projectId,source,["animationManifestVersion","clips"]);
    const results = await Promise.all([api.post(`${path}/model-assets/${source.id}/inspect`),api.post(`${path}/model-assets/${source.id}/inspect`)]);
    for (const result of results) expect(result.status()).toBe(200);
    const [one,two] = await Promise.all(results.map(async (result) => (await result.json()).modelAsset));
    expect(one.inspection.clips).toEqual(two.inspection.clips); expect(one.inspection.objects).toEqual(source.inspection.objects);
    expect(one.inspection.clips[0].channels[0].objectId).toBe(source.inspection.objects[0].objectId);
    expect((await (await api.post(`${path}/model-assets/${source.id}/inspect`)).json()).modelAsset.inspection).toEqual(one.inspection);
  } finally { await api.delete(path); await api.dispose(); }
});

test("rotation clips reject non-unit poses, accept quantized units and keep cubic tangent magnitudes unrestricted", async () => {
  const api = await localApi(); const demo = await createDemo(api,false); const path = `/api/v1/projects/${demo.projectId}`;
  const replaceOutput = (gltf: any, data: Buffer, componentType: number, normalized = false) => {
    const old = Buffer.from(gltf.buffers[0].uri.split(",")[1],"base64"), full = Buffer.concat([old,data]);
    gltf.buffers[0] = { byteLength: full.length,uri: `data:application/octet-stream;base64,${full.toString("base64")}` };
    gltf.bufferViews.push({ buffer: 0,byteOffset: old.length,byteLength: data.length });
    const accessor = gltf.accessors[gltf.animations[0].samplers[0].output]; Object.assign(accessor,{ bufferView: gltf.bufferViews.length-1,componentType,normalized });
  };
  try {
    const bad = JSON.parse(createAnimatedMockGltf({ path: "rotation" }));
    replaceOutput(bad,Buffer.from(new Float32Array([1,0,0,1,1,0,0,1,1,0,0,1]).buffer),5126);
    const rejected = await api.post(`${path}/model-assets?filename=bad-quaternion.gltf`,{ data: JSON.stringify(bad),headers: { "content-type": "model/gltf+json" } }); expect(rejected.status()).toBe(400); expect((await rejected.json()).message).toContain("单位四元数");
    const quantized = JSON.parse(createAnimatedMockGltf({ path: "rotation" }));
    replaceOutput(quantized,Buffer.from(new Int16Array([0,0,0,32767,0,23170,0,23170,0,0,0,32767]).buffer),5122,true);
    const accepted = await api.post(`${path}/model-assets?filename=quantized-rotation.gltf`,{ data: JSON.stringify(quantized),headers: { "content-type": "model/gltf+json" } }); expect(accepted.status(),await accepted.text()).toBe(201);
    const cubic = JSON.parse(createAnimatedMockGltf({ path: "rotation",interpolation: "CUBICSPLINE" }));
    const output = new Float32Array([10,0,0,0,0,0,0,1,10,0,0,0, 10,0,0,0,0,Math.SQRT1_2,0,Math.SQRT1_2,10,0,0,0, 10,0,0,0,0,0,0,1,10,0,0,0]);
    replaceOutput(cubic,Buffer.from(output.buffer),5126);
    const tangent = await api.post(`${path}/model-assets?filename=cubic-rotation.gltf`,{ data: JSON.stringify(cubic),headers: { "content-type": "model/gltf+json" } }); expect(tangent.status(),await tangent.text()).toBe(201);
  } finally { await api.delete(path); await api.dispose(); }
});

test("invalid animation timing, output shape, values and source identities fail before resource storage", async () => {
  const api = await localApi(); const demo = await createDemo(api,false); const path = `/api/v1/projects/${demo.projectId}`;
  const cases: Array<[string,(gltf: any) => void]> = [
    ["time-order",(gltf) => { const data = Buffer.from(gltf.buffers[0].uri.split(",")[1],"base64"); const view = gltf.bufferViews[gltf.accessors[gltf.animations[0].samplers[0].input].bufferView]; data.writeFloatLE(0,view.byteOffset+4); gltf.buffers[0].uri = `data:application/octet-stream;base64,${data.toString("base64")}`; }],
    ["negative-time",(gltf) => { const data = Buffer.from(gltf.buffers[0].uri.split(",")[1],"base64"); const view = gltf.bufferViews[gltf.accessors[gltf.animations[0].samplers[0].input].bufferView]; data.writeFloatLE(-1,view.byteOffset); gltf.buffers[0].uri = `data:application/octet-stream;base64,${data.toString("base64")}`; }],
    ["shape",(gltf) => { gltf.accessors[gltf.animations[0].samplers[0].output].count = 2; }],
    ["nan",(gltf) => { const data = Buffer.from(gltf.buffers[0].uri.split(",")[1],"base64"); const view = gltf.bufferViews[gltf.accessors[gltf.animations[0].samplers[0].output].bufferView]; data.writeFloatLE(NaN,view.byteOffset); gltf.buffers[0].uri = `data:application/octet-stream;base64,${data.toString("base64")}`; }],
    ["duplicate-source",(gltf) => { gltf.animations.push(structuredClone(gltf.animations[0])); }],
    ["duplicate-channel",(gltf) => { gltf.animations[0].channels.push(structuredClone(gltf.animations[0].channels[0])); }],
    ["bounds",(gltf) => { delete gltf.accessors[gltf.animations[0].samplers[0].input].min; }],
  ];
  try {
    for (const [name,mutate] of cases) {
      const gltf = JSON.parse(createAnimatedMockGltf()); mutate(gltf);
      const response = await api.post(`${path}/model-assets?filename=${name}.gltf`,{ data: JSON.stringify(gltf),headers: { "content-type": "model/gltf+json" } });
      expect(response.status(),`${name}: ${await response.text()}`).toBe(400);
      expect((await response.json()).error).toBe("model_inspection_failed");
    }
    expect((await (await api.get(`${path}/model-assets`)).json()).modelAssets).toEqual([]);
  } finally { await api.delete(path); await api.dispose(); }
});
