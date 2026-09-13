import { createHash,randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir,writeFile,readFile,stat,rename,rm } from "node:fs/promises";
import { join,resolve } from "node:path";
import { Readable } from "node:stream";
import type { ObjectBucket,ObjectBody } from "../../api/src/auth";

type Metadata = { key: string; size: number; sha256: string; contentType: string; custom: Record<string,string> };
export class FileBucket implements ObjectBucket {
  readonly root: string;
  constructor(root: string) { this.root = resolve(root); }
  private location(key: string) {
    if (typeof key !== "string" || !key || key.length > 2048) throw new Error("Invalid storage object key.");
    const digest = createHash("sha256").update(key).digest("hex");
    // User-facing keys never become filesystem paths.
    return { parent: join(this.root,digest.slice(0,2)),directory: join(this.root,digest.slice(0,2),digest) };
  }
  async put(key: string,value: ArrayBuffer,options: { httpMetadata: { contentType: string }; customMetadata: Record<string,string> }) {
    const { parent,directory } = this.location(key),temporary = join(parent,`.pending-${randomUUID()}`);
    if (!options.httpMetadata.contentType || /[\r\n]/.test(options.httpMetadata.contentType)) throw new Error("Invalid object content type.");
    await mkdir(parent,{ recursive: true,mode: 0o700 }); await mkdir(temporary,{ mode: 0o700 });
    const bytes = Buffer.from(value), sha256 = createHash("sha256").update(bytes).digest("hex");
    const metadata: Metadata = { key,size: bytes.length,sha256,contentType: options.httpMetadata.contentType,custom: options.customMetadata };
    try {
      await writeFile(join(temporary,"content"),bytes,{ flag: "wx",mode: 0o600 });
      await writeFile(join(temporary,"metadata.json"),JSON.stringify(metadata),{ flag: "wx",mode: 0o600 });
      await rename(temporary,directory); // Existing immutable objects cannot be replaced.
    } catch (reason) {
      try { await rm(temporary,{ recursive: true,force: true }); }
      catch (cleanup) { throw new AggregateError([reason,cleanup],"Object write failed and its temporary files could not be removed."); }
      throw reason;
    }
    return { httpEtag: `"${sha256}"`,size: bytes.length };
  }
  async get(key: string): Promise<ObjectBody | null> {
    const { directory } = this.location(key);
    let serialized: string;
    try { serialized = await readFile(join(directory,"metadata.json"),"utf8"); }
    catch (reason) { if ((reason as NodeJS.ErrnoException).code === "ENOENT") return null; throw reason; }
    const metadata = JSON.parse(serialized) as Metadata;
    const info = await stat(join(directory,"content"));
    if (metadata.key !== key || metadata.size !== info.size || !/^[a-f0-9]{64}$/.test(metadata.sha256) || typeof metadata.contentType !== "string" || /[\r\n]/.test(metadata.contentType)) throw new Error("Storage object metadata is inconsistent.");
    return { size: info.size,httpEtag: `"${metadata.sha256}"`,body: Readable.toWeb(createReadStream(join(directory,"content"))) as ReadableStream,
      writeHttpMetadata: (headers) => { headers.set("content-type",metadata.contentType); } };
  }
  async delete(key: string) { await rm(this.location(key).directory,{ recursive: true,force: true }); }
}
