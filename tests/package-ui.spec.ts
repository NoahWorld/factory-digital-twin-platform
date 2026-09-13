import { test,expect,request as apiRequest } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { nodeRuntimeFixture } from "./node-runtime-fixture";
import { createDemo } from "./demo";
import { createEditorState,executeEditorOperation } from "../shared/editor-operations";
import { projectDefinitionPatch } from "../shared/project-definition";

test("import ZIP through UI, bind a private environment, run with the original host stopped, restore editable draft and upgrade/rollback",async ({ browser },testInfo) => {
  test.setTimeout(120000);
  const source = await nodeRuntimeFixture(testInfo),target = await nodeRuntimeFixture({ ...testInfo,outputPath:(...parts:string[]) => testInfo.outputPath("target",...parts) } as typeof testInfo);
  const original = await apiRequest.newContext({ baseURL:source.url }); let api = await apiRequest.newContext({ baseURL:target.url }),sourceClosed = false,context:Awaited<ReturnType<typeof browser.newContext>>|undefined;
  try {
    for (const [runtime,client,email] of [[source,original,"source-ui@example.invalid"],[target,api,"target-ui@example.invalid"]] as const) expect((await client.post("/api/v1/auth/bootstrap",{ headers:{ "x-bootstrap-token":runtime.bootstrap },data:{ email,password:randomBytes(24).toString("hex"),displayName:"Import UI fixture" } })).status()).toBe(201);
    const demo = await createDemo(original,true),base = `/api/v1/projects/${demo.projectId}`,sources = (await (await original.get(`${base}/data-sources`)).json()).dataSources;
    const freeze = async (label:string) => { const draft = (await (await original.get(`${base}/publication-draft`)).json()).draft; const version = (await (await original.post(`${base}/versions`,{ data:{ expectedRuntimeRevision:draft.runtimeRevision,label } })).json()).version; return (await original.get(`${base}/versions/${version.id}/package`)).body(); };
    const firstZip = await freeze("Delivered V1");
    let state = createEditorState((await (await original.get(`${base}/definition`)).json()).definition); state = executeEditorOperation(state,{ type:"page.add",name:"升级后新增页面" }); expect((await original.patch(`${base}/definition`,{ data:projectDefinitionPatch(state.project,state.savedProject) })).status()).toBe(200); const secondZip = await freeze("Delivered V2");
    await source.dispose(); sourceClosed = true;
    const identity = await api.storageState(); context = await browser.newContext({ storageState:identity,viewport:{ width:1440,height:1000 } }); let page = await context.newPage();
    await page.goto(`${target.url}/#/projects`); await page.getByRole("button",{ name:"导入项目包",exact:true }).click();
    let dialog = page.getByRole("dialog",{ name:"导入项目包",exact:true }); await dialog.getByLabel("项目包 ZIP",{ exact:true }).setInputFiles({ name:"delivered.zip",mimeType:"application/zip",buffer:firstZip });
    await dialog.getByRole("button",{ name:"上传并检查项目包",exact:true }).click(); await expect(dialog.getByRole("heading",{ name:"检查通过",exact:true })).toBeVisible(); await dialog.getByLabel("新项目名称",{ exact:true }).fill("独立交付验证");
    await page.screenshot({ path:testInfo.outputPath("package-inspection-preview.png") }); await dialog.getByRole("button",{ name:"安装为新项目",exact:true }).click(); await expect(dialog.getByRole("heading",{ name:"安装完成，尚未激活",exact:true })).toBeVisible();
    const installedProject = (await (await api.get("/api/v1/projects")).json()).projects[0],path = `/api/v1/projects/${installedProject.id}`;
    await context.close(); context = undefined; await api.dispose();
    const endpoints = Object.fromEntries(sources.map((source:{ id:string;config:{ url:string } }) => [`source-${source.id}`,{ projectIds:[installedProject.id],url:source.config.url }])); await target.setSources({ version:1,endpoints,credentials:{} }); const url = await target.restart(); api = await apiRequest.newContext({ baseURL:url,storageState:identity });
    context = await browser.newContext({ storageState:identity,viewport:{ width:1440,height:1000 } }); page = await context.newPage(); await page.goto(`${url}/#/projects/${installedProject.id}/canvas`); await page.getByRole("button",{ name:"发布与版本",exact:true }).click();
    let panel = page.getByRole("dialog",{ name:"项目发布与版本",exact:true }); await panel.getByRole("button",{ name:"激活此版本",exact:true }).click(); await expect(panel.getByRole("status")).toContainText("已成为当前发布版本");
    const v1 = (await (await api.get(`${path}/versions`)).json()).active.versionId;
    const running = await context.newPage(); await running.goto(`${url}/#/projects/${installedProject.id}/run`); await expect(running.locator(".runtime-status-banner")).toContainText("在线 2 台"); await expect(running.locator(".model-3d-edit-hint")).toBeVisible();
    await running.getByRole("button",{ name:"选择设备 DEVICE-002",exact:true }).click(); await expect(running.locator('[data-node-id="selected-metric"] .dashboard-metric-value')).toContainText(/6\d/); await running.screenshot({ path:testInfo.outputPath("clean-runtime-independent-project.png") });
    await panel.getByRole("button",{ name:"恢复为草稿",exact:true }).click(); await expect(panel.getByRole("region",{ name:"草稿恢复预览",exact:true })).toBeVisible(); await panel.getByRole("button",{ name:"确认替换草稿",exact:true }).click(); await expect(page.locator('.canvas-node[data-node-id="demo-model"]')).toBeVisible();
    const restored = (await (await api.get(`${path}/definition`)).json()).definition; expect(restored.pages[0].nodes).toHaveLength(demo.canvas.nodes.length); expect((await (await api.get(`${path}/assets`)).json()).assets).toHaveLength(2);
    await page.getByRole("button",{ name:"发布与版本",exact:true }).click(); panel = page.getByRole("dialog",{ name:"项目发布与版本",exact:true }); await panel.getByRole("button",{ name:"从项目包安装版本",exact:true }).click(); dialog = page.getByRole("dialog",{ name:"导入项目包",exact:true });
    await dialog.getByLabel("项目包 ZIP",{ exact:true }).setInputFiles({ name:"upgrade.zip",mimeType:"application/zip",buffer:secondZip }); await dialog.getByRole("button",{ name:"上传并检查项目包",exact:true }).click(); await dialog.getByRole("button",{ name:"安装为新版本",exact:true }).click(); await expect(dialog.getByRole("heading",{ name:"安装完成，尚未激活",exact:true })).toBeVisible();
    expect((await (await api.get(`${path}/definition`)).json()).definition).toEqual(restored); expect((await (await api.get(`${path}/versions`)).json()).active.versionId).toBe(v1);
    await dialog.getByRole("button",{ name:"关闭项目包导入",exact:true }).click(); panel = page.getByRole("dialog",{ name:"项目发布与版本",exact:true });
    const v2 = (await (await api.get(`${path}/versions`)).json()).versions.find((version:{ id:string }) => version.id !== v1);
    // Closing import refreshes the list asynchronously; target the newly installed identity, not the still-visible old first row.
    await panel.locator(`[data-version-id="${v2.id}"]`).getByRole("button",{ name:"激活此版本",exact:true }).click();
    await expect(panel.getByRole("status")).toContainText(`版本 ${v2.versionNumber} 已成为当前发布版本`);
    await panel.locator(`[data-version-id="${v1}"]`).getByRole("button",{ name:"回滚到此版本",exact:true }).click(); await expect(panel.getByRole("status")).toContainText("版本 1 已成为当前发布版本");
  } finally { await context?.close(); await original.dispose(); await api.dispose(); if (!sourceClosed) await source.dispose(); await target.dispose(); }
});
