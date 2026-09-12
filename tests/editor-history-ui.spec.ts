import { test, expect } from "@playwright/test";
import { createDemo, localApi } from "./demo";
import { login } from "./support";

test("copy a bound component, delete, undo/redo, save/reopen and preview its real data", async ({ page }, testInfo) => {
  const api = await localApi(); const demo = await createDemo(api);
  const path = `/api/v1/projects/${demo.projectId}`;
  try {
    await login(page); await page.goto(`/#/projects/${demo.projectId}/canvas`);
    const count = demo.canvas.nodes.length;
    await page.locator('[data-node-id="fixed-metric"]').click();
    await page.getByRole("button", { name: "复制组件", exact: true }).click();
    await expect(page.locator(".canvas-node")).toHaveCount(count + 1);
    const copied = await page.locator(".canvas-node.is-selected").getAttribute("data-node-id");
    expect(copied).not.toBe("fixed-metric");
    await page.screenshot({ path: testInfo.outputPath("editor-history-controls.png") });
    await page.getByRole("button", { name: "删除组件", exact: true }).click();
    await expect(page.locator(".canvas-node")).toHaveCount(count);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect(page.locator(`[data-node-id="${copied}"]`)).toBeVisible();
    await page.getByRole("button", { name: "重做", exact: true }).click();
    await expect(page.locator(`[data-node-id="${copied}"]`)).toHaveCount(0);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await page.getByRole("button", { name: "保存画布", exact: true }).click();
    await expect(page.locator(".canvas-document-meta")).toContainText("已保存");
    const saved = (await (await api.get(`${path}/canvas`)).json()).canvas;
    const original = saved.nodes.find((node: { id: string }) => node.id === "fixed-metric");
    const copy = saved.nodes.find((node: { id: string }) => node.id === copied);
    expect(copy.dataBindingRefs[0]).not.toBe(original.dataBindingRefs[0]);
    expect(saved.dataBindings).toHaveLength(5);
    // Undo across a save uses the new server revision, not an old history revision.
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await page.getByRole("button", { name: "重做", exact: true }).click();
    await expect(page.getByRole("button", { name: "保存画布", exact: true })).toBeDisabled();
    await page.reload();
    await expect(page.locator(`[data-node-id="${copied}"] [data-binding-state]`)).toHaveAttribute("data-binding-state", "live");
    await page.getByRole("button", { name: "预览", exact: true }).click();
    await expect(page.locator(`[data-node-id="${copied}"] .dashboard-metric-value`)).toContainText(/4\d/);
    expect((await (await api.get(`${path}/canvas`)).json()).canvas).toEqual(saved);
    await page.screenshot({ path: testInfo.outputPath("copied-binding-preview.png") });
  } finally { await api.delete(path); await api.dispose(); }
});
