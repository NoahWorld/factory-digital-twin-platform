import { test, expect } from "@playwright/test";
import { createDemo, localApi } from "./demo";
import { login } from "./support";

test("local page drafts survive reload, server conflicts, further editing and saving", async ({ page }, testInfo) => {
  const api = await localApi(); const demo = await createDemo(api);
  const path = `/api/v1/projects/${demo.projectId}`;
  const rename = async (name: string) => { await page.getByLabel("页面名称", { exact: true }).fill(name); await page.getByLabel("页面名称", { exact: true }).press("Enter"); };
  try {
    await login(page); await page.goto(`/#/projects/${demo.projectId}/canvas`);
    await rename("尚未保存的本机页面");
    await page.reload();
    await expect(page.getByLabel("页面名称", { exact: true })).toHaveValue("尚未保存的本机页面");
    const before = (await (await api.get(`${path}/definition`)).json()).definition;
    expect(before.pages[0].name).toBe("首页");
    const { nodes: _, ...metadata } = before.pages[0];
    const remote = await api.patch(`${path}/definition`, { data: { expectedRevision: before.revision, upsertPages: [{ ...metadata, name: "服务器另存的页面" }], deletePageIds: [], upsertNodes: [], deleteNodeIds: [] } });
    expect(remote.status(), await remote.text()).toBe(200);
    await page.reload();
    await expect(page.getByLabel("页面名称", { exact: true })).toHaveValue("服务器另存的页面");
    await expect(page.getByRole("button", { name: "恢复草稿到编辑器", exact: true })).toBeVisible();
    await page.getByText("恢复后的差异", { exact: true }).click();
    await expect(page.locator(".project-draft-notice")).toContainText("尚未保存的本机页面");
    await page.screenshot({ path: testInfo.outputPath("conflict-draft-differences.png") });
    await rename("在服务器版本上继续编辑");
    await page.reload();
    await expect(page.getByLabel("页面名称", { exact: true })).toHaveValue("在服务器版本上继续编辑");
    await expect(page.getByRole("button", { name: "恢复草稿到编辑器", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "保存画布", exact: true }).click();
    await expect(page.locator(".canvas-document-meta")).toContainText("已保存");
    await page.reload();
    await expect(page.getByRole("button", { name: "恢复草稿到编辑器", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "恢复草稿到编辑器", exact: true }).click();
    await expect(page.getByLabel("页面名称", { exact: true })).toHaveValue("尚未保存的本机页面");
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect(page.getByLabel("页面名称", { exact: true })).toHaveValue("在服务器版本上继续编辑");
    await page.getByRole("button", { name: "重做", exact: true }).click();
    await page.getByRole("button", { name: "保存画布", exact: true }).click();
    await expect(page.locator(".canvas-document-meta")).toContainText("已保存");
    await page.reload();
    await expect(page.getByLabel("页面名称", { exact: true })).toHaveValue("尚未保存的本机页面");
    await expect(page.getByRole("button", { name: "恢复草稿到编辑器", exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("recovered-project-draft.png") });
  } finally { await api.delete(path); await api.dispose(); }
});
