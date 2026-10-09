import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { builtinModels } from "../../../shared/builtin-models";
import { twinDriveErrors } from "../../../shared/twin-drive";
import { businessApiExampleConfig, businessApiExampleInstances, businessApiExampleSettings } from "../src/twin/business-api-example";
import { populateBusinessApiExample, prepareBusinessApiExample } from "../src/twin/create-business-example";
import { instantiateSceneTemplate } from "../src/scene/scene-templates";
import { STANDALONE_3D_LIMITS } from "../../../shared/standalone-3d";
import { feedbackLabel } from "../src/twin/feedback-label";

let checks = 0;
async function check(name, run) { await run(); checks++; console.log(`✓ ${name}`); }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const clone = (value) => structuredClone(value);
const canonicalReordered = (value) => Array.isArray(value) ? value.map(canonicalReordered) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonicalReordered(entry)])) : value;
const blank = () => ({ revision: 0, instances: [], linked2dProjectId: null, settings: {}, projectId: "new-example" });
const validFeedback = () => {
  const state = { timestamp: new Date().toISOString() };
  for (const point of businessApiExampleConfig().points) {
    const keys = point.sourcePath.split(".");
    let target = state;
    for (const key of keys.slice(0, -1)) target = target[key] ??= {};
    target[keys.at(-1)] = point.min;
  }
  return state;
};

await check("REST and WebSocket examples use real backend endpoints and pass the shared contract", () => {
  for (const protocol of ["rest", "websocket"]) {
    const config = businessApiExampleConfig(protocol);
    assert.equal(config.source, "api");
    assert.equal(config.connection.protocol, protocol);
    assert.deepEqual(twinDriveErrors(config), []);
    assert.equal(config.simulation, undefined);
    assert.deepEqual(config.procedures, []);
    assert.ok(config.points.every((point) => point.sourcePath && point.assetId === ""));
  }
});

await check("each driven node exists exactly once in the actual GLB, with native animations disabled", () => {
  assert.equal(businessApiExampleSettings.playAnimations, false);
  for (const binding of businessApiExampleConfig().bindings) {
    const instance = businessApiExampleInstances.find((entry) => entry.id === binding.target.instanceId);
    assert.ok(instance);
    assert.equal(instance.animation.enabled, false);
    assert.equal(instance.modelAssetId, binding.target.modelAssetId);
    const model = builtinModels.find((entry) => entry.id === instance.modelAssetId);
    assert.ok(model);
    const bytes = readFileSync(`apps/web/public${model.contentPath}`);
    assert.equal(bytes.toString("utf8", 0, 4), "glTF");
    const gltf = JSON.parse(bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)));
    assert.equal(gltf.nodes.filter((node) => node.name === binding.target.nodeName).length, 1);
  }
});

await check("API templates cannot overwrite an existing scene through the draft template path", () => {
  const scene = blank();
  assert.throws(() => instantiateSceneTemplate({ templateId: "handling-cell-api", currentScene: scene, savedScene: scene,
    models: builtinModels, limits: STANDALONE_3D_LIMITS, editable: true }), /模板中心/);
});

await check("invalid or unavailable business endpoints reject before project creation", async () => {
  const invalidTime = validFeedback(); invalidTime.timestamp = "invalid";
  globalThis.fetch = async () => json(invalidTime);
  await assert.rejects(prepareBusinessApiExample, /缺少有效的采样时间/);
  for (const point of businessApiExampleConfig().points) {
    for (const value of [undefined, "3", point.max + 1]) {
      const sample = validFeedback(); const keys = point.sourcePath.split(".");
      sample[keys[0]][keys[1]] = value;
      globalThis.fetch = async () => json(sample);
      await assert.rejects(prepareBusinessApiExample, /反馈缺失或超出范围/);
    }
  }
  // Old endpoints without joint/gripper/cargo feedback cannot produce a believable new demo.
  globalThis.fetch = async () => json({ timestamp: new Date().toISOString(), agv: { positionM: 3 }, robot: { angleDeg: 0 } });
  await assert.rejects(prepareBusinessApiExample, /反馈缺失或超出范围/);
  globalThis.fetch = async () => json({ error: "unavailable" }, 503);
  await assert.rejects(prepareBusinessApiExample, (error) => error.code === "unavailable");
  globalThis.fetch = async () => json(validFeedback());
  await prepareBusinessApiExample();
});

