import { test, expect } from "@playwright/test";
import { createDemo, localApi } from "./demo";
import { login } from "./support";

test("group dragging, cross-page move, undo and saved preview retain component identities", async ({ page }, testInfo) => {
  const api = await localApi(); const demo = await createDemo(api);
  const path = `/api/v1/projects/${demo.projectId}`;
  const save = async () => { await page.getByRole("button", { name: "保存画布", exact: true }).click(); await expect(page.locator(".canvas-document-meta")).toContainText("已保存"); };
  try {
    await login(page); await page.goto(`/#/projects/${demo.projectId}/canvas`);
    await page.locator('[data-node-id="fixed-metric"]').click();
    await page.locator('[data-node-id="selected-metric"]').click({ modifiers: ["Shift"] });
    await expect(page.locator(".canvas-node.is-selected")).toHaveCount(2);
    await page.getByRole("button", { name: "分组", exact: true }).click();
    const box = await page.locator('[data-node-id="fixed-metric"]').boundingBox();
    await page.mouse.move(box!.x + 30, box!.y + 30); await page.mouse.down();
    await page.mouse.move(box!.x + 60, box!.y + 60, { steps: 5 }); await page.mouse.up();
    await save();
    let current = (await (await api.get(`${path}/definition`)).json()).definition;
    const moved = current.pages[0].nodes.filter((node: { id: string }) => ["fixed-metric", "selected-metric"].includes(node.id));
    expect(moved[0].groupId).toBeTruthy(); expect(moved[1].groupId).toBe(moved[0].groupId);
    expect(moved[0].x).toBeGreaterThan(80); expect(moved[0].y).toBeGreaterThan(150);
    expect(moved[1].x - moved[0].x).toBeCloseTo(420, 8); expect(moved[1].y).toBe(moved[0].y);
    await page.getByRole("button", { name: "新增页面", exact: true }).click();
    const secondId = await page.getByLabel("当前页面", { exact: true }).inputValue();
    await page.getByLabel("当前页面", { exact: true }).selectOption("main");
    await page.locator('[data-node-id="fixed-metric"]').click();
    await expect(page.locator(".canvas-node.is-selected")).toHaveCount(2);
    await page.getByText("尺寸与跨页移动", { exact: true }).click();
    await page.getByLabel("移动到页面", { exact: true }).selectOption(secondId);
    await page.getByRole("button", { name: "移动所选组件", exact: true }).click();
    await expect(page.getByLabel("当前页面", { exact: true })).toHaveValue(secondId);
    await expect(page.locator(".canvas-node")).toHaveCount(2);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect(page.getByLabel("当前页面", { exact: true })).toHaveValue("main");
    await page.getByRole("button", { name: "重做", exact: true }).click();
    await save(); await page.reload();
    await expect(page.locator('[data-node-id="fixed-metric"]')).toBeVisible();
    current = (await (await api.get(`${path}/definition`)).json()).definition;
    expect(current.pages[0].nodes).toHaveLength(3);
    expect(current.pages[1].nodes).toEqual(moved);
    expect(current.dataBindings).toHaveLength(4);
    await page.getByRole("button", { name: "预览", exact: true }).click();
    await expect(page.locator('[data-node-id="fixed-metric"] [data-binding-state]')).toHaveAttribute("data-binding-state", "live");
    await page.screenshot({ path: testInfo.outputPath("second-page-group-preview.png") });
  } finally { await api.delete(path); await api.dispose(); }
});

test("second-page 3D editor returns to its page and shares project undo history", async ({ page }, testInfo) => {
  const api = await localApi(); const demo = await createDemo(api, true);
  const path = `/api/v1/projects/${demo.projectId}`;
  try {
    await login(page); await page.goto(`/#/projects/${demo.projectId}/canvas`);
    await page.getByRole("button", { name: "复制页面", exact: true }).click();
    const secondId = await page.getByLabel("当前页面", { exact: true }).inputValue();
    await page.locator('.canvas-node.is-model-3d').click();
    await page.getByRole("button", { name: "进入 3D 编辑器", exact: true }).click();
    await expect(page.getByRole("heading", { name: "场景预览", exact: true })).toBeVisible();
    await page.getByLabel("显示地面网格", { exact: true }).uncheck();
    await page.getByRole("button", { name: "保存并返回", exact: true }).click();
    await expect(page.getByLabel("当前页面", { exact: true })).toHaveValue(secondId);
    let current = (await (await api.get(`${path}/definition`)).json()).definition;
    expect(current.pages[0].nodes.find((node: { type: string }) => node.type === "model-3d").props.showGrid).toBe(true);
    expect(current.pages[1].nodes.find((node: { type: string }) => node.type === "model-3d").props.showGrid).toBe(false);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await page.getByRole("button", { name: "保存画布", exact: true }).click();
    await expect(page.locator(".canvas-document-meta")).toContainText("已保存");
    current = (await (await api.get(`${path}/definition`)).json()).definition;
    expect(current.pages[1].nodes.find((node: { type: string }) => node.type === "model-3d").props.showGrid).toBe(true);
    await page.reload();
    await expect(page.getByLabel("当前页面", { exact: true })).toHaveValue(secondId);
    await page.screenshot({ path: testInfo.outputPath("second-page-after-3d-edit.png") });
  } finally { await api.delete(path); await api.dispose(); }
});
