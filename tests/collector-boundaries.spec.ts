import { test,expect } from "@playwright/test";
import { RuntimeCollector } from "../apps/runtime/src/collector";
import { runtimeStream } from "../apps/api/src/runtime-stream";
import type { AppEnv,Database } from "../apps/api/src/auth";
import type { RuntimeFrame } from "../shared/runtime-stream";

function fixture() {
  const now = new Date().toISOString();
  const asset = { id:"record",project_id:"project",asset_key:"DEVICE",model_node:null,name:"Device",asset_type:"equipment",metadata_json:"{}",created_at:now,updated_at:now };
  const binding = { id:"binding",asset_id:"record",data_source_id:"source",data_source_name:"Source",data_source_type:"rest_polling",metric_key:"value",source_path:"$.value",value_type:"number",unit:null,stale_after_seconds:60,created_at:now,updated_at:now };
  let url = "http://old/",enabled = true,firstSource: (() => Promise<void>) | null = null;
  const DB = { prepare(sql:string) {
    return { bind() { return this; },async first() {
      if (sql.includes("FROM data_sources")) {
        const row = { id:"source",project_id:"project",source_type:"rest_polling",name:"Source",config_json:JSON.stringify({ url,intervalSeconds:60,timeoutMs:1000,timestampPath:null,credentialRef:null }),created_at:now,updated_at:now };
        const wait = firstSource; firstSource = null; await wait?.(); return row;
      }
      return asset;
    },async all() { return { results:sql.includes("json_extract") ? [] : enabled ? [binding] : [] }; } };
  } } as unknown as Database;
  const env:AppEnv = { DB,RUNTIME_POLLING_ENABLED:"true",RUNTIME_ALLOWED_HOSTS:"old,new" };
  return { env,setUrl(value:string) { url = value; },disable() { enabled = false; },gate(operation:() => Promise<void>) { firstSource = operation; } };
}

test("a subscription loading old configuration cannot create an old source after invalidation",async () => {
  const state = fixture(),original = globalThis.fetch,urls:string[] = [];
  let release!:() => void,entered!:() => void;
  const beginning = new Promise<void>((resolve) => { entered = resolve; }),gate = new Promise<void>((resolve) => { release = resolve; });
  state.gate(async () => { entered(); await gate; });
  globalThis.fetch = async (input) => { urls.push(String(input)); return Response.json({ value:42 }); };
  const collector = new RuntimeCollector(state.env),frames:RuntimeFrame[] = [];
  try {
    const pending = collector.subscribe("project",["record"],(frame) => frames.push(frame)); await beginning;
    state.setUrl("http://new/"); const refreshing = collector.refresh("project"); release();
    const subscription = await pending; await refreshing;
    await expect.poll(() => subscription.snapshot().connections.DEVICE?.status).toBe("live");
    expect(urls.length).toBeGreaterThan(0); expect(urls.every((url) => url === "http://new/")).toBe(true);
    state.disable(); await collector.refresh("project");
    const connection = subscription.snapshot().connections.DEVICE;
    expect(connection).toMatchObject({ status:"offline",errorCode:"asset_data_binding_required",snapshot:{ values:{ value:42 } } });
    expect(subscription.snapshot().connections.record).toBeUndefined(); subscription.release();
  } finally { release?.(); await collector.close(); globalThis.fetch = original; }
});

test("late source results cannot replace a newer generation and last release cancels in-flight fetch",async () => {
  const state = fixture(),original = globalThis.fetch;
  let release!:() => void,started!:() => void,oldSignal:AbortSignal | undefined;
  const beginning = new Promise<void>((resolve) => { started = resolve; });
  globalThis.fetch = async (input,init) => {
    if (String(input).includes("old")) { oldSignal = init?.signal as AbortSignal; started(); await new Promise<void>((resolve) => { release = resolve; }); return Response.json({ value:1 }); }
    return Response.json({ value:99 });
  };
  const collector = new RuntimeCollector(state.env);
  try {
    const subscription = await collector.subscribe("project",["record"],() => {}); await beginning;
    state.setUrl("http://new/"); await collector.refresh("project"); expect(oldSignal?.aborted).toBe(true);
    await expect.poll(() => subscription.snapshot().connections.DEVICE?.snapshot?.values.value).toBe(99);
    release(); await new Promise((resolve) => setTimeout(resolve,30)); expect(subscription.snapshot().connections.DEVICE.snapshot?.values.value).toBe(99);
    let nextSignal:AbortSignal | undefined,entered!:() => void;
    const nextStarted = new Promise<void>((resolve) => { entered = resolve; });
    globalThis.fetch = async (_,init) => { nextSignal = init?.signal as AbortSignal; entered(); return new Promise<Response>((_,reject) => nextSignal!.addEventListener("abort",() => reject(new DOMException("Cancelled","AbortError")),{ once:true })); };
    await collector.refresh("project"); await nextStarted; subscription.release(); expect(nextSignal?.aborted).toBe(true);
  } finally { release?.(); await collector.close(); globalThis.fetch = original; }
});

test("oversized initial stream snapshot releases without installing heartbeat timers",async () => {
  const original = globalThis.setInterval; let timers = 0,released = false;
  globalThis.setInterval = ((...args:Parameters<typeof setInterval>) => { timers++; return original(...args); }) as typeof setInterval;
  const small:RuntimeFrame = { epoch:"test",sequence:1,connections:{} };
  const large:RuntimeFrame = { ...small,connections:{ DEVICE:{ status:"offline",failureCount:1,errorMessage:"x".repeat(1024*1024) } } };
  const env = { CENTRAL_RUNTIME:{ async subscribe(_project:string,_ids:string[],changed:(frame:RuntimeFrame) => void) { changed(small); return { snapshot:() => large,release:() => { released = true; } }; } } } as AppEnv;
  try { await expect(runtimeStream(env,new Request("http://localhost/stream?assets=record"),"project",async () => {})).rejects.toMatchObject({ code:"runtime_snapshot_too_large" }); expect(released).toBe(true); expect(timers).toBe(0); }
  finally { globalThis.setInterval = original; }
});

