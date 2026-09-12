import { test, expect } from "@playwright/test";
import { createDemo, localApi } from "./demo";
import { control, login } from "./support";

test("configure all three component bindings through UI, save, reopen and remove", async ({ page }, testInfo) => {
  const api = await localApi(); const demo = await createDemo(api, false, false);
  const path = `/api/v1/projects/${demo.projectId}/canvas`;
  try {
    await login(page);
    await page.goto(`/#/projects/${demo.projectId}/canvas`);
    for (const [id, type] of [["fixed-metric", "fixed"], ["selected-metric", "selected"], ["device-chart", "chart"], ["device-table", "table"]]) {
      await page.locator(`[data-node-id="${id}"]`).click();
      const form = page.getByRole("region", { name: "组件数据绑定" });
      await form.getByRole("combobox", { name: "数据模式", exact: true }).selectOption("binding");
      if (type === "selected") await form.getByRole("combobox", { name: "设备模式", exact: true }).selectOption("selected");
      await form.getByRole("checkbox", { name: /模拟设备 001/ }).check();
      if (type !== "fixed") await form.getByRole("checkbox", { name: /模拟设备 002/ }).check();
      if (type === "table") {
        await form.getByRole("checkbox", { name: /temperature/ }).check();
        await form.getByRole("checkbox", { name: /status/ }).check();
      } else await form.getByRole("combobox", { name: "绑定指标", exact: true }).selectOption("temperature");
      await form.getByRole("button", { name: "应用到组件", exact: true }).click();
      await expect(form.getByRole("button", { name: "移除绑定，恢复静态演示" })).toBeVisible();
      await expect(form.locator(".binding-form-error")).toHaveCount(0);
    }
    await page.screenshot({ path: testInfo.outputPath("binding-inspector.png") });
    await page.getByRole("button", { name: "保存画布", exact: true }).click();
    await expect(page.locator(".canvas-document-meta")).toContainText("已保存");
    const saved = (await (await api.get(path)).json()).canvas;
    expect(saved.dataBindings).toHaveLength(4);
    expect(saved.nodes.find((node: { id: string }) => node.id === "fixed-metric").props).toEqual(demo.canvas.nodes.find((node: { id: string }) => node.id === "fixed-metric").props);
    await page.reload();
    await expect(page.locator('[data-node-id="fixed-metric"] [data-binding-state="live"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "保存画布", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "预览", exact: true }).click();
    await page.getByRole("button", { name: "选择设备 DEVICE-002", exact: true }).click();
    await expect(page.locator('[data-node-id="selected-metric"] .dashboard-metric-value')).toContainText(/6\d/);
    await page.screenshot({ path: testInfo.outputPath("pure-2d-live.png") });
    expect((await (await api.get(path)).json()).canvas).toEqual(saved);
    await page.getByRole("link", { name: "返回编辑", exact: true }).click();
    await page.locator('[data-node-id="fixed-metric"]').click();
    await page.getByRole("button", { name: "移除绑定，恢复静态演示", exact: true }).click();
    await page.getByRole("button", { name: "保存画布", exact: true }).click();
    await expect(page.locator(".canvas-document-meta")).toContainText("已保存");
    await page.reload();
    await expect(page.locator('[data-node-id="fixed-metric"] .dashboard-sample-badge')).toBeVisible();
    expect((await (await api.get(path)).json()).canvas.dataBindings).toHaveLength(3);
  } finally { await api.delete(`/api/v1/projects/${demo.projectId}`); await api.dispose(); }
});

test("real mock null, type error, missing, stale, outage and recovery remain explicit", async ({ page }, testInfo) => {
  const api = await localApi(); const demo = await createDemo(api);
  try {
    await login(page); await page.goto(`/#/projects/${demo.projectId}/preview`);
    const metric = page.locator('[data-node-id="fixed-metric"] [data-binding-state]');
    await expect(metric).toHaveAttribute("data-binding-state", "live");
    for (const [mode, state] of [["null", "null"], ["type-error", "type-error"], ["missing", "empty"]]) {
      await control(page, "/control/value", { mode });
      await expect(metric).toHaveAttribute("data-binding-state", state);
      await expect(metric.locator(".dashboard-metric-value strong")).toHaveText("—");
      await expect(page.locator('[data-node-id="device-table"]')).toContainText("模拟设备 002");
      await control(page, "/control/value", { mode: "normal" });
      await expect(metric).toHaveAttribute("data-binding-state", "live");
    }
    await control(page, "/control/stale");
    await expect(metric).toHaveAttribute("data-binding-state", "stale");
    await control(page, "/control/fresh");
    await expect(metric).toHaveAttribute("data-binding-state", "live");
    await control(page, "/control/outage");
    await expect(metric).toHaveAttribute("data-binding-state", "offline");
    await page.screenshot({ path: testInfo.outputPath("offline-no-demo-fallback.png") });
    await control(page, "/control/recover");
    await expect(metric).toHaveAttribute("data-binding-state", "live");
  } finally {
    await control(page, "/control/value", { mode: "normal" }); await control(page, "/control/recover"); await control(page, "/control/fresh");
    await api.delete(`/api/v1/projects/${demo.projectId}`); await api.dispose();
  }
});

test("multiple consumers share polling, rapid selection does not mix values and leaving stops requests", async ({ page }) => {
  const api = await localApi(); const demo = await createDemo(api);
  const times = new Map<string, number[]>();
  page.on("request", (request) => {
    const match = request.url().match(/\/assets\/([^/]+)\/runtime-state$/);
    if (match) times.set(match[1], [...(times.get(match[1]) ?? []), Date.now()]);
  });
  try {
    await login(page); await page.goto(`/#/projects/${demo.projectId}/preview`);
    await expect(page.locator(".runtime-status-banner")).toContainText("在线 2 台");
    for (const id of ["DEVICE-002", "DEVICE-001", "DEVICE-002", "DEVICE-001"]) {
      await page.getByRole("button", { name: `选择设备 ${id}`, exact: true }).click();
      const value = page.locator('[data-node-id="selected-metric"] .dashboard-metric-value');
      await expect(value).toContainText(id === "DEVICE-001" ? /4\d/ : /6\d/);
    }
    await expect.poll(() => Math.min(...[...times.values()].map((items) => items.length))).toBeGreaterThanOrEqual(2);
    for (const entries of times.values()) for (let index = 1; index < entries.length; index++) expect(entries[index] - entries[index - 1]).toBeGreaterThan(1500);
    await page.getByRole("link", { name: "返回项目列表", exact: true }).click();
    await expect(page.getByRole("button", { name: "新建项目", exact: true })).toBeVisible();
    const before = [...times.values()].flat().length;
    // Observe one complete polling interval after unmount; this is an absence check.
    await page.waitForTimeout(2400);
    expect([...times.values()].flat()).toHaveLength(before);
  } finally { await api.delete(`/api/v1/projects/${demo.projectId}`); await api.dispose(); }
});

test("table retains each asset's unit and chart rejects incompatible units", async ({ page }, testInfo) => {
  const api = await localApi(); const demo = await createDemo(api);
  const path = `/api/v1/projects/${demo.projectId}`;
  try {
    const bindingPath = `${path}/assets/${demo.assets[1].id}/data-bindings`;
    const { dataBindings } = await (await api.get(bindingPath)).json();
    const metric = dataBindings.find((item: { metricKey: string }) => item.metricKey === "temperature");
    const response = await api.patch(`${bindingPath}/${metric.id}`, { data: {
      dataSourceId: metric.dataSourceId, metricKey: metric.metricKey, sourcePath: metric.sourcePath,
      valueType: metric.valueType, unit: "K", staleAfterSeconds: metric.staleAfterSeconds,
    } });
    expect(response.status(), await response.text()).toBe(200);
    await login(page); await page.goto(`/#/projects/${demo.projectId}/preview`);
    const table = page.locator('[data-node-id="device-table"]');
    await expect(table.locator('[data-asset-id="DEVICE-001"]')).toContainText("°C");
    await expect(table.locator('[data-asset-id="DEVICE-002"]')).toContainText(" K");
    await expect(page.locator('[data-node-id="device-chart"]')).toContainText("相同单位");
    await page.screenshot({ path: testInfo.outputPath("per-asset-units.png") });
  } finally { await api.delete(path); await api.dispose(); }
});
