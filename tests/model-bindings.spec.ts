import { test, expect } from "@playwright/test";
import { createDemo, localApi } from "./demo";
import { control, login } from "./support";

test("2D selection reaches a late-loading model, 3D selection updates 2D, removing 3D preserves subscriptions", async ({ page }, testInfo) => {
  const api = await localApi(); const demo = await createDemo(api, true);
  const path = `/api/v1/projects/${demo.projectId}`;
  try {
    await login(page);
    // Delay only the fixture model response to exercise selection before load.
    let releaseModel!: () => void;
    const modelGate = new Promise<void>((resolve) => { releaseModel = resolve; });
    await page.route("**/model-assets/*/content", async (route) => { await modelGate; await route.continue(); });
    await page.goto(`/#/projects/${demo.projectId}/preview`);
    await page.getByRole("button", { name: "选择设备 DEVICE-002", exact: true }).click();
    releaseModel();
    const renderer = page.locator(".model-3d-renderer");
    await expect(renderer).toHaveAttribute("data-selected-scene-node", "1");
    await expect(renderer.locator("canvas")).toBeVisible();
    await expect(page.locator('[data-node-id="selected-metric"] .dashboard-metric-value')).toContainText(/6\d/);
    await page.screenshot({ path: testInfo.outputPath("table-selects-model.png") });
    const size = await renderer.locator("canvas").boundingBox();
    expect(size).not.toBeNull();
    await renderer.locator("canvas").click({ position: { x: size!.width * 0.37, y: size!.height * 0.43 } });
    await expect(page.getByRole("combobox", { name: "当前设备", exact: true })).toHaveValue("DEVICE-001");
    await expect(page.locator('[data-node-id="selected-metric"] .dashboard-metric-value')).toContainText(/4\d/);
    await expect(page.getByRole("button", { name: "选择设备 DEVICE-001", exact: true })).toHaveAttribute("aria-pressed", "true");
    await control(page, "/control/state", { status: "alarm" });
    await expect(page.locator(".runtime-device-state")).toContainText("告警");
    await page.screenshot({ path: testInfo.outputPath("model-alarm-shared-data.png") });
    await control(page, "/control/state", { status: "running" });
    await expect(page.locator(".runtime-device-state")).toContainText("运行");
    await page.getByRole("link", { name: "返回编辑", exact: true }).click();
    await page.locator('[data-node-id="demo-model"]').click();
    await page.getByRole("button", { name: "删除组件", exact: true }).click();
    await page.getByRole("button", { name: "保存画布", exact: true }).click();
    await expect(page.locator(".canvas-document-meta")).toContainText("已保存");
    await page.getByRole("button", { name: "预览", exact: true }).click();
    await expect(page.locator(".model-3d-renderer")).toHaveCount(0);
    await page.getByRole("button", { name: "选择设备 DEVICE-002", exact: true }).click();
    await expect(page.locator(".runtime-status-banner")).toContainText("在线 2 台");
    await expect(page.locator('[data-node-id="selected-metric"] .dashboard-metric-value')).toContainText(/6\d/);
    await page.screenshot({ path: testInfo.outputPath("after-removing-3d.png") });
    const saved = (await (await api.get(`${path}/canvas`)).json()).canvas;
    expect(saved.nodes.some((node: { type: string }) => node.type === "model-3d")).toBeFalsy();
    expect(saved.dataBindings).toHaveLength(3);
  } finally { await control(page, "/control/state", { status: "running" }); await api.delete(path); await api.dispose(); }
});

test("switching projects cannot carry old connections or selection into the next project", async ({ page }) => {
  const api = await localApi(); const first = await createDemo(api); const second = await createDemo(api);
  try {
    await login(page); await page.goto(`/#/projects/${first.projectId}/preview`);
    await page.getByRole("button", { name: "选择设备 DEVICE-002", exact: true }).click();
    await expect(page.locator('[data-node-id="selected-metric"] [data-binding-state="live"]')).toBeVisible();
    const requests: string[] = [];
    await page.goto(`/#/projects/${second.projectId}/preview`);
    await expect(page.locator(".runtime-status-banner")).toContainText("在线 2 台");
    page.on("request", (request) => { if (request.url().endsWith("/runtime-state")) requests.push(request.url()); });
    await expect(page.getByRole("combobox", { name: "当前设备", exact: true })).toHaveValue("");
    await expect(page.locator('[data-node-id="selected-metric"] [data-binding-state]')).toHaveAttribute("data-binding-state", "empty");
    await expect(page.locator('[data-node-id="selected-metric"] .dashboard-metric-value')).toHaveCount(0);
    await expect.poll(() => requests.length).toBeGreaterThanOrEqual(2);
    expect(requests.every((url) => url.includes(second.projectId))).toBeTruthy();
  } finally { await api.delete(`/api/v1/projects/${first.projectId}`); await api.delete(`/api/v1/projects/${second.projectId}`); await api.dispose(); }
});
