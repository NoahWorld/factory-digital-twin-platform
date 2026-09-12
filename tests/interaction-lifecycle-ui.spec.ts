import { test, expect } from "@playwright/test";
import { createDemo, localApi } from "./demo";
import { login, control } from "./support";
import { createCanvasNode } from "../apps/web/src/canvas/types";
import { createEditorState, executeEditorOperation } from "../shared/editor-operations";
import { projectDefinitionPatch } from "../shared/project-definition";
import type { InteractionRule, InteractionAction } from "../shared/interactions";

const rule = (id: string, pageId: string | null, actions: InteractionAction[], trigger: InteractionRule["trigger"]): InteractionRule => ({ id: crypto.randomUUID(), name: id, pageId, actions, trigger, condition: null, enabled: true, reentry: "restart" });
const text = (value: string) => ({ kind: "literal" as const, value });

test("runtime navigation cancels page work, enters the actual new page and keeps cyclic page transitions in one bounded trace", async ({ page }) => {
  const api = await localApi(); const demo = await createDemo(api, false); const path = `/api/v1/projects/${demo.projectId}`;
  try {
    let state = createEditorState((await (await api.get(`${path}/definition`)).json()).definition);
    const button = { ...createCanvasNode("button", 80, 900, 9), id: "go" }; button.props = { ...button.props, text: "进入设备页", href: "" };
    state = executeEditorOperation(state, { type: "nodes.upsert", nodes: [button] });
    state = executeEditorOperation(state, { type: "page.add", id: "detail", name: "设备页" });
    const marker = { ...createCanvasNode("plain-text", 80, 80, 1), id: "marker" }; marker.props = { ...marker.props, text: "进入时隐藏" };
    state = executeEditorOperation(state, { type: "nodes.upsert", pageId: "detail", nodes: [marker] });
    state = executeEditorOperation(state, { type: "interactions.set", interactions: { states: [{ id: "status", name: "流程状态", pageId: null, valueType: "string", initial: "idle" }], rules: [
      rule("延迟旧页", "main", [{ type: "delay", milliseconds: 3000 }, { type: "state.set", stateId: "status", value: text("错误的迟到动作") }], { type: "node.click", sourceId: "go" }),
      rule("跳转设备页", "main", [{ type: "page.navigate", pageId: "detail" }], { type: "node.click", sourceId: "go" }),
      rule("进入设备页", "detail", [{ type: "node.visible", nodeId: "marker", visible: false }, { type: "state.set", stateId: "status", value: text("设备页就绪") }], { type: "page.enter", sourceId: "detail" }),
      rule("开启循环", null, [{ type: "page.navigate", pageId: "main" }], { type: "custom", sourceId: "loop" }),
    ] } });
    const response = await api.patch(`${path}/definition`, { data: projectDefinitionPatch(state.project, state.savedProject) }); expect(response.status(), await response.text()).toBe(200);
    await login(page); await page.goto(`/#/projects/${demo.projectId}/preview`);
    await expect(page.locator(".runtime-status-banner")).toContainText("在线 2 台");
    await page.getByRole("button", { name: "进入设备页", exact: true }).click();
    await expect(page.getByLabel("当前页面", { exact: true })).toHaveValue("detail");
    await expect(page.locator('[data-node-id="marker"]')).toBeHidden();
    await page.getByRole("button", { name: "交互调试", exact: true }).click();
    const debug = page.getByRole("complementary", { name: "交互调试", exact: true });
    await expect(debug.locator("dd")).toHaveText('"设备页就绪"');
    await expect(debug.locator(".is-cancelled")).not.toHaveCount(0);
    await page.waitForTimeout(3100); // Absence check: the old page's scheduled effect must never commit.
    await expect(debug.locator("dd")).toHaveText('"设备页就绪"');
    await debug.getByRole("button", { name: "关闭调试", exact: true }).click();
    const saved = (await (await api.get(`${path}/definition`)).json()).definition;
    saved.interactions.rules = [rule("main-to-detail", "main", [{ type: "page.navigate", pageId: "detail" }], { type: "page.enter" }), rule("detail-to-main", "detail", [{ type: "page.navigate", pageId: "main" }], { type: "page.enter" })];
    const changed = await api.patch(`${path}/definition`, { data: { expectedRevision: saved.revision, upsertPages: [], deletePageIds: [], upsertNodes: [], deleteNodeIds: [], interactions: saved.interactions } }); expect(changed.status()).toBe(200);
    await page.reload();
    await page.getByRole("button", { name: "交互调试", exact: true }).click();
    await expect(debug).toContainText("超过 128 步");
    await expect(debug).toContainText("执行中 0");
    expect(await debug.locator(".is-failed").count()).toBe(0);
  } finally { await api.delete(path); await api.dispose(); }
});

test("data-only rules request unbound assets once and stale or missing input cannot satisfy a negated numeric condition", async ({ page }) => {
  const api = await localApi(); const demo = await createDemo(api, false, false); const path = `/api/v1/projects/${demo.projectId}`;
  try {
    const project = (await (await api.get(`${path}/definition`)).json()).definition;
    const config = { states: [{ id: "data", name: "数据判定", pageId: null, valueType: "string", initial: "waiting" }], rules: [
      { ...rule("有效温度", "main", [{ type: "state.set", stateId: "data", value: text("valid") }], { type: "data.change", sourceId: "DEVICE-001", metricKey: "temperature" }), condition: { op: "not", condition: { op: "lt", left: { kind: "metric", assetId: "DEVICE-001", metricKey: "temperature" }, right: { kind: "literal", value: 0 } } } },
      rule("陈旧标记", "main", [{ type: "state.set", stateId: "data", value: { kind: "event", field: "status" } }], { type: "connection.change", sourceId: "DEVICE-001" }),
    ] };
    const result = await api.patch(`${path}/definition`, { data: { expectedRevision: project.revision, upsertPages: [], deletePageIds: [], upsertNodes: [], deleteNodeIds: [], interactions: config } }); expect(result.status(), await result.text()).toBe(200);
    const requested = new Set<string>(); page.on("request", (request) => { const match = request.url().match(/\/assets\/([^/]+)\/runtime-state$/); if (match) requested.add(match[1]); });
    await login(page); await page.goto(`/#/projects/${demo.projectId}/preview`); await page.getByRole("button", { name: "交互调试", exact: true }).click();
    const debug = page.getByRole("complementary", { name: "交互调试", exact: true });
    await expect(debug.locator("dd")).toHaveText('"valid"'); expect([...requested]).toEqual([demo.assets[0].id]);
    await control(page, "/control/stale"); await expect(debug.locator("dd")).toHaveText('"stale"');
    await expect(debug).toContainText("条件未满足或数据不可用");
    await control(page, "/control/fresh"); await expect(debug.locator("dd")).toHaveText('"valid"');
    await control(page, "/control/outage"); await expect(debug.locator("dd")).toHaveText('"offline"');
    await control(page, "/control/recover"); await expect(debug.locator("dd")).toHaveText('"valid"');
  } finally { await control(page, "/control/recover"); await control(page, "/control/fresh"); await api.delete(path); await api.dispose(); }
});
