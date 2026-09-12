import { test, expect } from "@playwright/test";
import { createDemo, localApi } from "./demo";
import { createMockGltf } from "../scripts/mock-model.mjs";
import { readUploadBytes } from "../apps/api/src/upload-body";

test("model versions preserve stable source identities, retain old bytes and allocate concurrent versions", async () => {
  const api = await localApi(); const demo = await createDemo(api); const foreign = await createDemo(api);
  const path = `/api/v1/projects/${demo.projectId}`;
  const upload = (url: string, data: string) => api.post(url, { data, headers: { "content-type": "model/gltf+json" } });
  try {
    const before = (await (await api.get(`${path}/definition`)).json()).definition;
    const firstBytes = createMockGltf([{ mesh: 0, name: "Pump", extras: { newpowerObjectId: "pump-source" } }, { mesh: 0, name: "Sensor" }]);
    const firstResponse = await upload(`${path}/model-assets?filename=machine.gltf`, firstBytes);
    expect(firstResponse.status(), await firstResponse.text()).toBe(201); const first = (await firstResponse.json()).modelAsset;
    expect(first).toMatchObject({ familyId: first.id, versionNumber: 1, previousVersionId: null });
    const secondBytes = createMockGltf([{ mesh: 0, name: "SensorRenamed" }, { mesh: 0, name: "PumpRenamed", extras: { newpowerObjectId: "pump-source" } }]);
    const secondResponse = await upload(`${path}/model-assets/${first.id}/versions?filename=machine-v2.gltf`, secondBytes);
    expect(secondResponse.status(), await secondResponse.text()).toBe(201); const second = (await secondResponse.json()).modelAsset;
    expect(second).toMatchObject({ familyId: first.id, versionNumber: 2, previousVersionId: first.id });
    expect(second.inspection.objects[1].objectId).toBe(first.inspection.objects[0].objectId);
    expect(second.inspection.objects[0].objectId).not.toBe(first.inspection.objects[1].objectId);
    const thirdResponse = await upload(`${path}/model-assets/${second.id}/versions?filename=machine-copy.gltf`, secondBytes);
    expect(thirdResponse.status()).toBe(201); const third = (await thirdResponse.json()).modelAsset;
    expect(third.inspection.objects.map((object: { objectId: string }) => object.objectId)).toEqual(second.inspection.objects.map((object: { objectId: string }) => object.objectId));
    const concurrent = await Promise.all([upload(`${path}/model-assets/${first.id}/versions?filename=parallel-a.gltf`, secondBytes), upload(`${path}/model-assets/${first.id}/versions?filename=parallel-b.gltf`, secondBytes)]);
    for (const response of concurrent) expect(response.status(), await response.text()).toBe(201);
    const numbers = await Promise.all(concurrent.map(async (response) => (await response.json()).modelAsset.versionNumber));
    expect(numbers.sort()).toEqual([4,5]);
    const versions = (await (await api.get(`${path}/model-assets/${first.id}/versions`)).json()).modelAssets;
    expect(versions.map((asset: { versionNumber: number }) => asset.versionNumber)).toEqual([5,4,3,2,1]);
    expect(await (await api.get(`${path}/model-assets/${first.id}/content`)).text()).toBe(firstBytes);
    expect((await (await api.get(`${path}/definition`)).json()).definition).toEqual(before);
    expect((await upload(`/api/v1/projects/${foreign.projectId}/model-assets/${first.id}/versions?filename=foreign.gltf`, secondBytes)).status()).toBe(404);
    expect((await api.delete(path)).status()).toBe(200);
  } finally { await api.delete(path); await api.delete(`/api/v1/projects/${foreign.projectId}`); await api.dispose(); }
});

test("chunked uploads are cancelled as soon as they exceed the file budget", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(8)); }, cancel() { cancelled = true; } });
  const request = new Request("http://127.0.0.1/upload", { method: "POST", body: stream, duplex: "half" } as RequestInit);
  await expect(readUploadBytes(request, 12, "model_file_too_large")).rejects.toMatchObject({ status: 413, code: "model_file_too_large" });
  expect(cancelled).toBe(true);
  const valid = new Request("http://127.0.0.1/upload", { method: "POST", body: new Uint8Array([1,2,3]) });
  expect([...await readUploadBytes(valid, 12, "model_file_too_large")]).toEqual([1,2,3]);
});
