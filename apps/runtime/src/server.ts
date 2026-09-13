import { createServer,type IncomingMessage,type ServerResponse } from "node:http";
import { once } from "node:events";
import { mkdir,readFile,stat,realpath } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname,extname,resolve,sep,join } from "node:path";
import { fileURLToPath,pathToFileURL } from "node:url";
import { parseArgs,parseEnv } from "node:util";
import { Readable } from "node:stream";
import api from "../../api/src/index";
import type { AppEnv } from "../../api/src/auth";
import { createSourceResolver,parseSourceEnvironment } from "./source-environment";
import { openWebSocketSource } from "./websocket-source";
import { RuntimeCollector } from "./collector";
import { SqliteDatabase } from "./sqlite-database";
import { FileBucket } from "./file-bucket";
import { migrateRuntimeDatabase } from "./migrations";

export type RuntimeOptions = {
  dataDirectory: string;
  sourceEnvironment?: unknown;
  publicDirectory?: string;
  migrationsDirectory?: string;
  host?: string;
  port?: number;
  publicOrigin?: string;
  environment?: Pick<AppEnv,"BOOTSTRAP_TOKEN" | "RUNTIME_POLLING_ENABLED" | "RUNTIME_ALLOWED_HOSTS" | "SESSION_TTL_HOURS">;
};
const contentTypes: Record<string,string> = { ".html": "text/html; charset=utf-8",".js": "application/javascript; charset=utf-8",".mjs": "application/javascript; charset=utf-8",".css": "text/css; charset=utf-8",".svg": "image/svg+xml",".png": "image/png",".jpg": "image/jpeg",".jpeg": "image/jpeg",".webp": "image/webp",".ico": "image/x-icon",".woff2": "font/woff2",".json": "application/json" };
const notFound = () => new Response("Not found",{ status: 404,headers: { "content-type": "text/plain; charset=utf-8" } });

function incomingBody(request: IncomingMessage,response:ServerResponse): ReadableStream<Uint8Array> {
  let cleanup = () => {};
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const data = (chunk: Buffer) => { controller.enqueue(chunk); if ((controller.desiredSize ?? 0) <= 0) request.pause(); };
      const end = () => { cleanup(); controller.close(); };
      const error = (reason: Error) => { cleanup(); controller.error(reason); };
      cleanup = () => { request.off("data",data); request.off("end",end); request.off("error",error); };
      request.on("data",data); request.once("end",end); request.once("error",error);
    },
    pull() { request.resume(); },
    cancel() {
      cleanup();
      // Stop consuming a rejected upload, but let its final HTTP error flush.
      response.setHeader("connection","close"); response.shouldKeepAlive = false;
      request.once("error",() => {}); request.pause();
    },
  },{ highWaterMark: 65536,size: (chunk) => chunk.byteLength });
}

async function staticResponse(pathname: string,method: string,publicDirectory: string): Promise<Response> {
  if (method !== "GET" && method !== "HEAD") return new Response("Method not allowed",{ status: 405,headers: { allow: "GET, HEAD" } });
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return notFound(); }
  if (decoded.includes("\0") || decoded.includes("\\") || decoded.split("/").some((part) => part.startsWith("."))) return notFound();
  let filename = resolve(publicDirectory,decoded.replace(/^\/+/,"") || "index.html");
  if (!filename.startsWith(publicDirectory+sep)) return notFound();
  try {
    let info;
    try { info = await stat(filename); }
    catch (reason) { if ((reason as NodeJS.ErrnoException).code !== "ENOENT" || extname(decoded)) return notFound(); filename = join(publicDirectory,"index.html"); info = await stat(filename); }
    if (!info.isFile()) return notFound();
    const actual = await realpath(filename);
    if (!actual.startsWith(publicDirectory+sep)) return notFound();
    return new Response(method === "HEAD" ? null : Readable.toWeb(createReadStream(actual)) as ReadableStream,{ headers: {
      "content-type": contentTypes[extname(filename)] ?? "application/octet-stream","content-length": String(info.size),
      "cache-control": filename.endsWith("index.html") ? "no-store" : /[/\\]assets[/\\]/.test(filename) ? "public, max-age=31536000, immutable" : "no-cache",
      "x-content-type-options": "nosniff",
    } });
  } catch (reason) { if ((reason as NodeJS.ErrnoException).code === "ENOENT") return notFound(); throw reason; }
}

function responseChunk(reader: ReadableStreamDefaultReader<Uint8Array>,signal: AbortSignal): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve,reject) => {
    let settled = false;
    const finish = () => { settled = true; signal.removeEventListener("abort",abort); };
    const abort = () => {
      if (settled) return; finish();
      reject(signal.reason ?? new DOMException("Response cancelled","AbortError"));
      void reader.cancel(signal.reason).catch(() => {});
    };
    signal.addEventListener("abort",abort,{ once: true });
    if (signal.aborted) { abort(); return; }
    void reader.read().then((chunk) => { if (!settled) { finish(); resolve(chunk); } },(reason) => { if (!settled) { finish(); reject(reason); } });
  });
}

