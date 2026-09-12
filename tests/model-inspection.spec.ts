import { test, expect } from "@playwright/test";
import { createDemo, localApi } from "./demo";
import { login } from "./support";
import { createMockGltf } from "../scripts/mock-model.mjs";
import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { isAbsolute, join } from "node:path";

function removeExtendedReportForLegacyFixture(projectId: string, model: { id: string; inspection: Record<string, unknown> }) {
  const state = process.env.NEWPOWER_TEST_STATE_DIR, config = process.env.NEWPOWER_TEST_CONFIG;
  if (!state || !config || !isAbsolute(state) || !isAbsolute(config) || !state.includes("test")) throw new Error("Legacy fixture requires the isolated local test database.");
  const keys = ["reportVersion", "triangleCount", "sceneTriangleCount", "vertexCount", "bounds", "textures", "coordinateUnit", "objects", "warnings"];
  const old = Object.fromEntries(Object.entries(model.inspection).filter(([key]) => !keys.includes(key)));
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const file = join(state, `legacy-model-report-${crypto.randomUUID()}.sql`);
  writeFileSync(file, `UPDATE model_assets SET inspection_json=${quote(JSON.stringify(old))} WHERE project_id=${quote(projectId)} AND id=${quote(model.id)};`, { mode: 0o600 });
  try {
    const result = spawnSync("pnpm", ["--filter", "@factory-twin/api", "exec", "wrangler", "d1", "execute", "factory-digital-twin-config", "--local", "--persist-to", state, "--config", config, "--file", file], { encoding: "utf8", timeout: 30000 });
    if (result.status !== 0) throw new Error("Isolated legacy model fixture failed.");
  } finally { unlinkSync(file); }
}

test("model reports count shared geometry and placed triangles, persist object IDs and reject invalid imports", async () => {
  const api = await localApi(); const demo = await createDemo(api, true);
  const path = `/api/v1/projects/${demo.projectId}/model-assets`;
  try {
    const model = (await (await api.get(path)).json()).modelAssets[0];
    expect(model.inspection).toMatchObject({ reportVersion: 2, triangleCount: 12, sceneTriangleCount: 24, vertexCount: 8,
      bounds: { min: [-2.6, -1, -1], max: [2.6, 1, 1] }, coordinateUnit: "metre-by-gltf-spec" });
    expect(model.inspection.objects).toHaveLength(2);
    expect(new Set(model.inspection.objects.map((object: { objectId: string }) => object.objectId)).size).toBe(2);
    const again = await api.post(`${path}/${model.id}/inspect`);
    expect(again.status(), await again.text()).toBe(200);
    expect((await again.json()).modelAsset).toEqual(model);
    const original = JSON.parse(createMockGltf());
    const floatIndices = structuredClone(original);
    const bytes = Buffer.from(original.buffers[0].uri.split(",")[1], "base64");
    const indices = Array.from(new Uint16Array(bytes.buffer, bytes.byteOffset + 96, 36));
    const invalidIndexBuffer = Buffer.concat([bytes.subarray(0, 96), Buffer.from(new Float32Array(indices).buffer)]);
    floatIndices.buffers[0] = { byteLength: invalidIndexBuffer.length, uri: `data:application/octet-stream;base64,${invalidIndexBuffer.toString("base64")}` };
    floatIndices.bufferViews[1].byteLength = 144; floatIndices.accessors[1].componentType = 5126;
    const invalids = [
      floatIndices,
      { ...original, nodes: [{ mesh: 0, children: [0] }] },
      { ...original, nodes: [{ mesh: 0, extras: { newpowerObjectId: "duplicate" } }, { mesh: 0, extras: { newpowerObjectId: "duplicate" } }] },
      { ...original, buffers: [{ byteLength: 1024, uri: "https://example.invalid/external.bin" }] },
      { ...original, accessors: [{ ...original.accessors[0], count: 999999999 }, original.accessors[1]] },
      { ...original, textures: [{ source: 0 }], images: [{}], materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }] },
    ];
    for (const value of invalids) {
      const response = await api.post(`${path}?filename=invalid.gltf`, { data: JSON.stringify(value), headers: { "content-type": "model/gltf+json" } });
      expect(response.status(), await response.text()).toBe(400);
      expect((await response.json()).message).toBeTruthy();
    }
    expect((await (await api.get(path)).json()).modelAssets).toHaveLength(1);
    // Valid GLB container with embedded buffers must follow the same report path.
    const json = Buffer.from(createMockGltf()); const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
    const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
    header.writeUInt32LE(20 + padded.length, 8); header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
    const glb = await api.post(`${path}?filename=fixture.glb`, { data: Buffer.concat([header, padded]), headers: { "content-type": "model/gltf-binary" } });
    expect(glb.status(), await glb.text()).toBe(201);
    expect((await glb.json()).modelAsset.inspection.triangleCount).toBe(12);
  } finally { await api.delete(`/api/v1/projects/${demo.projectId}`); await api.dispose(); }
});

