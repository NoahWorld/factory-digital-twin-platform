import { test,expect } from "@playwright/test";
import { readFile,mkdir,stat } from "node:fs/promises";
import { dirname,join } from "node:path";
import { zipSync,strToU8,unzipSync } from "fflate";
import { inspectPackageRequest } from "../apps/runtime/src/package-inspector";
import { createPackageManifest } from "../shared/project-package";
import { emptyProjectDefinition } from "../shared/project-definition";
import { parseRuntimeProjectSnapshot } from "../shared/runtime-project";

const manifest = () => createPackageManifest(parseRuntimeProjectSnapshot({ kind:"newpower.runtime-project",snapshotVersion:1,project:{ id:"project",name:"ZIP inspection",runtimeRevision:0 },definition:emptyProjectDefinition("project"),assets:[],assetDataBindings:[],dataSources:[],resources:{ models:[],images:[] },legacyModelNames:{} }),{ id:"version",projectId:"project",versionNumber:1,label:"Fixture",sourceRevision:0,sha256:"a".repeat(64),createdAt:new Date().toISOString(),active:false });
const request = (bytes:Uint8Array,signal?:AbortSignal) => new Request("http://localhost/import",{ method:"POST",body:bytes as Uint8Array<ArrayBuffer>,signal });

test("ZIP inspector uses central metadata, rejects unsafe archives and cleans only its staging directory",async ({},testInfo) => {
  const root = testInfo.outputPath("imports"); await mkdir(root,{ recursive:true });
  const valid = zipSync({ "manifest.json":strToU8(JSON.stringify(manifest())) },{ level:6 });
  const stage = join(root,"valid"),result = await inspectPackageRequest(request(valid),stage); expect(result.manifest.snapshot.project.name).toBe("ZIP inspection"); expect(result.resources).toEqual({}); expect((await stat(join(stage,"inspected.json"))).mode & 0o777).toBe(0o600); await expect(stat(join(stage,"archive.zip"))).rejects.toThrow();
  const files = unzipSync(valid);
  const cases = [
    valid.slice(0,-22),
    zipSync({ ...files,"../outside":strToU8("escape") }),
    zipSync({ ...files,"resources/model/symlink":[strToU8("../../outside"),{ os:3,attrs:0xa1ff << 16 }] }),
    zipSync({ "manifest.json":strToU8(JSON.stringify({ ...manifest(),packageVersion:999 })) }),
    zipSync({ "manifest.json":strToU8(JSON.stringify(manifest())),unexpected:strToU8("extra") }),
  ];
  for (const [index,bytes] of cases.entries()) {
    const directory = join(root,`invalid-${index}`); await expect(inspectPackageRequest(request(bytes),directory)).rejects.toThrow(); await expect(stat(directory)).rejects.toThrow();
  }
  expect(JSON.parse(await readFile(join(stage,"inspected.json"),"utf8")).manifest.packageVersion).toBe(1);
});

test("ZIP CRC mismatches and cancellation never leave a validated package",async ({},testInfo) => {
  const root = testInfo.outputPath("imports"); await mkdir(root,{ recursive:true });
  const bytes = zipSync({ "manifest.json":strToU8(JSON.stringify(manifest())) },{ level:0 });
  const marker = Buffer.from(bytes).indexOf(Buffer.from("ZIP inspection")); expect(marker).toBeGreaterThan(0); bytes[marker] ^= 1;
  const corrupt = join(root,"corrupt"); await expect(inspectPackageRequest(request(bytes),corrupt)).rejects.toMatchObject({ code:"invalid_project_package" }); await expect(stat(corrupt)).rejects.toThrow();
  const controller = new AbortController(); let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(value) { value.enqueue(new Uint8Array([0x50,0x4b])); },cancel() { cancelled = true; } });
  const pending = inspectPackageRequest(new Request("http://localhost/import",{ method:"POST",body,duplex:"half",signal:controller.signal } as RequestInit),join(root,"cancelled"));
  await new Promise((resolve) => setTimeout(resolve,30)); controller.abort(); await expect(pending).rejects.toMatchObject({ code:"package_import_cancelled" }); expect(cancelled).toBe(true); await expect(stat(join(root,"cancelled"))).rejects.toThrow();
});

test("ZIP duplicate names and expansion budgets are rejected before resource installation",async ({},testInfo) => {
  const root = testInfo.outputPath("imports"); await mkdir(root,{ recursive:true });
  const metadata = strToU8(JSON.stringify(manifest()));
  const duplicate = Buffer.from(zipSync({ "manifest.json":metadata,"manifest.jsox":metadata },{ level:0 }));
  for (let offset = duplicate.indexOf("manifest.jsox"); offset >= 0; offset = duplicate.indexOf("manifest.jsox",offset+1)) duplicate[offset+12] = "n".charCodeAt(0);
  await expect(inspectPackageRequest(request(duplicate),join(root,"duplicate"))).rejects.toMatchObject({ code:"invalid_project_package" });
  const tooLarge = Buffer.from(zipSync({ "manifest.json":metadata },{ level:8 }));
  const central = tooLarge.indexOf(Buffer.from([0x50,0x4b,0x01,0x02])); expect(central).toBeGreaterThan(0); tooLarge.writeUInt32LE(513*1024*1024,central+24);
  await expect(inspectPackageRequest(request(tooLarge),join(root,"expanded"))).rejects.toMatchObject({ code:"invalid_project_package" });
  const encrypted = Buffer.from(zipSync({ "manifest.json":metadata },{ level:0 })); const encryptedCentral = encrypted.indexOf(Buffer.from([0x50,0x4b,0x01,0x02])); encrypted.writeUInt16LE(encrypted.readUInt16LE(encryptedCentral+8)|1,encryptedCentral+8);
  await expect(inspectPackageRequest(request(encrypted),join(root,"encrypted"))).rejects.toMatchObject({ code:"invalid_project_package" });
});
