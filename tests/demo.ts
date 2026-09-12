import { expect, request, type APIRequestContext } from "@playwright/test";
import { createCanvasNode, type CanvasNode } from "../apps/web/src/canvas/types";
import type { ComponentBinding } from "../shared/component-bindings";
import { createMockGltf } from "../scripts/mock-model.mjs";
import { session } from "./support";

export async function localApi() {
  const identity = session();
  const url = new URL(identity.apiBase);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("Demo creation requires the isolated local Worker.");
  return request.newContext({ baseURL: identity.apiBase, extraHTTPHeaders: { cookie: identity.sessionCookie } });
}

export async function createDemo(api: APIRequestContext, withModel = false, bound = true) {
  const call = async (path: string, data?: unknown, expected = 200) => {
    const response = data === undefined ? await api.get(path) : await api.post(path, { data });
    expect(response.status(), await response.text()).toBe(expected);
    return response.json();
  };
  const { project } = await call("/api/v1/projects", { name: `NewPower 双设备 · ${withModel ? "二维三维联动" : "纯二维"}（模拟）` }, 201);
  const path = `/api/v1/projects/${project.id}`;
  const assets: Array<{ id: string; assetId: string }> = [];
  for (let index = 1; index <= 2; index += 1) {
    const assetId = `DEVICE-00${index}`;
    const { asset } = await call(`${path}/assets`, { assetId, name: `模拟设备 00${index}`, assetType: "equipment", modelNode: withModel ? `DemoDevice00${index}` : null, metadata: { simulated: true } }, 201);
    assets.push(asset);
    const { dataSource } = await call(`${path}/data-sources`, { name: `模拟设备 00${index} REST`, sourceType: "rest_polling", config: {
      url: `${process.env.NEWPOWER_MOCK_URL ?? "http://127.0.0.1:8790"}/device/${assetId}`, credentialRef: null, intervalSeconds: 2, timeoutMs: 1500, timestampPath: "$.timestamp",
    } }, 201);
    for (const [metricKey, valueType, unit] of [["temperature", "number", "°C"], ["pressure", "number", "kPa"], ["status", "string", null], ["alarmLevel", "number", null]]) {
      await call(`${path}/assets/${asset.id}/data-bindings`, { dataSourceId: dataSource.id, metricKey, sourcePath: `$.values.${metricKey}`, valueType, unit, staleAfterSeconds: 6 }, 201);
    }
  }
  const metric = { metricKey: "temperature", valueType: "number" as const };
  const definitions: ComponentBinding[] = [
    { id: crypto.randomUUID(), version: 1, target: "value", selection: "fixed", assetIds: ["DEVICE-001"], metrics: [metric] },
    { id: crypto.randomUUID(), version: 1, target: "value", selection: "selected", assetIds: ["DEVICE-001", "DEVICE-002"], metrics: [metric] },
    { id: crypto.randomUUID(), version: 1, target: "series", selection: "fixed", assetIds: ["DEVICE-001", "DEVICE-002"], metrics: [metric] },
    { id: crypto.randomUUID(), version: 1, target: "rows", selection: "fixed", assetIds: ["DEVICE-001", "DEVICE-002"], metrics: [metric, { metricKey: "status", valueType: "string" }] },
  ];
  const makeNode = (type: CanvasNode["type"], id: string, title: string, x: number, y: number, width: number, height: number, bindingIndex?: number) => {
    const node = createCanvasNode(type, x, y, 2);
    return { ...node, id, width, height, props: { ...node.props, ...(type === "screen-title" ? { text: title, subtitle: "模拟设备 · 通用绑定 · 可保存配置" } : { title }) }, dataBindingRefs: bound && bindingIndex !== undefined ? [definitions[bindingIndex].id] : [] };
  };
  const nodes = withModel ? [
    makeNode("screen-title", "demo-title", "NewPower · 设备联动实验", 40, 20, 1840, 90),
    makeNode("metric-card", "selected-metric", "当前选中设备温度", 960, 140, 880, 160, 1),
    makeNode("bar-chart", "device-chart", "双设备温度对比", 960, 330, 880, 300, 2),
    makeNode("data-table", "device-table", "设备数据 · 点击名称联动", 960, 660, 880, 300, 3),
  ] : [
    makeNode("screen-title", "demo-title", "NewPower · 纯二维设备数据", 40, 20, 1840, 90),
    makeNode("metric-card", "fixed-metric", "固定设备 001 温度", 80, 150, 390, 170, 0),
    makeNode("metric-card", "selected-metric", "当前选中设备温度", 500, 150, 390, 170, 1),
    makeNode("bar-chart", "device-chart", "双设备温度对比", 80, 360, 810, 500, 2),
    makeNode("data-table", "device-table", "设备数据 · 点击名称联动", 960, 150, 880, 710, 3),
  ];
  if (withModel) {
    const response = await api.post(`${path}/model-assets?filename=newpower-two-devices.gltf`, { data: createMockGltf([
      { mesh: 0, name: "DemoDevice001", translation: [-1.6, 0, 0] },
      { mesh: 0, name: "DemoDevice002", translation: [1.6, 0, 0] },
    ]), headers: { "content-type": "model/gltf+json" } });
    expect(response.status(), await response.text()).toBe(201);
    const { modelAsset } = await response.json();
    const model = createCanvasNode("model-3d", 40, 140, 1);
    nodes.push({ ...model, id: "demo-model", width: 880, height: 680, resourceRefs: [modelAsset.id], props: { ...model.props, autoRotate: false } });
  }
  const { canvas } = await call(`${path}/canvas`);
  const saved = await api.patch(`${path}/canvas`, { data: { expectedRevision: 0, theme: canvas.theme, upsertNodes: nodes, deleteNodeIds: [], dataBindings: bound ? definitions : [] } });
  expect(saved.status(), await saved.text()).toBe(200);
  return { projectId: project.id as string, assets, canvas: (await saved.json()).canvas, definitions };
}
