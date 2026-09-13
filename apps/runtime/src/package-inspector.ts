import { MeshoptDecoder } from "meshoptimizer/decoder";
import { openPromise,type Entry,type ZipFile } from "yauzl";
import { crc32 } from "node:zlib";
import { createHash } from "node:crypto";
import { mkdir,writeFile,rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { Readable,Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AppError } from "../../api/src/auth";
import { parseProjectPackageManifest,MAX_PACKAGE_BYTES,MAX_PACKAGE_ENTRIES,type ProjectPackageManifest } from "../../../shared/project-package";
import { MAX_RUNTIME_SNAPSHOT_BYTES } from "../../../shared/runtime-project";
import { verifyPackagedModel,verifyPackagedImage } from "../../api/src/package-resource-validation";

export type InspectedPackage = { manifest:ProjectPackageManifest;wireManifest?:unknown;resources:Record<string,string> };
const MANIFEST_LIMIT = MAX_RUNTIME_SNAPSHOT_BYTES+1024*1024;
const closeZip = (zip:ZipFile) => new Promise<void>((resolve) => { if (!zip.isOpen) { resolve(); return; } zip.once("close",resolve); zip.close(); });
const invalid = (message:string) => new AppError(400,"invalid_project_package",message);

async function readEntry(zip:ZipFile,entry:Entry,limit:number,signal:AbortSignal):Promise<Buffer> {
  signal.throwIfAborted();
  if (entry.uncompressedSize > limit) throw invalid("An archive entry exceeds its allowed size.");
  const stream = await zip.openReadStreamPromise(entry); let bytes = 0,crc = 0; const chunks:Buffer[] = [];
  const cancel = () => stream.destroy(new DOMException("Import cancelled","AbortError")); signal.addEventListener("abort",cancel,{ once:true });
  try {
    if (signal.aborted) cancel();
    for await (const value of stream) { const chunk = Buffer.from(value); bytes+=chunk.length; if (bytes > limit || bytes > entry.uncompressedSize) throw invalid("An archive entry exceeds its declared size."); crc = crc32(chunk,crc); chunks.push(chunk); }
    if (bytes !== entry.uncompressedSize || crc !== entry.crc32) throw invalid("Archive entry size or CRC validation failed.");
    return Buffer.concat(chunks,bytes);
  } finally { signal.removeEventListener("abort",cancel); stream.destroy(); }
}

/** Archive paths are only lookup keys. Extracted bytes go to generated private
 * filenames; no entry name, permission bit or link target is used for writes. */
export async function inspectPackageRequest(request:Request,directory:string,onCreated?:() => Promise<void>):Promise<InspectedPackage> {
  await mkdir(directory,{ recursive:false,mode:0o700 });
  const archive = join(directory,"archive.zip"); let zip:ZipFile|undefined,phase = "upload";
  try {
    await onCreated?.();
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_PACKAGE_BYTES) throw new AppError(413,"project_package_too_large","Package upload exceeds 512 MiB.");
    if (!request.body) throw invalid("Upload a ZIP package body.");
    let received = 0;
    const limiter = new Transform({ transform(chunk:Buffer,_,callback) { received+=chunk.length; callback(received > MAX_PACKAGE_BYTES ? new AppError(413,"project_package_too_large","Package upload exceeds 512 MiB.") : null,chunk); } });
    await pipeline(Readable.fromWeb(request.body as import("node:stream/web").ReadableStream),limiter,createWriteStream(archive,{ flags:"wx",mode:0o600 }),{ signal:request.signal });
    phase = "central-directory";
    zip = await openPromise(archive,{ autoClose:false,lazyEntries:true,decodeStrings:true,validateEntrySizes:true,strictFileNames:true });
    let archiveError:Error|undefined; zip.on("error",(error:Error) => { archiveError = error; });
    if (zip.entryCount > MAX_PACKAGE_ENTRIES) throw invalid("Too many ZIP entries.");
    const entries = new Map<string,Entry>(); let expanded = 0;
    for await (const entry of zip.eachEntry()) {
      request.signal.throwIfAborted();
      const type = (entry.externalFileAttributes >>> 16) & 0xf000;
      if (![0,0x8000].includes(type) || (entry.externalFileAttributes & 0x10) || (entry.generalPurposeBitFlag & 1) || ![0,8].includes(entry.compressionMethod) || entry.fileName.includes("\\") || entries.has(entry.fileName)
        || !(entry.fileName === "manifest.json" || /^resources\/(model|image)\/[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(entry.fileName))) throw invalid("Unsupported, duplicated or unsafe ZIP entry.");
      expanded+=entry.uncompressedSize;
      if (expanded > MAX_PACKAGE_BYTES || entry.uncompressedSize > (entry.fileName === "manifest.json" ? MANIFEST_LIMIT : 25*1024*1024)) throw invalid("Archive expansion exceeds its byte budget.");
      entries.set(entry.fileName,entry);
    }
    if (archiveError) throw archiveError;
    const manifestEntry = entries.get("manifest.json"); if (!manifestEntry) throw invalid("Package manifest is missing.");
    phase = "manifest";
    const metadata = await readEntry(zip,manifestEntry,MANIFEST_LIMIT,request.signal);
    let manifest:ProjectPackageManifest,wireManifest:unknown;
    try { wireManifest = JSON.parse(new TextDecoder("utf-8",{ fatal:true }).decode(metadata)); manifest = parseProjectPackageManifest(wireManifest); }
    catch (reason) { throw invalid(reason instanceof Error ? reason.message : "Invalid package manifest."); }
    if (entries.size !== manifest.files.length+1 || manifest.files.some((file) => !entries.has(file.path))) throw invalid("Archive entries do not match the manifest.");
    const resources:Record<string,string> = Object.create(null);
    for (let index = 0; index < manifest.files.length; index++) {
      const file = manifest.files[index]; phase = `resource-${file.kind}`; const entry = entries.get(file.path)!;
      if (entry.uncompressedSize !== file.byteSize) throw invalid("Resource length does not match its manifest.");
      const bytes = await readEntry(zip,entry,file.byteSize,request.signal);
      if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw invalid("Resource SHA256 validation failed.");
      if (file.kind === "model") await verifyPackagedModel(bytes,manifest.snapshot.resources.models.find((model) => model.id === file.id)!,manifest.snapshot.legacyModelNames[file.id],{meshopt:MeshoptDecoder});
      else verifyPackagedImage(bytes,manifest.snapshot.resources.images.find((image) => image.id === file.id)!);
      request.signal.throwIfAborted(); const name = `resource-${index}.bin`; await writeFile(join(directory,name),bytes,{ flag:"wx",mode:0o600 }); resources[file.path] = name;
    }
    await closeZip(zip); zip = undefined; await rm(archive);
    await writeFile(join(directory,"inspected.json"),JSON.stringify({ manifest,...(manifest.snapshot.snapshotVersion === 2 ? { wireManifest }:{}),resources }),{ flag:"wx",mode:0o600 });
    return { manifest,...(manifest.snapshot.snapshotVersion === 2 ? { wireManifest }:{}),resources };
  } catch (reason) {
    if (zip) await closeZip(zip);
    console.error(JSON.stringify({ event:"package_validation_failed",phase,errorCode:reason instanceof AppError ? reason.code : "package_validation_error",stack:reason instanceof Error ? reason.stack?.split("\n").filter((line) => line.trim().startsWith("at ")).slice(0,4) : [] }));
    try { await rm(directory,{ recursive:true,force:true }); } catch (cleanup) { throw new AggregateError([reason,cleanup],"Package validation failed and its private staging directory could not be cleaned."); }
    if (request.signal.aborted) throw new AppError(499,"package_import_cancelled","Package import cancelled.");
    if (reason instanceof AppError) throw reason;
    throw invalid("ZIP or resource validation failed. Check the package format and file integrity.");
  }
}
