import { test, expect } from "@playwright/test";
import { createDemo, localApi } from "./demo";
import { login } from "./support";

test("add an unmapped asset, configure its metric and bind a 2D component without code editing", async ({ page }, testInfo) => {
  const api = await localApi(); const demo = await createDemo(api);
  const path = `/api/v1/projects/${demo.projectId}`;
  try {
    await login(page); await page.goto(`/#/projects/${demo.projectId}/canvas`);
    await page.getByRole("button", { name: "资产与指标", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "资产与指标", exact: true });
    await panel.getByLabel("设备编号", { exact: true }).fill("UI-DEVICE-003");
    await panel.getByLabel("设备名称", { exact: true }).fill("无模型模拟设备");
    await panel.getByRole("checkbox", { name: "模拟设备（运行时显示标识）", exact: true }).check();
    await panel.getByRole("button", { name: "添加设备", exact: true }).click();
    await expect(panel.locator(".asset-data-binding-context")).toContainText("UI-DEVICE-003");
    await panel.getByRole("combobox", { name: "数据源", exact: true }).selectOption({ label: "模拟设备 001 REST · REST" });
    await panel.getByLabel("指标键 metricKey", { exact: true }).fill("temperature");
    await panel.getByLabel("响应字段路径", { exact: true }).fill("$.values.temperature");
    await panel.getByRole("combobox", { name: "值类型", exact: true }).selectOption("number");
    await panel.getByLabel("单位（可选）", { exact: true }).fill("°C");
    await panel.getByLabel("数据过期时间（秒）", { exact: true }).fill("6");
    await panel.getByRole("button", { name: "创建映射", exact: true }).click();
    await expect(panel.locator(".asset-data-binding-list")).toContainText("temperature");
    await page.screenshot({ path: testInfo.outputPath("asset-and-metric-configuration.png") });
    await panel.getByRole("button", { name: "关闭资产与指标", exact: true }).click();
    await page.locator('[data-node-id="fixed-metric"]').click();
    const binding = page.getByRole("region", { name: "组件数据绑定" });
    await binding.getByRole("checkbox", { name: /无模型模拟设备/ }).check();
    await binding.getByRole("button", { name: "应用到组件", exact: true }).click();
    await expect(binding.locator(".binding-form-error")).toHaveCount(0);
    await page.getByRole("button", { name: "保存画布", exact: true }).click();
    await expect(page.locator(".canvas-document-meta")).toContainText("已保存");
    await page.getByRole("button", { name: "预览", exact: true }).click();
    await expect(page.locator('[data-node-id="fixed-metric"] [data-binding-state]')).toHaveAttribute("data-binding-state", "live");
    await expect(page.locator('[data-node-id="fixed-metric"]')).toContainText("无模型模拟设备");
    const catalog = await (await api.get(`${path}/runtime-catalog`)).json();
    const asset = catalog.assets.find((item: { assetId: string }) => item.assetId === "UI-DEVICE-003");
    expect(asset.modelNode).toBeNull();
    expect(catalog.metrics).toContainEqual({ assetId: "UI-DEVICE-003", metricKey: "temperature", valueType: "number", unit: "°C" });
  } finally { await api.delete(path); await api.dispose(); }
});
