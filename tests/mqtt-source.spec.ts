import { createServer as createTlsServer } from "node:tls";
import { spawnSync } from "node:child_process";
import { mkdir,readFile,chmod } from "node:fs/promises";
import { join } from "node:path";
import { test,expect } from "@playwright/test";
import { Aedes } from "aedes";
import { createServer,type Socket } from "node:net";
import { once } from "node:events";
import { openMqttSource,MqttPacketBudget } from "../apps/runtime/src/mqtt-source";
import { parseSourceEnvironment } from "../apps/runtime/src/source-environment";
import { createMqttResolver } from "../apps/runtime/src/mqtt-environment";
import { validateDataSourceCreate,type DataSource } from "../apps/api/src/data-sources";
import type { AppEnv } from "../apps/api/src/auth";
import type { SourceSample } from "../apps/api/src/runtime-state";
const config = { url:"",endpointRef:"broker",credentialRef:"device",topic:"factory/device",timestampPath:"$.timestamp",heartbeatSeconds:5,reconnectMaxSeconds:5,sampleIntervalMs:100 };
const source:DataSource = { id:"source",projectId:"project",name:"MQTT fixture",sourceType:"mqtt",config,createdAt:"",updatedAt:"" };
async function brokerFixture() {
  let connections = 0,subscriptions = 0;
  const broker = await Aedes.createBroker({ authenticate:(_client,username,password,callback) => callback(null,username === "fixture-user" && password?.toString() === "fixture-password"),authorizeSubscribe:(_client,subscription,callback) => { subscriptions++;callback(null,subscription.topic === "factory/device" ? subscription:null); } });
  const sockets = new Set<Socket>(),server = createServer((socket) => { connections++;sockets.add(socket);socket.once("close",() => sockets.delete(socket));broker.handle(socket); });server.listen(0,"127.0.0.1");await once(server,"listening");
  const host = `127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`,environment = parseSourceEnvironment({ version:1,endpoints:{},credentials:{},mqttEndpoints:{ broker:{ projectIds:["project"],url:`mqtt://${host}`,topics:["factory/device","denied/topic"],credentialRef:"device" } },mqttCredentials:{ device:{ username:"fixture-user",password:"fixture-password" } } });
  const env = { RUNTIME_POLLING_ENABLED:"true",RUNTIME_ALLOWED_HOSTS:host,RESOLVE_MQTT_SOURCE:createMqttResolver(environment) } as AppEnv;
  return { broker,env,host,sockets,connections:() => connections,subscriptions:() => subscriptions,publish:(value:unknown,retain=false) => new Promise<void>((resolve,reject) => broker.publish({ cmd:"publish",topic:"factory/device",qos:1,dup:false,retain,payload:Buffer.from(JSON.stringify(value)) },(error) => error ? reject(error):resolve())),close:async () => { for (const socket of sockets) socket.destroy();await new Promise<void>((resolve) => broker.close(resolve));await new Promise<void>((resolve) => server.close(() => resolve())); } };
}

test("MQTT endpoint and exact topic are privately authorized before opening a connection",async () => {
  const fixture = await brokerFixture();try {
    const create = (data:object) => validateDataSourceCreate({ name:"MQTT",sourceType:"mqtt",config:{ ...config,...data } });
    expect(create({}).sourceType).toBe("mqtt");for (const invalid of [{ topic:"factory/+" },{ topic:"$share/group/factory/device" },{ timestampPath:null },{ endpointRef:"" },{ url:`mqtt://${fixture.host}` }]) expect(() => create(invalid)).toThrow();
    const denied = async (source:DataSource) => { try { await openMqttSource(fixture.env,source,"request",() => {},new AbortController().signal);throw new Error("Unexpected connection"); } catch (error) { return (error as {code:string}).code; } };
    expect(await denied({ ...source,projectId:"outsider" })).toBe("source_endpoint_not_authorized");expect(await denied({ ...source,config:{ ...config,topic:"unlisted/topic" } })).toBe("mqtt_topic_not_authorized");expect(fixture.connections()).toBe(0);
    await expect(openMqttSource(fixture.env,{ ...source,config:{ ...config,topic:"denied/topic" } },"request",() => {},new AbortController().signal)).rejects.toMatchObject({ code:"mqtt_subscription_denied" });
  } finally { await fixture.close(); }
});