await check("customer-readable phases report actual feedback and expose unknown, stale and disconnected states", () => {
  const point = businessApiExampleConfig().points.find(point => point.id === "business-phase");
  assert.equal(point.valueLabels.length, 22);
  const now = Date.now();
  const sample = { value: 0, quality: "good", timestamp: new Date(now).toISOString() };
  assert.equal(feedbackLabel(point, sample, true, now), "送件到站");
  assert.equal(feedbackLabel(point, { ...sample, value: 999 }, true, now), "未知状态（999）");
  assert.equal(feedbackLabel(point, sample, false, now), "连接中断");
  assert.equal(feedbackLabel(point, undefined, true, now), "等待数据");
  assert.equal(feedbackLabel(point, { ...sample, quality: "error" }, true, now), "数据异常");
  assert.equal(feedbackLabel(point, sample, true, now + point.staleAfterMs + 1), "数据过期");
  for (const invalid of [[], [{ value: 0, label: " " }], [{ value: .5, label: "小数" }], [{ value: 22, label: "越界" }],
    [{ value: 0, label: "重复" }, { value: 0, label: "重复" }], [{ value: 0, label: "控制\n字符" }]]) {
    const config = businessApiExampleConfig(); config.points.find(point => point.id === "business-phase").valueLabels = invalid;
    assert.ok(twinDriveErrors(config).length > 0);
  }
});

await check("partial failure resumes the same project without resaving the scene or hiding errors", async () => {
  let scene = blank();
  let drive = { revision: 0, config: {}, editable: true };
  let sceneWrites = 0;
  let driveWrites = 0;
  const progress = [];
  globalThis.fetch = async (url, init) => {
    if (url.endsWith("/scene") && init.method === "PATCH") {
      sceneWrites++;
      const body = JSON.parse(init.body);
      assert.equal(body.expectedRevision, 0);
      scene = { ...scene, revision: 1, instances: canonicalReordered(body.upsertInstances), settings: canonicalReordered(body.settings) };
      return json({ scene, editable: true });
    }
    if (url.endsWith("/scene")) return json({ scene, editable: true });
    assert.equal(url, "/api/v1/projects/new-example/twin-drive");
    if (init.method === "PUT") {
      driveWrites++;
      if (driveWrites === 1) return json({ error: "upstream_unavailable" }, 503);
      const body = JSON.parse(init.body);
      assert.equal(body.expectedRevision, 0);
      drive = { ...drive, revision: 1, config: canonicalReordered(body.config) };
    }
    return json(drive);
  };
  await assert.rejects(() => populateBusinessApiExample("new-example", (message) => progress.push(message)), (error) => error.code === "upstream_unavailable");
  await populateBusinessApiExample("new-example", (message) => progress.push(message));
  await populateBusinessApiExample("new-example", (message) => progress.push(message));
  assert.equal(sceneWrites, 1);
  assert.equal(driveWrites, 2);
  assert.equal(progress.at(-1), "正在保存接口与模型绑定…");
  assert.deepEqual(drive.config, canonicalReordered(businessApiExampleConfig()));
});

await check("retry refuses to replace scene edits, interface edits or read-only documents", async () => {
  let scene = { ...blank(), revision: 1, instances: clone(businessApiExampleInstances), settings: clone(businessApiExampleSettings) };
  let drive = { revision: 1, config: { ...businessApiExampleConfig(), enabled: false }, editable: true };
  let editable = true;
  let writes = 0;
  globalThis.fetch = async (url, init) => {
    if (init.method === "PATCH" || init.method === "PUT") writes++;
    return json(url.endsWith("/scene") ? { scene, editable } : drive);
  };
  await assert.rejects(() => populateBusinessApiExample("new-example", () => {}), /接口配置已经修改/);
  scene.instances[0].transform.position[0] = 7;
  await assert.rejects(() => populateBusinessApiExample("new-example", () => {}), /场景已经修改/);
  editable = false;
  await assert.rejects(() => populateBusinessApiExample("new-example", () => {}), /没有编辑/);
  assert.equal(writes, 0);
});
console.log(`PASS: ${checks} business API example checks.`);
