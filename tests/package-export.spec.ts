import { test,expect,request as apiRequest } from "@playwright/test";
import { randomBytes,createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { nodeRuntimeFixture } from "./node-runtime-fixture";
import { createDemo } from "./demo";
import { parseProjectPackageManifest,remapPackageSnapshot } from "../shared/project-package";

test("downloaded ZIP carries the frozen snapshot and verified resource bytes, with direct endpoints externalized",async ({ browser },testInfo) => {
  const runtime = await nodeRuntimeFixture(testInfo),api = await apiRequest.newContext({ baseURL:runtime.url }); let context:Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    expect((await api.post("/api/v1/auth/bootstrap",{ headers:{ "x-bootstrap-token":runtime.bootstrap },data:{ email:"package@example.invalid",password:randomBytes(24).toString("hex"),displayName:"Package owner" } })).status()).toBe(201);
    const demo = await createDemo(api,true),path = `/api/v1/projects/${demo.projectId}`,sources = (await (await api.get(`${path}/data-sources`)).json()).dataSources;
    const draft = (await (await api.get(`${path}/publication-draft`)).json()).draft;
    const created = await api.post(`${path}/versions`,{ data:{ expectedRuntimeRevision:draft.runtimeRevision,label:"Portable delivery" } }); expect(created.status(),await created.text()).toBe(201); const version = (await created.json()).version;
    context = await browser.newContext({ storageState:await api.storageState(),acceptDownloads:true }); const page = await context.newPage();
    await page.goto(`${runtime.url}/#/projects/${demo.projectId}/canvas`); await page.getByRole("button",{ name:"发布与版本",exact:true }).click();
    const downloaded = page.waitForEvent("download"); await page.getByRole("link",{ name:"导出项目包",exact:true }).click(); const download = await downloaded; expect(download.suggestedFilename()).toBe(`newpower-${demo.projectId}-v1.zip`);
    const destination = testInfo.outputPath("exported-project.zip"); await download.saveAs(destination); expect(await download.failure()).toBeNull();
    const files = unzipSync(await readFile(destination)),manifestText = new TextDecoder().decode(files["manifest.json"]),manifest = parseProjectPackageManifest(JSON.parse(manifestText));
    expect(Object.keys(files)).toEqual(["manifest.json",...manifest.files.map((file) => file.path)]);
    expect(manifest.source).toMatchObject({ projectId:demo.projectId,versionId:version.id,snapshotSha256:version.sha256 });
    expect(manifest.requiredEndpoints).toHaveLength(sources.length);
    for (const source of sources) expect(manifestText.includes(source.config.url)).toBe(false);
    expect(manifest.snapshot.dataSources.every((source) => source.config.url === "" && source.config.endpointRef && source.config.credentialRef === null)).toBe(true);
    for (const file of manifest.files) {
      expect(files[file.path].byteLength).toBe(file.byteSize); expect(createHash("sha256").update(files[file.path]).digest("hex")).toBe(file.sha256);
      const original = await api.get(`${path}/${file.kind === "model" ? "model-assets" : "image-assets"}/${file.id}/content`); expect(Buffer.from(files[file.path])).toEqual(await original.body());
    }
    expect((await (await api.get(`${path}/data-sources`)).json()).dataSources).toEqual(sources);
    const badPath = structuredClone(manifest); badPath.files[0].path = "../outside"; expect(() => parseProjectPackageManifest(badPath)).toThrow("文件路径");
    const privateEndpoint = structuredClone(manifest); privateEndpoint.snapshot.dataSources[0].config.url = "http://private.invalid/"; expect(() => parseProjectPackageManifest(privateEndpoint)).toThrow();
    const mapping = { projectId:crypto.randomUUID(),assets:Object.fromEntries(manifest.snapshot.assets.map((asset) => [asset.id,crypto.randomUUID()])),sources:Object.fromEntries(manifest.snapshot.dataSources.map((source) => [source.id,crypto.randomUUID()])),bindings:Object.fromEntries(manifest.snapshot.assetDataBindings.map((binding) => [binding.id,crypto.randomUUID()])),models:Object.fromEntries(manifest.snapshot.resources.models.map((model) => [model.id,crypto.randomUUID()])),images:Object.fromEntries(manifest.snapshot.resources.images.map((image) => [image.id,crypto.randomUUID()])) };
    const mapped = remapPackageSnapshot(manifest.snapshot,mapping,"Imported project",0);
    expect(mapped.project.id).toBe(mapping.projectId); expect(mapped.assets.map((asset) => asset.assetId)).toEqual(manifest.snapshot.assets.map((asset) => asset.assetId));
    expect(mapped.resources.models[0].inspection).toEqual(manifest.snapshot.resources.models[0].inspection); expect(mapped.definition.pages[0].nodes.map((node) => node.id)).toEqual(manifest.snapshot.definition.pages[0].nodes.map((node) => node.id));
    expect(mapped.legacyModelNames[mapping.models[manifest.snapshot.resources.models[0].id]]).toEqual(manifest.snapshot.legacyModelNames[manifest.snapshot.resources.models[0].id]);
    await page.screenshot({ path:testInfo.outputPath("project-package-download.png") });
  } finally { await context?.close(); await api.dispose(); await runtime.dispose(); }
});
