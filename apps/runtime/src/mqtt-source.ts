import { MqttClient } from "mqtt";
import { connect as connectTcp,isIP } from "node:net";
import { connect as connectTls } from "node:tls";
import { Duplex,Transform,type TransformCallback } from "node:stream";
import { AppError,type AppEnv } from "../../api/src/auth";
import type { DataSource } from "../../api/src/data-sources";
import { parseRuntimeSourceSample,runtimeHosts,type SourceSample } from "../../api/src/runtime-state";

/** Inspect remaining-length bytes before the library can accumulate a declared packet body. */
export class MqttPacketBudget extends Transform {
  private connackSeen = false;
  private phase:"header"|"length"|"body" = "header";
  private length = 0;private multiplier = 1;private digits = 0;private remaining = 0;
  private windowAt = Date.now();private packets = 0;private bytes = 0;
  override _transform(chunk:Buffer,_encoding:BufferEncoding,callback:TransformCallback) {
    const now = Date.now();if (now-this.windowAt>=1000) { this.windowAt = now;this.packets = 0;this.bytes = 0; }
    this.bytes += chunk.length;
    const reject = (code:string) => callback(new AppError(502,code,"MQTT source exceeded protocol framing or traffic limits."));
    if (this.bytes>4*1024*1024) { reject("mqtt_message_rate_limit");return; }
    for (let index=0;index<chunk.length;) {
      if (this.phase === "header") { this.packets++;if (this.packets>1000) { reject("mqtt_message_rate_limit");return; }const header = chunk[index++],type = header>>4;
        if (![2,3,9,13].includes(type) || !this.connackSeen && type !== 2 || this.connackSeen && type === 2) { reject("mqtt_packet_invalid");return; }
        if (type === 2) this.connackSeen = true;
        if (type === 3 && (header&6)>2) { reject("mqtt_qos_not_supported");return; }this.phase = "length";this.length = 0;this.multiplier = 1;this.digits = 0; }
      else if (this.phase === "length") {
        const byte = chunk[index++];this.digits++;this.length += (byte&127)*this.multiplier;
        if (this.length>256*1024+1024) { reject("mqtt_packet_too_large");return; }
        if (byte&128) { if (this.digits>=4) { reject("mqtt_packet_invalid");return; }this.multiplier *= 128; }
        else { if (this.digits>1 && byte === 0) { reject("mqtt_packet_invalid");return; }this.remaining = this.length;this.phase = this.remaining ? "body":"header"; }
      } else { const read = Math.min(chunk.length-index,this.remaining);index+=read;this.remaining-=read;if (!this.remaining) this.phase = "header"; }
    }
    callback(null,chunk);
  }
}