test("slow subscribers retain only the latest full frame and authorization loss releases their source demand",async () => {
  const original = globalThis.setInterval,callbacks:Array<() => void> = [];
  globalThis.setInterval = ((callback:() => void) => { callbacks.push(callback); return 0 as unknown as ReturnType<typeof setInterval>; }) as typeof setInterval;
  let changed!:(frame:RuntimeFrame) => void,released = false;
  const frame = (sequence:number):RuntimeFrame => ({ epoch:"test",sequence,connections:{} });
  const env = { CENTRAL_RUNTIME:{ async subscribe(_project:string,_ids:string[],callback:(frame:RuntimeFrame) => void) { changed = callback; return { snapshot:() => frame(0),release:() => { released = true; } }; } } } as AppEnv;
  try {
    const response = await runtimeStream(env,new Request("http://localhost/stream?assets=record"),"project",async () => { throw new Error("Session revoked"); });
    for (let sequence = 1; sequence <= 100; sequence++) changed(frame(sequence));
    const reader = response.body!.getReader(),decode = (bytes?:Uint8Array) => new TextDecoder().decode(bytes);
    expect(decode((await reader.read()).value)).toContain('"sequence":0');
    expect(decode((await reader.read()).value)).toContain('"sequence":100');
    callbacks[1](); await expect.poll(() => released).toBe(true); expect((await reader.read()).done).toBe(true); reader.releaseLock();
  } finally { globalThis.setInterval = original; }
});

test("continuous source capacity is explicit and releases admission for a previously blocked source",async () => {
  const original = globalThis.fetch,now = new Date().toISOString();
  let rows = Array.from({ length:257 },(_,index) => ({ id:`source-${index}`,project_id:"project",source_type:"rest_polling",name:`Source ${index}`,config_json:JSON.stringify({ url:`http://old/source-${index}`,intervalSeconds:60,timeoutMs:1000,timestampPath:null,credentialRef:null,collectionMode:"continuous" }),created_at:now,updated_at:now }));
  const DB = { prepare() { return { bind() { return this; },async all() { return { results:rows }; } }; } } as unknown as Database;
  globalThis.fetch = async () => Response.json({ value:42 });
  const collector = new RuntimeCollector({ DB,RUNTIME_POLLING_ENABLED:"true",RUNTIME_ALLOWED_HOSTS:"old" });
  try {
    await collector.start();
    let diagnostics = collector.diagnostics("project"); expect(diagnostics.sources).toHaveLength(257);
    expect(diagnostics.sources.filter((source) => source.errorCode === "runtime_source_limit")).toHaveLength(1);
    expect(diagnostics.sources.find((source) => source.id === "source-256")).toMatchObject({ state:"failed",errorCode:"runtime_source_limit",subscribers:0,collectedAt:null });
    rows = rows.slice(1); await collector.refresh("project");
    await expect.poll(() => collector.diagnostics("project").sources.find((source) => source.id === "source-256")?.state).toBe("sampled");
    diagnostics = collector.diagnostics("project"); expect(diagnostics.sources).toHaveLength(256); expect(diagnostics.sources.every((source) => source.errorCode === null)).toBe(true);
  } finally { await collector.close(); globalThis.fetch = original; }
});

test("seven open WebSockets do not occupy REST handshake slots and shutdown cancels every lifetime",async () => {
  const original = globalThis.fetch,now = new Date().toISOString(); let sockets = 0,closed = 0,rest = 0;
  const rows = Array.from({ length:8 },(_,index) => ({ id:`source-${index}`,project_id:"project",source_type:index < 7 ? "websocket" : "rest_polling",name:`Source ${index}`,config_json:JSON.stringify(index < 7 ? { url:`ws://old/source-${index}`,heartbeatSeconds:5,reconnectMaxSeconds:5,credentialRef:null,collectionMode:"continuous" } : { url:"http://old/rest",intervalSeconds:60,timeoutMs:1000,timestampPath:null,credentialRef:null,collectionMode:"continuous" }),created_at:now,updated_at:now }));
  const DB = { prepare() { return { bind() { return this; },async all() { return { results:rows }; } }; } } as unknown as Database;
  globalThis.fetch = async () => { rest++; return Response.json({ value:42 }); };
  const collector = new RuntimeCollector({ DB,RUNTIME_POLLING_ENABLED:"true",RUNTIME_ALLOWED_HOSTS:"old",OPEN_WEBSOCKET_SOURCE:async (_,__,sample,signal) => {
    sockets++; sample({ payload:{ value:1 },responseBytes:11,collectedAt:now,durationMs:0 });
    const lifetime = new Promise<void>((_,reject) => signal.addEventListener("abort",() => { closed++; reject(new Error("Stopped")); },{ once:true }));
    return { closed:lifetime,close() {} };
  } });
  try {
    await collector.start(); await expect.poll(() => sockets).toBe(7); await expect.poll(() => rest).toBe(1);
    expect(collector.diagnostics("project").sources.every((source) => source.state === "sampled")).toBe(true);
    await collector.close(); expect(closed).toBe(7);
  } finally { await collector.close(); globalThis.fetch = original; }
});