test("GPU instancing includes transforms and cannot bypass the expanded work budget", async () => {
  const api = await localApi(); const demo = await createDemo(api);
  const path = `/api/v1/projects/${demo.projectId}/model-assets`;
  const fixture = (count: number, custom = false) => {
    const json = JSON.parse(createMockGltf());
    const bytes = Buffer.from(json.buffers[0].uri.split(",")[1], "base64");
    const values = custom ? new Float32Array(count) : new Float32Array([0,0,0,10,0,0]);
    const binary = Buffer.concat([bytes, Buffer.from(values.buffer)]);
    json.buffers[0] = { byteLength: binary.length, uri: `data:application/octet-stream;base64,${binary.toString("base64")}` };
    json.bufferViews.push({ buffer: 0, byteOffset: bytes.length, byteLength: values.byteLength });
    json.accessors.push({ bufferView: 2, componentType: 5126, count, type: custom ? "SCALAR" : "VEC3" });
    json.extensionsUsed = ["EXT_mesh_gpu_instancing"]; json.extensionsRequired = ["EXT_mesh_gpu_instancing"];
    json.nodes[0].extensions = { EXT_mesh_gpu_instancing: { attributes: { [custom ? "_ID" : "TRANSLATION"]: 2 } } };
    json.nodes[0].translation = [3,0,0];
    return json;
  };
  try {
    const accepted = await api.post(`${path}?filename=instances.gltf`, { data: JSON.stringify(fixture(2)), headers: { "content-type": "model/gltf+json" } });
    expect(accepted.status(), await accepted.text()).toBe(201);
    expect((await accepted.json()).modelAsset.inspection).toMatchObject({ triangleCount: 12, sceneTriangleCount: 24, bounds: { min: [2,-1,-1], max: [14,1,1] } });
    const rejected = await api.post(`${path}?filename=excessive-expansion.gltf`, { data: JSON.stringify(fixture(600000, true)), headers: { "content-type": "model/gltf+json" } });
    expect(rejected.status(), await rejected.text()).toBe(400);
    expect((await rejected.json()).message).toContain("2000 万次");
  } finally { await api.delete(`/api/v1/projects/${demo.projectId}`); await api.dispose(); }
});

test("3D inspector shows the saved resource report and renders its imported model", async ({ page }, testInfo) => {
  const api = await localApi(); const demo = await createDemo(api, true);
  try {
    const path = `/api/v1/projects/${demo.projectId}/model-assets`;
    const model = (await (await api.get(path)).json()).modelAssets[0];
    removeExtendedReportForLegacyFixture(demo.projectId, model);
    await login(page); await page.goto(`/#/projects/${demo.projectId}/canvas`);
    await page.locator('[data-node-id="demo-model"]').click();
    await page.getByRole("button", { name: "进入 3D 编辑器", exact: true }).click();
    await page.getByRole("button", { name: "补充资源检查", exact: true }).click();
    await expect(page.locator(".model-inspection-card")).toContainText("资源三角面12");
    await expect(page.locator(".model-inspection-card")).toContainText("场景三角面24");
    await expect(page.locator(".model-inspection-card")).toContainText("对象标识2");
    await expect(page.locator(".model-3d-edit-hint")).toBeVisible();
    const upgraded = (await (await api.get(path)).json()).modelAssets[0];
    expect(upgraded.sha256).toBe(model.sha256);
    removeExtendedReportForLegacyFixture(demo.projectId, upgraded);
    const parallel = await Promise.all([api.post(`${path}/${model.id}/inspect`), api.post(`${path}/${model.id}/inspect`)]);
    const final = (await (await api.get(path)).json()).modelAssets[0];
    for (const response of parallel) expect((await response.json()).modelAsset.inspection.objects).toEqual(final.inspection.objects);
    await page.screenshot({ path: testInfo.outputPath("model-resource-report.png") });
  } finally { await api.delete(`/api/v1/projects/${demo.projectId}`); await api.dispose(); }
});

test("the upload interface inspects and renders an embedded PNG texture", async ({ page }, testInfo) => {
  const api = await localApi(); const demo = await createDemo(api, true);
  try {
    await login(page); await page.goto(`/#/projects/${demo.projectId}/canvas`);
    await page.locator('[data-node-id="demo-model"]').click();
    await page.getByRole("button", { name: "进入 3D 编辑器", exact: true }).click();
    const imageURI = await page.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 4; canvas.height = 8;
      const context = canvas.getContext("2d")!; context.fillStyle = "#e19231"; context.fillRect(0, 0, 4, 8);
      return canvas.toDataURL("image/png");
    });
    const json = JSON.parse(createMockGltf());
    const binary = Buffer.from(json.buffers[0].uri.split(",")[1], "base64");
    const uv = Buffer.from(new Float32Array([0,0,1,0,1,1,0,1,0,0,1,0,1,1,0,1]).buffer);
    json.buffers[0] = { uri: `data:application/octet-stream;base64,${Buffer.concat([binary, uv]).toString("base64")}`, byteLength: binary.length + uv.length };
    json.bufferViews.push({ buffer: 0, byteOffset: binary.length, byteLength: uv.length });
    json.accessors.push({ bufferView: 2, componentType: 5126, count: 8, type: "VEC2" });
    json.meshes[0].primitives[0].attributes.TEXCOORD_0 = 2;
    json.images = [{ uri: imageURI }]; json.textures = [{ source: 0 }];
    json.materials[0].pbrMetallicRoughness.baseColorTexture = { index: 0 };
    await page.locator('input[type="file"]').setInputFiles({ name: "embedded-texture.gltf", mimeType: "model/gltf+json", buffer: Buffer.from(JSON.stringify(json)) });
    await expect(page.locator(".model-inspection-card")).toContainText("embedded-texture.gltf");
    await page.getByText("纹理与导入提示", { exact: true }).click();
    await expect(page.locator(".model-inspection-card")).toContainText("4 × 8");
    await expect(page.locator(".model-3d-edit-hint")).toBeVisible();
    await page.getByRole("button", { name: "保存并返回", exact: true }).click();
    await expect(page.locator(".canvas-document-meta")).toContainText("已保存");
    await page.reload(); await expect(page.locator(".model-3d-edit-hint")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("embedded-texture-reopened.png") });
  } finally { await api.delete(`/api/v1/projects/${demo.projectId}`); await api.dispose(); }
});
