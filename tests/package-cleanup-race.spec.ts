import { test,expect } from "@playwright/test";
import { mkdir,writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LocalPackageService } from "../apps/runtime/src/package-service";
import type { AppEnv } from "../apps/api/src/auth";

test("inspection cleanup acquires exclusion before awaiting ownership and cannot delete an active installation's files",async ({},testInfo) => {
  for (const operation of ["prune","discard","install"] as const) {
    const root = testInfo.outputPath(operation),id = crypto.randomUUID(),projectId = crypto.randomUUID(),directory = join(root,id); await mkdir(directory,{ recursive:true });
    await writeFile(join(directory,"owner.json"),JSON.stringify({ userId:"owner",createdAt:Date.now(),expiresAt:Date.now()+60000 }));
    await writeFile(join(directory,"install-journal.json"),JSON.stringify({ projectId,objects:[{ key:`imports/${projectId}/${id}/object` }],completed:false }));
    let removed = 0,release!:()=>void,entered!:()=>void; const gate = new Promise<void>((resolve) => { release = resolve; }),beginning = new Promise<void>((resolve) => { entered = resolve; });
    const env = { DB:{ prepare() { return { bind() { return this; },async first() { return null; } }; } },PROJECT_FILES:{ async delete() { removed++; } } } as unknown as AppEnv;
    const service = new LocalPackageService(env,root),internals = service as unknown as { readOwnerFile(id:string):Promise<unknown>;prune():Promise<void> };
    const original = internals.readOwnerFile.bind(service); internals.readOwnerFile = async (id) => { entered(); await gate; return original(id); };
    const active = (operation === "prune" ? internals.prune() : operation === "discard" ? service.discard(id,"owner") : service.install({ inspectionId:id },"owner",new AbortController().signal)).catch(() => undefined);
    await beginning;
    if (operation === "install") await expect(service.discard(id,"owner")).rejects.toMatchObject({ code:"package_install_in_progress" });
    else await expect(service.install({ inspectionId:id },"owner",new AbortController().signal)).rejects.toMatchObject({ code:"package_install_in_progress" });
    expect(removed).toBe(0); release(); await active;
    expect(removed).toBe(operation === "install" ? 0 : 1);
  }
});