export function openMqttSource(env:AppEnv,source:DataSource,_requestId:string,onSample:(sample:SourceSample) => void,signal:AbortSignal):Promise<{ closed:Promise<void>;close():void }> {
  if (source.sourceType !== "mqtt" || !("topic" in source.config)) return Promise.reject(new AppError(409,"runtime_source_not_supported","An MQTT source is required."));
  if (signal.aborted) return Promise.reject(new AppError(499,"data_source_cancelled","MQTT collection cancelled."));
  if (env.RUNTIME_POLLING_ENABLED !== "true") throw new AppError(503,"runtime_polling_disabled","Runtime source collection is disabled on this server.");
  if (!env.RESOLVE_MQTT_SOURCE) throw new AppError(503,"source_environment_unavailable","MQTT requires private endpoint configuration.");
  const resolved = env.RESOLVE_MQTT_SOURCE(source),url = new URL(resolved.url),allowedHosts = runtimeHosts(env),config = source.config;
  if (!["mqtt:","mqtts:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || !["","/"].includes(url.pathname)) throw new AppError(409,"source_endpoint_protocol_mismatch","MQTT endpoint protocol is invalid.");
  if (!allowedHosts.size) throw new AppError(503,"runtime_allowed_hosts_missing","Runtime collection requires an explicitly allowed host.");
  if (!allowedHosts.has(url.host.toLowerCase())) throw new AppError(403,"runtime_data_source_host_not_allowed","MQTT endpoint host is not allowed.");
  let socket:ReturnType<typeof connectTcp>|undefined,guard:MqttPacketBudget|undefined,transport:Duplex|undefined;
  const client = new MqttClient(() => {
    const options = { host:url.hostname.replace(/^\[|\]$/g,""),port:Number(url.port || (url.protocol === "mqtts:" ? 8883:1883)) };
    socket = url.protocol === "mqtts:" ? connectTls({ ...options,rejectUnauthorized:true,servername:isIP(options.host) ? undefined:options.host }):connectTcp(options);
    guard = new MqttPacketBudget();transport = Duplex.from({ readable:socket.pipe(guard),writable:socket });
    socket.once("connect",() => transport?.emit("connect"));guard.on("error",(error) => transport?.destroy(error));socket.on("error",(error) => transport?.destroy(error));
    transport.once("close",() => { socket?.destroy();guard?.destroy(); });return transport;
  },{ manualConnect:true,protocolVersion:4,clientId:`newpower-${crypto.randomUUID()}`,clean:true,reconnectPeriod:0,resubscribe:false,connectTimeout:10000,keepalive:config.heartbeatSeconds,reschedulePings:false,queueQoSZero:false,timerVariant:"native",...(resolved.username !== undefined ? { username:resolved.username,password:resolved.password }:{}),log:() => {} });
  let opened = false,ended = false,reason:AppError|undefined,pending:SourceSample|undefined,lastPublished = 0,flushTimer:ReturnType<typeof setTimeout>|undefined;
  let resolveOpening!:(connection:{closed:Promise<void>;close():void}) => void,rejectOpening!:(reason:unknown) => void,rejectClosed!:(reason:unknown) => void;
  const closed = new Promise<void>((_,reject) => { rejectClosed = reject; });void closed.catch(() => {});
  const opening = new Promise<{closed:Promise<void>;close():void}>((resolve,reject) => { resolveOpening = resolve;rejectOpening = reject; });
  const cleanup = () => { clearTimeout(openingTimer);clearTimeout(flushTimer);signal.removeEventListener("abort",cancel);pending = undefined; };
  const fail = (failure:AppError) => { if (ended || reason) return;reason = failure;cleanup();if (!opened) rejectOpening(failure);client.end(true);transport?.destroy();socket?.destroy(); };
  const cancel = () => fail(new AppError(499,"data_source_cancelled","MQTT collection cancelled."));
  const publish = () => { flushTimer = undefined;if (!pending || !opened || ended || reason) return;const sample = pending;pending = undefined;lastPublished = Date.now();try { onSample(sample); } catch { fail(new AppError(500,"source_sample_processing_failed","MQTT sample processing failed.")); } };
  const openingTimer = setTimeout(() => fail(new AppError(504,"mqtt_subscription_timeout","MQTT connection and subscription did not complete within ten seconds.")),10000);
  client.on("connect",() => client.subscribe(config.topic,{ qos:1 },(error,granted) => {
    if (reason || ended) return;
    if (error || granted?.length !== 1 || granted[0].topic !== config.topic || ![0,1].includes(granted[0].qos)) { fail(new AppError(403,"mqtt_subscription_denied","MQTT broker did not authorize the requested topic."));return; }
    opened = true;clearTimeout(openingTimer);resolveOpening({ closed,close:cancel });publish();
  }));
  client.on("message",(topic,bytes) => {
    if (reason || ended) return;
    if (topic !== config.topic) { fail(new AppError(403,"mqtt_unexpected_topic","MQTT broker delivered an unrequested topic."));return; }
    if (bytes.length>256*1024) { fail(new AppError(502,"data_source_response_too_large","MQTT message exceeds the byte limit."));return; }
    try { pending = parseRuntimeSourceSample(source,{ ...config,url:resolved.url },{ ...(resolved.username ? { username:resolved.username }:{}),...(resolved.password ? { password:resolved.password }:{}) },new TextDecoder("utf-8",{ fatal:true }).decode(bytes)); }
    catch (error) { fail(error instanceof AppError ? error:new AppError(502,"data_source_invalid_json","MQTT source did not provide valid UTF-8 JSON."));return; }
    if (opened && !flushTimer) { const remaining = config.sampleIntervalMs-(Date.now()-lastPublished);if (remaining<=0) publish();else flushTimer = setTimeout(publish,remaining); }
  });
  client.on("error",(error) => fail(error instanceof AppError ? error:new AppError(502,"mqtt_connection_failed","MQTT connection or protocol failed.")));
  client.once("close",() => { ended = true;cleanup();const failure = reason ?? new AppError(502,"data_source_disconnected","MQTT source disconnected.");if (!opened) rejectOpening(failure);rejectClosed(failure); });
  signal.addEventListener("abort",cancel,{ once:true });if (signal.aborted) cancel();else { try { client.connect(); } catch { fail(new AppError(502,"mqtt_connection_failed","MQTT connection could not be opened.")); } }
  return opening;
}
