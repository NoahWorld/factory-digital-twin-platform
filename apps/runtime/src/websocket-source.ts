import WebSocket from "ws";
import { AppError,type AppEnv } from "../../api/src/auth";
import type { DataSource,WebSocketConfig } from "../../api/src/data-sources";
import { parseRuntimeSourceSample,resolveAllowedRuntimeSource,type SourceSample } from "../../api/src/runtime-state";

export type WebSocketSourceConnection = { closed:Promise<void>;close():void };
const MAX_MESSAGE_BYTES = 256*1024;

export function openWebSocketSource(env:AppEnv,source:DataSource,requestId:string,onSample:(sample:SourceSample) => void,signal:AbortSignal):Promise<WebSocketSourceConnection> {
  if (source.sourceType !== "websocket" || !("heartbeatSeconds" in source.config)) return Promise.reject(new AppError(409,"runtime_source_not_supported","A WebSocket source is required."));
  if (signal.aborted) return Promise.reject(new AppError(499,"data_source_cancelled","Source connection cancelled."));
  const resolved = resolveAllowedRuntimeSource(env,source),config:WebSocketConfig = { ...source.config,url:resolved.url };
  const options:WebSocket.ClientOptions & { maxFragments:number;maxBufferedChunks:number } = {
    headers:{ ...resolved.headers,"x-factory-twin-request-id":requestId },followRedirects:false,handshakeTimeout:10000,
    maxPayload:MAX_MESSAGE_BYTES,maxFragments:1024,maxBufferedChunks:2048,perMessageDeflate:false,skipUTF8Validation:false,allowSynchronousEvents:false,
  };
  const socket = new WebSocket(resolved.url,options);
  let opened = false,ended = false,reason:AppError | undefined,heartbeat:ReturnType<typeof setInterval> | undefined,flushTimer:ReturnType<typeof setTimeout> | undefined;
  let pending:SourceSample | undefined,lastPublished = 0,pong:string | null = null,windowAt = Date.now(),messages = 0,bytes = 0;
  let rejectOpening!:(reason:unknown) => void,resolveOpening!:(connection:WebSocketSourceConnection) => void;
  let rejectClosed!:(reason:unknown) => void;
  const closed = new Promise<void>((_,reject) => { rejectClosed = reject; });
  // Opening can fail before the caller has received the lifetime handle.
  void closed.catch(() => {});
  const opening = new Promise<WebSocketSourceConnection>((resolve,reject) => { resolveOpening = resolve; rejectOpening = reject; });
  const cleanup = () => { clearInterval(heartbeat); clearTimeout(flushTimer); signal.removeEventListener("abort",cancel); pending = undefined; };
  const fail = (failure:AppError) => {
    if (ended || reason) return; reason = failure; cleanup();
    if (!opened) rejectOpening(failure);
    socket.terminate();
  };
  const cancel = () => fail(new AppError(499,"data_source_cancelled","Source connection cancelled."));
  const publish = () => {
    flushTimer = undefined;
    if (!pending || ended || reason) return;
    const sample = pending; pending = undefined; lastPublished = Date.now();
    try { onSample(sample); } catch { fail(new AppError(500,"source_sample_processing_failed","Source sample processing failed.")); }
  };
  signal.addEventListener("abort",cancel,{ once:true }); if (signal.aborted) cancel();
  socket.once("open",() => {
    if (reason || signal.aborted) { cancel(); return; }
    opened = true;
    if (config.topics?.length) socket.send(JSON.stringify({ type:"subscribe",topics:config.topics }),(error) => { if (error) fail(new AppError(502,"websocket_subscription_failed","WebSocket subscription could not be sent.")); });
    heartbeat = setInterval(() => {
      if (pong !== null) { fail(new AppError(504,"websocket_heartbeat_timeout","WebSocket heartbeat response was not received.")); return; }
      pong = crypto.randomUUID(); socket.ping(pong,undefined,(error) => { if (error) fail(new AppError(502,"websocket_heartbeat_failed","WebSocket heartbeat could not be sent.")); });
    },config.heartbeatSeconds*1000);
    resolveOpening({ closed,close:cancel });
  });
  socket.on("pong",(data) => { if (pong !== null && data.toString() === pong) pong = null; });
  socket.on("message",(data,isBinary) => {
    if (ended || reason) return;
    if (isBinary) { fail(new AppError(502,"websocket_binary_not_supported","Source messages must be UTF-8 JSON text.")); return; }
    const buffer = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
    const now = Date.now(); if (now-windowAt >= 1000) { windowAt = now; messages = 0; bytes = 0; }
    messages++; bytes+=buffer.byteLength;
    if (messages > 1000 || bytes > 4*1024*1024) { fail(new AppError(429,"websocket_message_rate_limit","WebSocket exceeded its message or byte rate budget.")); return; }
    try { pending = parseRuntimeSourceSample(source,config,resolved.headers,buffer.toString("utf8"),now); }
    catch (error) { fail(error instanceof AppError ? error : new AppError(502,"data_source_invalid_json","Source message could not be decoded.")); return; }
    if (!flushTimer) {
      const remaining = (config.sampleIntervalMs ?? 100)-(now-lastPublished);
      if (remaining <= 0) publish(); else flushTimer = setTimeout(publish,remaining);
    }
  });
  socket.on("unexpected-response",(request,response) => {
    fail(new AppError(502,"websocket_http_error",`WebSocket handshake returned HTTP ${response.statusCode ?? 0}.`)); response.destroy(); request.destroy();
  });
  socket.on("error",(error:Error & { code?:string }) => {
    fail(new AppError(502,error.code?.startsWith("WS_ERR_") ? "websocket_message_invalid" : "websocket_connection_failed","WebSocket connection or message failed validation."));
  });
  socket.once("close",() => {
    ended = true; cleanup(); const error = reason ?? new AppError(502,"data_source_disconnected","WebSocket source disconnected.");
    if (!opened) rejectOpening(error); rejectClosed(error);
  });
  return opening;
}
