import { test,expect } from "@playwright/test";
import { WebSocketServer,type WebSocket } from "ws";
import { once } from "node:events";
import { createServer } from "node:http";
import { openWebSocketSource } from "../apps/runtime/src/websocket-source";
import type { AppEnv } from "../apps/api/src/auth";
import type { DataSource } from "../apps/api/src/data-sources";
import { fetchRuntimeSource,type SourceSample } from "../apps/api/src/runtime-state";

async function fixture(autoPong=true) {
  const server = new WebSocketServer({ host:"127.0.0.1",port:0,autoPong }); await once(server,"listening");
  const host = `127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
  const env:AppEnv = { DB:{} as any,RUNTIME_POLLING_ENABLED:"true",RUNTIME_ALLOWED_HOSTS:host };
  const source:DataSource = { id:"source",projectId:"project",name:"Mock WS",sourceType:"websocket",config:{ url:`ws://${host}`,credentialRef:null,heartbeatSeconds:5,reconnectMaxSeconds:5,sampleIntervalMs:100,timestampPath:"$.timestamp",topics:["equipment"] },createdAt:"",updatedAt:"" };
  const close = async () => { for (const client of server.clients) client.terminate(); await new Promise<void>((resolve) => server.close(() => resolve())); };
  return { server,env,source,close };
}
const payload = (value:number) => JSON.stringify({ timestamp:new Date().toISOString(),value });

test("WebSocket subscribes on connection, coalesces valid samples, keeps heartbeat and cancels the socket",async () => {
  const { server,env,source,close } = await fixture(),controller = new AbortController(),samples:SourceSample[] = [];
  let peer:WebSocket | undefined,subscription:unknown,pings = 0;
  server.on("connection",(socket) => { peer = socket; socket.on("ping",() => pings++); socket.on("message",(message) => { subscription = JSON.parse(message.toString()); socket.send(payload(1)); }); });
  try {
    const connection = await openWebSocketSource(env,source,"test",(sample) => samples.push(sample),controller.signal);
    await expect.poll(() => samples.length).toBe(1); expect(subscription).toEqual({ type:"subscribe",topics:["equipment"] });
    for (let value = 2; value <= 100; value++) peer!.send(payload(value));
    await expect.poll(() => (samples.at(-1)?.payload as { value:number })?.value).toBe(100); expect(samples.length).toBeLessThan(10);
    await expect.poll(() => pings,{ timeout:12000 }).toBeGreaterThanOrEqual(2);
    controller.abort(); await expect(connection.closed).rejects.toMatchObject({ code:"data_source_cancelled" }); await expect.poll(() => server.clients.size).toBe(0);
  } finally { controller.abort(); await close(); }
});

test("WebSocket rejects malformed, binary, oversize, excessive fragment and rate messages",async () => {
  for (const scenario of ["json","binary","size","fragments","rate","private"] as const) {
    const { server,env,source,close } = await fixture(),controller = new AbortController();
    let peer:WebSocket | undefined;
    server.on("connection",(socket) => { peer = socket; });
    try {
      if (scenario === "private") env.RESOLVE_SOURCE = () => ({ url:source.config.url,headers:{ authorization:"Bearer synthetic-websocket-secret" } });
      const connection = await openWebSocketSource(env,source,"test",() => {},controller.signal);
      if (scenario === "json") peer!.send("not JSON");
      if (scenario === "private") peer!.send(JSON.stringify({ value:"synthetic-websocket-secret" }));
      if (scenario === "binary") peer!.send(Buffer.from("binary"));
      if (scenario === "size") peer!.send("x".repeat(256*1024+1));
      if (scenario === "fragments") { peer!.send("{",{ fin:false }); for (let index = 0; index < 1025; index++) peer!.send(" ",{ fin:false }); peer!.send("}",{ fin:true }); }
      if (scenario === "rate") for (let index = 0; index < 1002; index++) peer!.send(payload(index));
      await expect(connection.closed).rejects.toMatchObject({ code:scenario === "private" ? "data_source_private_echo" : scenario === "json" ? "data_source_invalid_json" : scenario === "binary" ? "websocket_binary_not_supported" : scenario === "rate" ? "websocket_message_rate_limit" : "websocket_message_invalid" });
    } finally { controller.abort(); await close(); }
  }
});

test("missing heartbeat closes a previously sampled WebSocket",async () => {
  const { server,env,source,close } = await fixture(false),controller = new AbortController();
  server.on("connection",(socket) => socket.send(payload(1)));
  try {
    const connection = await openWebSocketSource(env,source,"test",() => {},controller.signal);
    await expect(connection.closed).rejects.toMatchObject({ code:"websocket_heartbeat_timeout" });
  } finally { controller.abort(); await close(); }
});

test("WebSocket does not follow redirects or disclose the effective endpoint in errors",async () => {
  let targetRequests = 0;
  const target = createServer((_,response) => { targetRequests++; response.end("not allowed"); }); target.listen(0,"127.0.0.1"); await once(target,"listening");
  const targetHost = `127.0.0.1:${(target.address() as import("node:net").AddressInfo).port}`;
  const redirect = createServer((_,response) => { response.writeHead(302,{ location:`ws://${targetHost}/` }); response.end(); }); redirect.listen(0,"127.0.0.1"); await once(redirect,"listening");
  const host = `127.0.0.1:${(redirect.address() as import("node:net").AddressInfo).port}`;
  const source:DataSource = { id:"source",projectId:"project",name:"Redirect",sourceType:"websocket",config:{ url:`ws://${host}/`,heartbeatSeconds:5,reconnectMaxSeconds:5,credentialRef:null },createdAt:"",updatedAt:"" };
  try {
    await expect(openWebSocketSource({ DB:{} as any,RUNTIME_POLLING_ENABLED:"true",RUNTIME_ALLOWED_HOSTS:host },source,"test",() => {},new AbortController().signal)).rejects.toMatchObject({ code:"websocket_http_error",message:"WebSocket handshake returned HTTP 302." }); expect(targetRequests).toBe(0);
  } finally { redirect.closeAllConnections(); target.closeAllConnections(); await Promise.all([new Promise<void>((resolve) => redirect.close(() => resolve())),new Promise<void>((resolve) => target.close(() => resolve()))]); }
});


test("first-sample collection clears its timeout when source opening rejects synchronously",async () => {
  const originalSet = globalThis.setTimeout,originalClear = globalThis.clearTimeout; let created = 0,cleared = 0;
  globalThis.setTimeout = ((...args:Parameters<typeof setTimeout>) => { created++; return originalSet(...args); }) as typeof setTimeout;
  globalThis.clearTimeout = ((handle:ReturnType<typeof setTimeout>) => { cleared++; originalClear(handle); }) as typeof clearTimeout;
  const source:DataSource = { id:"source",projectId:"project",name:"Rejected",sourceType:"websocket",config:{ url:"ws://localhost/",credentialRef:null,heartbeatSeconds:5,reconnectMaxSeconds:5 },createdAt:"",updatedAt:"" };
  try {
    const result = fetchRuntimeSource({ DB:{} as any,OPEN_WEBSOCKET_SOURCE:() => { throw new Error("Synthetic open rejection"); } },source,"test").then(() => false,() => true);
    expect(await result).toBe(true); expect(created).toBe(1); expect(cleared).toBe(1);
  } finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; }
});