export async function writeRuntimeResponse(response: Response,target: ServerResponse,signal: AbortSignal) {
  target.statusCode = response.status;
  response.headers.forEach((value,name) => { if (!["set-cookie","connection","transfer-encoding"].includes(name)) target.setHeader(name,value); });
  const cookies = response.headers.getSetCookie(); if (cookies.length) target.setHeader("set-cookie",cookies);
  const reader = response.body?.getReader(); let completed = false;
  try {
    if (reader) while (true) {
      const chunk = await responseChunk(reader,signal); if (chunk.done) { completed = true; break; }
      if (!target.write(chunk.value)) await once(target,"drain",{ signal });
    }
    target.end();
  } finally {
    if (reader) { if (!completed) void reader.cancel(signal.reason).catch(() => {}); reader.releaseLock(); }
  }
}

export async function startRuntime(options: RuntimeOptions) {
  const [major,minor] = process.versions.node.split(".").map(Number);
  if (major !== 24 || minor < 18) throw new Error("This runtime requires Node.js 24.18 or later in the Node 24 series.");
  if (!options.dataDirectory) throw new Error("A runtime data directory is required.");
  const resolver = createSourceResolver(parseSourceEnvironment(options.sourceEnvironment ?? { version:1,endpoints:{},credentials:{} }));
  const port = options.port ?? 8792;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Runtime port must be an integer between 0 and 65535.");
  let origin = "";
  if (options.publicOrigin) {
    const value = new URL(options.publicOrigin);
    if (!/^https?:$/.test(value.protocol) || value.username || value.password || value.pathname !== "/" || value.search || value.hash) throw new Error("Public origin must be an HTTP(S) origin without credentials, path or query.");
    origin = value.origin;
  }
  const bundle = dirname(fileURLToPath(import.meta.url));
  const dataDirectory = resolve(options.dataDirectory),publicDirectory = await realpath(options.publicDirectory ?? join(bundle,"public"));
  const migrationsDirectory = resolve(options.migrationsDirectory ?? join(bundle,"migrations"));
  await stat(join(publicDirectory,"index.html"));
  if (dataDirectory === publicDirectory || dataDirectory.startsWith(publicDirectory+sep)) throw new Error("Runtime data must be outside the public asset directory.");
  await mkdir(dataDirectory,{ recursive: true,mode: 0o700 });
  const actualData = await realpath(dataDirectory);
  if (actualData === publicDirectory || actualData.startsWith(publicDirectory+sep)) throw new Error("Runtime data must not resolve inside public assets.");
  const databasePath = join(dataDirectory,"config.sqlite");
  const migration = await migrateRuntimeDatabase(databasePath,migrationsDirectory);
  const database = new SqliteDatabase(databasePath);
  const env: AppEnv = { ...options.environment,RESOLVE_SOURCE:resolver,DB: database,PROJECT_FILES: new FileBucket(join(dataDirectory,"objects")) };
  env.OPEN_WEBSOCKET_SOURCE = (source,requestId,onSample,signal) => openWebSocketSource(env,source,requestId,onSample,signal);
  const collector = new RuntimeCollector(env); env.CENTRAL_RUNTIME = collector;
  try { await collector.start(); } catch (reason) { await collector.close(); database.close(); throw reason; }
  const requests = new Set<AbortController>();
  const handlers = new Set<Promise<void>>();
  let stopping = false;
  const server = createServer({ requestTimeout: 30000,headersTimeout: 15000 },(incoming,outgoing) => {
    if (stopping) { incoming.resume(); outgoing.writeHead(503,{ connection: "close" }); outgoing.end("Runtime is stopping"); return; }
    const controller = new AbortController(); requests.add(controller);
    incoming.once("aborted",() => controller.abort());
    outgoing.once("close",() => { if (!outgoing.writableEnded) controller.abort(); requests.delete(controller); });
    outgoing.once("finish",() => requests.delete(controller));
    const handler = (async () => {
      const url = new URL(incoming.url ?? "/",origin);
      if (url.origin !== new URL(origin).origin || url.username || url.password) { incoming.resume(); outgoing.writeHead(400); outgoing.end("Invalid request target"); return; }
      const headers = new Headers();
      for (let index = 0; index < incoming.rawHeaders.length; index+=2) headers.append(incoming.rawHeaders[index],incoming.rawHeaders[index+1]);
      const method = incoming.method ?? "GET";
      if (!["GET","HEAD","POST","PATCH","PUT","DELETE","OPTIONS"].includes(method)) { incoming.resume(); outgoing.writeHead(405); outgoing.end("Method not allowed"); return; }
      const request = new Request(url,{ method,headers,signal: controller.signal,...(!["GET","HEAD"].includes(method) ? { body: incomingBody(incoming,outgoing),duplex: "half" } : {}) } as RequestInit);
      let response = url.pathname.startsWith("/api/") || url.pathname === "/api" || url.pathname === "/health" ? await api.fetch(request,env) : await staticResponse(url.pathname,method,publicDirectory);
      const dataMutation = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)(?:\/(?:data-sources|assets)(?:\/|$)|$)/);
      if (response.ok && !["GET","HEAD","OPTIONS"].includes(method) && dataMutation && !url.pathname.endsWith("/test")) await collector.refresh(decodeURIComponent(dataMutation[1]));
      if (request.body && !request.body.locked) { if (!request.bodyUsed) outgoing.setHeader("connection","close"); await request.body.cancel(); }
      if (url.pathname === "/health" && response.ok) response = new Response(JSON.stringify({ ...await response.json() as object,runtime: { host: "node",database: "sqlite",collection: "central" } }),{ status: response.status,headers: response.headers });
      await writeRuntimeResponse(response,outgoing,controller.signal);
    })().catch((reason) => {
      if (!controller.signal.aborted) console.error(JSON.stringify({ event: "runtime_http_error",path: incoming.url?.split("?")[0],message: reason instanceof Error ? reason.message : String(reason) }));
      if (!outgoing.headersSent && !outgoing.destroyed) { outgoing.writeHead(500,{ "content-type": "application/json" }); outgoing.end(JSON.stringify({ error: "runtime_http_error",message: "The runtime could not complete this request." })); }
      else outgoing.destroy();
    }).finally(() => handlers.delete(handler));
    handlers.add(handler);
  });
  try {
    server.listen(port,options.host ?? "127.0.0.1"); await once(server,"listening");
  } catch (reason) { await collector.close(); database.close(); throw reason; }
  const address = server.address(); if (!address || typeof address === "string") { database.close(); throw new Error("Runtime did not bind a TCP address."); }
  const localUrl = `http://${address.family === "IPv6" ? `[${address.address}]` : address.address}:${address.port}`;
  origin ||= localUrl;
  let closing: Promise<void> | null = null;
  const close = async () => {
    stopping = true;
    const stopped = new Promise<void>((resolve) => server.close(() => resolve()));
    requests.forEach((request) => request.abort()); server.closeAllConnections(); await stopped;
    const settled = Promise.allSettled([...handlers,collector.close()]);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([settled,new Promise<never>((_,reject) => { timeout = setTimeout(() => reject(new Error("Runtime requests did not stop within ten seconds; database closure is deferred until they finish.")),10000); })]);
      database.close();
    } catch (reason) { void settled.then(() => database.close()); throw reason; }
    finally { clearTimeout(timeout); }
  };
  return { url: localUrl,environment: env,migration,databasePath,
    close: () => closing ??= close(),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { "data-dir": { type: "string" },config: { type: "string" },sources: { type: "string" },host: { type: "string" },port: { type: "string" },"public-origin": { type: "string" } } });
  const configPath = values.config ?? process.env.NEWPOWER_RUNTIME_CONFIG;
  if (configPath) {
    const file = await realpath(resolve(configPath)),publicRoot = await realpath(fileURLToPath(new URL("./public",import.meta.url)));
    if (file.startsWith(publicRoot+sep)) throw new Error("Runtime environment files must remain outside public assets.");
  }
  const configuration = configPath ? parseEnv(await readFile(resolve(configPath),"utf8")) : {};
  const sourceFile = values.sources ?? configuration.SOURCE_ENVIRONMENT_FILE;
  let sourceEnvironment: unknown;
  if (sourceFile) {
    const file = await realpath(resolve(configPath ? dirname(resolve(configPath)) : process.cwd(),sourceFile));
    const publicRoot = await realpath(fileURLToPath(new URL("./public",import.meta.url)));
    if (file.startsWith(publicRoot+sep) || !(await stat(file)).isFile() || (await stat(file)).size > 1024*1024) throw new Error("Source environment must be a private JSON file outside public assets, at most 1 MiB.");
    try { sourceEnvironment = JSON.parse(await readFile(file,"utf8")); } catch { throw new Error("Source environment JSON could not be read or parsed."); }
  }
  const dataDirectory = values["data-dir"] ?? process.env.NEWPOWER_RUNTIME_DIR;
  if (!dataDirectory) throw new Error("Use --data-dir or NEWPOWER_RUNTIME_DIR to select an isolated runtime directory.");
  const runtime = await startRuntime({ dataDirectory,sourceEnvironment,host: values.host ?? process.env.NEWPOWER_RUNTIME_HOST,port: Number(values.port ?? process.env.NEWPOWER_RUNTIME_PORT ?? 8792),publicOrigin: values["public-origin"] ?? configuration.PUBLIC_ORIGIN,
    environment: { BOOTSTRAP_TOKEN: configuration.BOOTSTRAP_TOKEN,RUNTIME_POLLING_ENABLED: configuration.RUNTIME_POLLING_ENABLED,RUNTIME_ALLOWED_HOSTS: configuration.RUNTIME_ALLOWED_HOSTS,SESSION_TTL_HOURS: configuration.SESSION_TTL_HOURS } });
  console.log(JSON.stringify({ event: "runtime_listening",url: runtime.url,migrations: runtime.migration.applied,verifiedBackup: runtime.migration.backupPath }));
  const stop = () => { void runtime.close().then(() => { process.exitCode = 0; },(reason) => { console.error(String(reason)); process.exitCode = 1; }); };
  process.once("SIGINT",stop); process.once("SIGTERM",stop);
}
