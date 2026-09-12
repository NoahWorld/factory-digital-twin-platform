import { test, expect } from "@playwright/test";
import { canvasTemplates } from "../apps/web/src/canvas/templates";
import { control, login, session } from "./support";

test("M0: login, create, apply static template, save and reopen", async ({ page }, testInfo) => {
  await login(page);
  const name = `M0 模板回归 ${Date.now()}`;
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByLabel("项目名称", { exact: true }).fill(name);
  await page.getByRole("button", { name: "创建草稿项目", exact: true }).click();
  const card = page.locator(".project-card").filter({ has: page.getByRole("heading", { name, exact: true }) });
  await card.locator("a.project-card-cover").click();
  await page.getByRole("button", { name: "模板", exact: true }).click();
  const template = canvasTemplates.find((item) => item.id === "equipment-maintenance")!;
  await page.getByRole("dialog").locator(".template-card")
    .filter({ has: page.getByRole("heading", { name: template.showcase.title, exact: true }) })
    .getByRole("button", { name: "使用此模板", exact: true }).click();
  await page.getByRole("button", { name: "保存画布", exact: true }).click();
  await expect(page.locator(".canvas-document-meta")).toContainText("已保存");
  const projectId = page.url().split("/projects/")[1].split("/")[0];
  const before = await (await page.request.get(`/api/v1/projects/${projectId}/canvas`)).json();
  expect(before.canvas.nodes.length).toBeGreaterThan(5);
  await page.reload();
  await expect(page.locator(".canvas-node")).toHaveCount(before.canvas.nodes.length);
  await expect(page.locator(".canvas-document-meta")).toContainText("已保存");
  const after = await (await page.request.get(`/api/v1/projects/${projectId}/canvas`)).json();
  expect(after.canvas).toEqual(before.canvas);
  await page.screenshot({ path: testInfo.outputPath("static-template.png") });
  expect((await page.request.delete(`/api/v1/projects/${projectId}`)).ok()).toBeTruthy();
});

test("M0: rendered model selection, stale data, outage and automatic recovery", async ({ page }, testInfo) => {
  await login(page);
  await page.goto(`/#/projects/${session().projectId}/preview`);
  const model = page.locator(".model-3d-renderer canvas");
  await expect(page.locator(".runtime-status-banner")).toContainText("在线 1 台");
  await expect(model).toBeVisible();
  await model.click();
  await expect(page.getByRole("complementary", { name: "模拟设备 001 设备详情" })).toBeVisible();
  await expect(page.locator(".runtime-metric-grid")).toContainText("temperature");
  await page.screenshot({ path: testInfo.outputPath("model-live.png") });
  try {
    await control(page, "/control/stale");
    await expect(page.locator(".runtime-status-banner")).toContainText("数据陈旧 1 台");
    await control(page, "/control/fresh");
    await expect(page.locator(".runtime-status-banner")).toContainText("在线 1 台");
    await control(page, "/control/outage");
    await expect(page.locator(".runtime-status-banner")).toContainText("数据失联 1 台");
    await page.screenshot({ path: testInfo.outputPath("model-offline.png") });
    await control(page, "/control/recover");
    await expect(page.locator(".runtime-status-banner")).toContainText("在线 1 台");
    await expect(page.locator(".runtime-offline-alert")).toHaveCount(0);
  } finally {
    await control(page, "/control/recover");
    await control(page, "/control/fresh");
  }
});