test("real MQTT CONNACK and SUBACK precede samples; sampling coalesces and cancellation releases sockets",async () => {
  const fixture = await brokerFixture(),controller = new AbortController(),samples:SourceSample[] = [];
  try {
    const connection = await openMqttSource(fixture.env,source,"request",(sample) => samples.push(sample),controller.signal);expect(fixture.subscriptions()).toBe(1);
    for (let value=0;value<20;value++) await fixture.publish({ timestamp:new Date().toISOString(),value });
    await expect.poll(() => (samples.at(-1)?.payload as {value:number})?.value).toBe(19);expect(samples.length).toBeLessThan(20);
    controller.abort();await expect(connection.closed).rejects.toMatchObject({ code:"data_source_cancelled" });await expect.poll(() => fixture.sockets.size).toBe(0);
  } finally { controller.abort();await fixture.close(); }
});

test("retained MQTT messages keep source time, and invalid JSON or private echoes close collection",async () => {
  const fixture = await brokerFixture();try {
    const timestamp = new Date(Date.now()-60000).toISOString();await fixture.publish({ timestamp,value:1 },true);const samples:SourceSample[] = [],controller = new AbortController();
    const connection = await openMqttSource(fixture.env,source,"request",(sample) => samples.push(sample),controller.signal);await expect.poll(() => samples.length).toBe(1);expect((samples[0].payload as {timestamp:string}).timestamp).toBe(timestamp);
    await fixture.publish({ timestamp:new Date().toISOString(),echo:"fixture-password" });await expect(connection.closed).rejects.toMatchObject({ code:"data_source_private_echo" });controller.abort();
  } finally { await fixture.close(); }
});

test("MQTT framing rejects oversized declared bodies before accumulation and supports split packet lengths",async () => {
  const guard = new MqttPacketBudget(),received:Buffer[] = [];guard.on("data",(chunk) => received.push(chunk));guard.write(Buffer.from([0x20,2,0,0]));guard.write(Buffer.from([0xd0]));guard.write(Buffer.from([0]));guard.end();await once(guard,"end");expect(Buffer.concat(received)).toEqual(Buffer.from([0x20,2,0,0,0xd0,0]));
  const qos2 = new MqttPacketBudget();qos2.resume();const rejectedQos = once(qos2,"error");qos2.write(Buffer.from([0x20,2,0,0,0x34]));expect((await rejectedQos)[0]).toMatchObject({ code:"mqtt_qos_not_supported" });
  const rejected = new MqttPacketBudget();rejected.resume();const error = once(rejected,"error");rejected.write(Buffer.from([0x20,2,0,0,0x30,0xff,0xff,0x7f]));expect((await error)[0]).toMatchObject({ code:"mqtt_packet_too_large" });
});

async function rawBroker(onPacket:(socket:Socket,type:number,body:Buffer) => void) {
  const sockets = new Set<Socket>(),server = createServer((socket) => { sockets.add(socket);socket.setNoDelay(true);socket.on("error",() => {});socket.once("close",() => sockets.delete(socket));let pending = Buffer.alloc(0);socket.on("data",(chunk) => { pending = Buffer.concat([pending,chunk]);while (pending.length>=2) { let length = 0,multiplier = 1,offset = 1;while (offset<pending.length) { const byte = pending[offset++];length+=(byte&127)*multiplier;if (!(byte&128)) break;multiplier*=128; }if (offset+length>pending.length) return;const packet = pending.subarray(0,offset+length);pending = pending.subarray(offset+length);onPacket(socket,packet[0]>>4,packet.subarray(offset)); } }); });
  server.listen(0,"127.0.0.1");await once(server,"listening");const host = `127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`,env = { RUNTIME_POLLING_ENABLED:"true",RUNTIME_ALLOWED_HOSTS:host,RESOLVE_MQTT_SOURCE:() => ({ url:`mqtt://${host}` }) } as AppEnv;
  return { env,sockets,close:async () => { for (const socket of sockets) socket.destroy();await new Promise<void>((resolve) => server.close(() => resolve())); } };
}
const acknowledge = (socket:Socket,type:number,body:Buffer) => { if (type === 1) socket.write(Buffer.from([0x20,2,0,0]));if (type === 8) socket.write(Buffer.from([0x90,3,body[0],body[1],1])); };
const publishPacket = (bytes:Buffer) => { const topic = Buffer.from(config.topic),body = Buffer.concat([Buffer.from([0,topic.length]),topic,bytes]);let length = body.length;const header = [0x30];do { let byte = length%128;length = Math.floor(length/128);if (length) byte|=128;header.push(byte); } while (length);return Buffer.concat([Buffer.from(header),body]); };

