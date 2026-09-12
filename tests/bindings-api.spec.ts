import { test, expect, request } from "@playwright/test";
import { createDemo, localApi } from "./demo";
import { permissionFixture } from "./permission-fixture";
import { session } from "./support";

test("server rejects dangling, foreign and invalid bindings without changing the canvas", async () => {
  const api = await localApi(); const demo = await createDemo(api); const foreign = await createDemo(api);
  const path = `/api/v1/projects/${demo.projectId}/canvas`;
  const canvas = demo.canvas;
  const node = canvas.nodes.find((item: { id: string }) => item.id === "fixed-metric");
  try {
    const invalids = [
      { upsertNodes: [{ ...node, dataBindingRefs: [foreign.definitions[0].id] }] },
      { dataBindings: [] },
      { dataBindings: [{ ...demo.definitions[0], assetIds: ["ONLY-IN-OTHER-PROJECT"] }, ...demo.definitions.slice(1)] },
      { dataBindings: [{ ...demo.definitions[0], metrics: [{ metricKey: "temperature", valueType: "boolean" }] }, ...demo.definitions.slice(1)] },
      { dataBindings: [{ ...demo.definitions[0], target: "rows" }, ...demo.definitions.slice(1)] },
      { dataBindings: [{ ...demo.definitions[0], sourcePath: "$.raw" }, ...demo.definitions.slice(1)] },
    ];
    const otherAsset = await api.post(`/api/v1/projects/${foreign.projectId}/assets`, { data: { assetId: "ONLY-IN-OTHER-PROJECT", name: "Other project fixture", assetType: "equipment", modelNode: null, metadata: {} } });
    expect(otherAsset.status()).toBe(201);
    for (const change of invalids) {
      const response = await api.patch(path, { data: { expectedRevision: canvas.revision, upsertNodes: [node], deleteNodeIds: [], ...change } });
      expect(response.status(), await response.text()).toBe(400);
      expect((await (await api.get(path)).json()).canvas).toEqual(canvas);
    }
    const stale = await api.patch(path, { data: { expectedRevision: 0, upsertNodes: [node], deleteNodeIds: [], dataBindings: demo.definitions } });
    expect(stale.status()).toBe(409);
    const wrongAsset = await api.get(`/api/v1/projects/${demo.projectId}/assets/${foreign.assets[0].id}/runtime-state`);
    expect(wrongAsset.status()).toBe(404);
    expect((await (await api.get(path)).json()).canvas).toEqual(canvas);
  } finally { await api.delete(`/api/v1/projects/${demo.projectId}`); await api.delete(`/api/v1/projects/${foreign.projectId}`); await api.dispose(); }
});

test("authenticated viewer can read but cannot write; outsider and anonymous cannot read project data", async () => {
  test.setTimeout(60_000);
  const api = await localApi(); const demo = await createDemo(api, true);
  const viewer = await permissionFixture(demo.projectId, true);
  const outsider = await permissionFixture(demo.projectId, false);
  const anonymous = await request.newContext({ baseURL: session().apiBase });
  const path = `/api/v1/projects/${demo.projectId}`;
  const modelId = demo.canvas.nodes.find((node: { type: string }) => node.type === "model-3d").resourceRefs[0];
  try {
    for (const endpoint of [`${path}/canvas`, `${path}/definition`, `${path}/model-assets/${modelId}`, `${path}/model-assets/${modelId}/versions`, `${path}/runtime-catalog`, `${path}/assets/${demo.assets[0].id}/runtime-state`]) {
      expect((await viewer.api.get(endpoint)).status()).toBe(200);
      expect((await outsider.api.get(endpoint)).status()).toBe(404);
      expect((await anonymous.get(endpoint)).status()).toBe(401);
    }
    const update = { expectedRevision: demo.canvas.revision, upsertNodes: [demo.canvas.nodes[1]], deleteNodeIds: [], dataBindings: demo.definitions };
    expect((await viewer.api.patch(`${path}/canvas`, { data: update })).status()).toBe(403);
    expect((await anonymous.patch(`${path}/canvas`, { data: update })).status()).toBe(401);
    const projectUpdate = { expectedRevision: demo.canvas.revision, upsertPages: [], deletePageIds: [], upsertNodes: [], deleteNodeIds: [] };
    expect((await viewer.api.patch(`${path}/definition`, { data: projectUpdate })).status()).toBe(403);
    expect((await outsider.api.patch(`${path}/definition`, { data: projectUpdate })).status()).toBe(404);
    expect((await anonymous.patch(`${path}/definition`, { data: projectUpdate })).status()).toBe(401);
    expect((await viewer.api.post(`${path}/model-assets/unknown-model/inspect`)).status()).toBe(403);
    expect((await outsider.api.post(`${path}/model-assets/unknown-model/inspect`)).status()).toBe(404);
    expect((await anonymous.post(`${path}/model-assets/unknown-model/inspect`)).status()).toBe(401);
    expect((await viewer.api.post(`${path}/model-assets/${modelId}/versions?filename=denied.gltf`, { data: "{}" })).status()).toBe(403);
    expect((await outsider.api.post(`${path}/model-assets/${modelId}/versions?filename=denied.gltf`, { data: "{}" })).status()).toBe(404);
    expect((await anonymous.post(`${path}/model-assets/${modelId}/versions?filename=denied.gltf`, { data: "{}" })).status()).toBe(401);
    expect((await (await api.get(`${path}/canvas`)).json()).canvas).toEqual(demo.canvas);
  } finally { await viewer.dispose(); await outsider.dispose(); await anonymous.dispose(); await api.delete(path); await api.dispose(); }
});
