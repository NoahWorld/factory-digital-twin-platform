import { test,expect,request as apiRequest } from "@playwright/test";
import { randomBytes,createHash } from "node:crypto";
import { readFile,stat } from "node:fs/promises";
import { join } from "node:path";
import { nodeRuntimeFixture } from "./node-runtime-fixture";
import { createDemo } from "./demo";

test("process death after object write leaves a durable journal and restart cleans the uncommitted object before retry",async ({},testInfo) => {
  const source = await nodeRuntimeFixture(testInfo),target = await nodeRuntimeFixture({ ...testInfo,outputPath:(...parts:string[]) => testInfo.outputPath("target",...parts) } as typeof testInfo);
  const original = await apiRequest.newContext({ baseURL:source.url }); let api = await apiRequest.newContext({ baseURL:target.url });
  try {
    for (const [runtime,client,email] of [[source,original,"source-recovery@example.invalid"],[target,api,"target-recovery@example.invalid"]] as const) expect((await client.post("/api/v1/auth/bootstrap",{ headers:{ "x-bootstrap-token":runtime.bootstrap },data:{ email,password:randomBytes(24).toString("hex"),displayName:"Recovery fixture" } })).status()).toBe(201);
    const demo = await createDemo(original,true),path = `/api/v1/projects/${demo.projectId}`,draft = (await (await original.get(`${path}/publication-draft`)).json()).draft;
    const version = (await (await original.post(`${path}/versions`,{ data:{ expectedRuntimeRevision:draft.runtimeRevision,label:"Crash fixture" } })).json()).version;
    const archive = await (await original.get(`${path}/versions/${version.id}/package`)).body();
    const inspected = await api.post("/api/v1/project-packages",{ data:archive,headers:{ "content-type":"application/zip" } }); expect(inspected.status(),await inspected.text()).toBe(201); const inspection = (await inspected.json()).inspection;
    const identity = await api.storageState(); await api.dispose(); const crashUrl = await target.restart(true); api = await apiRequest.newContext({ baseURL:crashUrl,storageState:identity });
    const install = await api.post("/api/v1/project-packages/install",{ data:{ inspectionId:inspection.id,projectName:"Recoverable import" } }).catch(() => null); expect(install).toBeNull();
    const journalPath = join(target.dataDirectory,"project-imports",inspection.id,"install-journal.json"),journal = JSON.parse(await readFile(journalPath,"utf8")); expect(journal.completed).toBe(false); expect(journal.objects).toHaveLength(1);
    const keyHash = createHash("sha256").update(journal.objects[0].key).digest("hex"),objectPath = join(target.dataDirectory,"objects",keyHash.slice(0,2),keyHash); expect((await stat(objectPath)).isDirectory()).toBe(true);
    await api.dispose(); const recoveredUrl = await target.restart(); api = await apiRequest.newContext({ baseURL:recoveredUrl,storageState:identity });
    await expect(stat(objectPath)).rejects.toThrow(); expect(JSON.parse(await readFile(journalPath,"utf8")).completed).toBe(true);
    expect((await (await api.get("/api/v1/projects")).json()).projects).toEqual([]);
    const retried = await api.post("/api/v1/project-packages/install",{ data:{ inspectionId:inspection.id,projectName:"Recoverable import" } }); expect(retried.status(),await retried.text()).toBe(201); expect((await retried.json()).installation.activated).toBe(false);
  } finally { await api.dispose(); await original.dispose(); await source.dispose(); await target.dispose(); }
});