test("actual MQTT sockets reject fragmented oversized declarations and invalid UTF-8",async () => {
  const oversized = await rawBroker((socket,type,body) => { acknowledge(socket,type,body);if (type === 8) { socket.write(Buffer.from([0x30,0xff]));setTimeout(() => { if (!socket.destroyed) socket.write(Buffer.from([0xff,0x7f])); },20); } });
  try { const connection = await openMqttSource(oversized.env,source,"request",() => {},new AbortController().signal);await expect(connection.closed).rejects.toMatchObject({ code:"mqtt_packet_too_large" });await expect.poll(() => oversized.sockets.size).toBe(0); } finally { await oversized.close(); }
  const invalid = await rawBroker((socket,type,body) => { acknowledge(socket,type,body);if (type === 8) socket.write(publishPacket(Buffer.from([0xff]))); });
  try { const opening = openMqttSource(invalid.env,source,"request",() => {},new AbortController().signal);try { const connection = await opening;await expect(connection.closed).rejects.toMatchObject({ code:"data_source_invalid_json" }); } catch (error) { expect(error).toMatchObject({ code:"data_source_invalid_json" }); }await expect.poll(() => invalid.sockets.size).toBe(0); } finally { await invalid.close(); }
});

test("MQTT cancellation before CONNACK and missing SUBACK cannot leak opening slots",async () => {
  const silent = await rawBroker(() => {}),controller = new AbortController();
  try { const opening = openMqttSource(silent.env,source,"request",() => {},controller.signal);await expect.poll(() => silent.sockets.size).toBe(1);controller.abort();await expect(opening).rejects.toMatchObject({ code:"data_source_cancelled" });await expect.poll(() => silent.sockets.size).toBe(0); } finally { await silent.close(); }
  const unsubscribed = await rawBroker((socket,type) => { if (type === 1) socket.write(Buffer.from([0x20,2,0,0]));if (type === 12) socket.write(Buffer.from([0xd0,0])); });
  try { await expect(openMqttSource(unsubscribed.env,source,"request",() => {},new AbortController().signal)).rejects.toMatchObject({ code:"mqtt_subscription_timeout" });await expect.poll(() => unsubscribed.sockets.size).toBe(0); } finally { await unsubscribed.close(); }
});

test("missing MQTT PINGRESP closes a sampled connection without a library reconnect loop",async () => {
  const peer = await rawBroker((socket,type,body) => { acknowledge(socket,type,body);if (type === 8) socket.write(publishPacket(Buffer.from(JSON.stringify({ timestamp:new Date().toISOString(),value:1 })))); });let samples = 0;
  try { const connection = await openMqttSource(peer.env,source,"request",() => { samples++; },new AbortController().signal);await expect.poll(() => samples).toBe(1);await expect(connection.closed).rejects.toMatchObject({ code:"mqtt_connection_failed" });await expect.poll(() => peer.sockets.size).toBe(0); } finally { await peer.close(); }
});


test("MQTT TLS rejects an untrusted broker certificate",async ({},testInfo) => {
  const directory = testInfo.outputPath("tls");await mkdir(directory,{ recursive:true,mode:0o700 });const key = join(directory,"key.pem"),cert = join(directory,"cert.pem");
  const generated = spawnSync("openssl",["req","-x509","-newkey","rsa:2048","-nodes","-keyout",key,"-out",cert,"-days","1","-subj","/CN=localhost","-addext","subjectAltName=IP:127.0.0.1,DNS:localhost"],{ encoding:"utf8" });expect(generated.status,generated.stderr).toBe(0);await chmod(key,0o600);
  const peers = new Set<Socket>(),server = createTlsServer({ key:await readFile(key),cert:await readFile(cert) });server.on("connection",(socket) => { peers.add(socket);socket.once("close",() => peers.delete(socket)); });server.on("tlsClientError",() => {});server.listen(0,"127.0.0.1");await once(server,"listening");const host = `127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
  try { await expect(openMqttSource({ RUNTIME_POLLING_ENABLED:"true",RUNTIME_ALLOWED_HOSTS:host,RESOLVE_MQTT_SOURCE:() => ({ url:`mqtts://${host}` }) } as AppEnv,source,"request",() => {},new AbortController().signal)).rejects.toMatchObject({ code:"mqtt_connection_failed" });await expect.poll(() => peers.size).toBe(0); } finally { for (const socket of peers) socket.destroy();await new Promise<void>((resolve) => server.close(() => resolve())); }
});


test("a repeated CONNACK cannot accumulate library subscription waiters",async () => {
  let subscriptions = 0;const peer = await rawBroker((socket,type,body) => { acknowledge(socket,type,body);if (type === 8) { subscriptions++;setTimeout(() => { if (!socket.destroyed) socket.write(Buffer.from([0x20,2,0,0])); },20); } });
  try { const connection = await openMqttSource(peer.env,source,"request",() => {},new AbortController().signal);await expect(connection.closed).rejects.toMatchObject({ code:"mqtt_packet_invalid" });await expect.poll(() => peer.sockets.size).toBe(0);expect(subscriptions).toBe(1); } finally { await peer.close(); }
});
