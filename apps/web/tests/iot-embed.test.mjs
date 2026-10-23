import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildIotPointManifest, parseIotBinding, parseIotEmbedOptions, parseIotParentMessage, IOT_EMBED_CHANNEL, IOT_EMBED_VERSION, IOT_BINDING_LIMITS } from "../../../shared/iot-embed";
import { initialIotRuntimeState, isTrustedIotEvent, receiveIotMessage, projectIotRuntimeNode } from "../src/canvas/iot-runtime";
import { CanvasSurface } from "../src/canvas/CanvasSurface";
import { IotBindingInspector } from "../src/canvas/IotBindingInspector";
import { NotificationProvider } from "../src/components/NotificationProvider";
import { createCanvasNode } from "../src/canvas/types";
import { validateCanvasPatch, applyCanvasPatch } from "../../api/src/canvas";

const NOW = 1_800_000_000_000;
const envelope = { channel: IOT_EMBED_CHANNEL, version: IOT_EMBED_VERSION, sessionId: "session-one" };
const message = (type, fields = {}) => ({ ...envelope, type, ...fields });
const binding = (pointKey = "temperature", valueType = "number", staleAfterSeconds = 60) => ({ pointKey, valueType, staleAfterSeconds });
const node = (type = "metric-card", id = type, iotBinding = binding()) => ({ ...createCanvasNode(type, 0, 0, 1), id, ...(iotBinding === false ? {} : { iotBinding }) });
const point = (key = "temperature", value = 42, timestamp = NOW, quality = "good") => ({ key, value, timestamp, quality });
const points = [{ key: "temperature", valueType: "number", staleAfterSeconds: 60 }];
const readyState = () => receiveIotMessage(receiveIotMessage(initialIotRuntimeState(), message("hello"), points, NOW), message("status", { status: "connected", retryCount: 0 }), points, NOW);
const receive = (state, type, fields, definitions = points) => receiveIotMessage(state, message(type, fields), definitions, NOW);
const withValue = (value, quality = "good", timestamp = NOW) => receive(readyState(), "snapshot", { values: [point("temperature", value, timestamp, quality)] });
const doc = (nodes) => ({ projectId: "iot-test", nodes, width: 1920, height: 1080, revision: 0, updatedAt: null, theme: { accentColor: "#00ffff", backgroundColor: "#071525", borderColor: "#115577", glowIntensity: 0, panelRadius: 0, surfaceColor: "#102030", textColor: "#ffffff", backgroundPattern: "grid", fontFamily: "system", mode: "dark", presetId: "deep-blue" } });
const ignore = () => undefined;
const render = (document, props = {}) => renderToStaticMarkup(createElement(NotificationProvider, null, createElement(CanvasSurface, { document, editable: false, selectedNodeId: null, selectedModelSceneNodePath: null, onCreateNode: ignore, onModelSceneNodeSelect: ignore, onNodeChange: ignore, onSelectNode: ignore, ...props })));

test("binding is optional, bounded and strictly typed; point keys are scene variables", () => {
  assert.deepEqual(parseIotBinding(binding(), "metric-card"), { ok: true, value: binding() });
  assert.equal(parseIotBinding(binding("一号入口温度"), "plain-text").ok, true);
  assert.equal(parseIotBinding(binding("x".repeat(IOT_BINDING_LIMITS.maxPointKeyLength)), "plain-text").ok, true);
  for (const key of ["", " temperature", "temperature ", "\u00a0temperature", "temperature\ufeff", "t\nemp", "t\u007femp", "x".repeat(201)]) assert.equal(parseIotBinding(binding(key), "plain-text").ok, false, JSON.stringify(key));
  for (const invalid of [null, [], {}, { ...binding(), extra: true }, binding("x", "object"), binding("x", "number", 0), binding("x", "number", 1.5), binding("x", "number", 86401)]) assert.equal(parseIotBinding(invalid, "metric-card").ok, false);
  assert.equal(parseIotBinding(binding(), "scene-3d").ok, false);
  assert.equal(parseIotBinding(binding("state", "boolean"), "radial-gauge").ok, false);
});

test("manifest deduplicates shared scene variables and rejects conflicts and excess unique points", () => {
  assert.deepEqual(buildIotPointManifest([node("plain-text", "old", false)]), { ok: true, value: [] });
  assert.deepEqual(buildIotPointManifest([node(), node("plain-text", "shared", binding("temperature", "number", 10))]), { ok: true, value: [{ ...points[0], staleAfterSeconds: 10 }] });
  assert.match(buildIotPointManifest([node(), node("plain-text", "conflict", binding("temperature", "string"))]).message, /数据类型不一致/);
  assert.match(buildIotPointManifest([node("plain-text", "bad-node", null)]).message, /bad-node/);
  assert.equal(buildIotPointManifest(Array.from({ length: 500 }, (_, i) => node("plain-text", String(i), binding(String(i))))).ok, true);
  assert.equal(buildIotPointManifest(Array.from({ length: 501 }, (_, i) => node("plain-text", String(i), binding(String(i))))).ok, false);
});

test("embed is opt-in and accepts only an exact HTTP(S) parent origin", () => {
  assert.deepEqual(parseIotEmbedOptions(""), { ok: true, value: { enabled: false } });
  assert.deepEqual(parseIotEmbedOptions("?iotEmbed=1&parentOrigin=http%3A%2F%2Flocalhost%3A8000"), { ok: true, value: { enabled: true, parentOrigin: "http://localhost:8000" } });
  for (const origin of ["", "*", "null", "file:///tmp/a", "https://example.com/", "https://example.com/path", "https://user:pass@example.com"]) assert.equal(parseIotEmbedOptions(`?iotEmbed=1&parentOrigin=${encodeURIComponent(origin)}`).ok, false, origin);
  const parent = {};
  assert.equal(isTrustedIotEvent({ source: parent, origin: "https://iot.test" }, parent, "https://iot.test"), true);
  assert.equal(isTrustedIotEvent({ source: {}, origin: "https://iot.test" }, parent, "https://iot.test"), false);
  assert.equal(isTrustedIotEvent({ source: parent, origin: "https://evil.test" }, parent, "https://iot.test"), false);
});

test("wire messages reject invalid versions, values, quality and fake source times", () => {
  assert.equal(parseIotParentMessage(message("hello")).ok, true);
  assert.equal(parseIotParentMessage(message("hello", { version: 2 })).ok, false);
  assert.equal(parseIotParentMessage(message("hello", { sessionId: "" })).ok, false);
  assert.equal(parseIotParentMessage(message("status", { status: "reconnecting", retryCount: 3, error: "network" })).ok, true);
  assert.equal(parseIotParentMessage(message("status", { status: "ready", retryCount: 0 })).ok, false);
  for (const invalid of [point("temperature", 4, 0), point("temperature", Infinity), point("temperature", null), point("temperature", {}, NOW), point("temperature", 4, -1), point("temperature", 4, NOW, "stale"), point("temperature", "x".repeat(1001))]) assert.equal(parseIotParentMessage(message("updates", { values: [invalid] })).ok, false);
  assert.equal(parseIotParentMessage(message("snapshot", { values: [point("temperature", null, 0, "unknown")] })).ok, true);
  assert.equal(parseIotParentMessage(message("updates", { values: [point(), point()] })).ok, false);
});

test("hello sessions isolate device changes and duplicate hello preserves the active stream", () => {
  const current = withValue(42);
  assert.equal(receiveIotMessage(current, message("updates", { sessionId: "old-device", values: [point("temperature", 77)] }), points, NOW), current);
  assert.equal(receive(current, "hello", {}), current);
  const switched = receive(current, "hello", { sessionId: "new-device" });
  assert.equal(switched.sessionId, "new-device");
  assert.equal(switched.status, "connecting");
  assert.deepEqual(Object.keys(switched.values), []);
});

test("point batches reject undeclared keys, incorrect types and invalid source clocks atomically", () => {
  const current = withValue(42);
  for (const item of [point("other"), point("temperature", "wrong"), point("temperature", 1, NOW + 300001)]) {
    const rejected = receive(current, "updates", { values: [point("temperature", 99), item] });
    assert.equal(rejected.status, "error");
    assert.ok(rejected.error);
    assert.deepEqual(Object.keys(rejected.values), []);
  }
});

test("late historical snapshot cannot replace a newer live value and never fabricates omitted keys", () => {
  const current = withValue(55);
  const late = receive(current, "snapshot", { values: [point("temperature", 12, NOW - 1000)] });
  assert.equal(late.values.temperature.value, 55);
  const empty = receive(late, "snapshot", { values: [] });
  assert.equal(empty.values.temperature, undefined);
  const qualityFailure = receive(current, "updates", { values: [point("temperature", null, 0, "bad")] });
  assert.equal(qualityFailure.values.temperature.quality, "bad");
});

test("prototype-like variable names are ordinary map keys and absent values remain unknown", () => {
  for (const key of ["__proto__", "constructor", "toString"]) {
    const definitions = [{ ...points[0], key }];
    const current = receive(readyState(), "updates", { values: [point(key, 8)] }, definitions);
    assert.equal(current.values[key].value, 8);
    const target = node("plain-text", key, binding(key));
    assert.equal(projectIotRuntimeNode(target, current, NOW).node.props.text, "8");
    assert.equal(projectIotRuntimeNode(target, readyState(), NOW).unavailable, "点位数据未知");
  }
});

test("live projection is immutable, supports the three initial node types and removes sample badges", () => {
  for (const type of ["plain-text", "metric-card", "radial-gauge"]) {
    const original = node(type);
    const saved = JSON.stringify(original);
    const projected = projectIotRuntimeNode(original, withValue(42), NOW);
    assert.equal(projected.unavailable, null);
    assert.equal(projected.node.props[type === "plain-text" ? "text" : "value"], type === "radial-gauge" ? 42 : "42");
    if (type !== "plain-text") assert.equal(projected.node.props.sample, false);
    assert.equal(JSON.stringify(original), saved);
  }
  const original = node("metric-card", "unbound", false);
  assert.equal(projectIotRuntimeNode(original, readyState(), NOW).node, original);
});

test("unknown, bad, stale, incompatible and disconnected values produce explicit states", () => {
  const target = node();
  assert.equal(projectIotRuntimeNode(target, readyState(), NOW).unavailable, "点位数据未知");
  assert.equal(projectIotRuntimeNode(target, withValue(null, "unknown", 0), NOW).unavailable, "点位数据未知");
  assert.equal(projectIotRuntimeNode(target, withValue(null, "bad", 0), NOW).unavailable, "点位质量异常");
  assert.equal(projectIotRuntimeNode(target, withValue(42, "good", NOW - 60001), NOW).unavailable, "数据已过期");
  assert.match(projectIotRuntimeNode(node("radial-gauge"), withValue(10000), NOW).unavailable, /不能大于 maximum/);
  const reconnecting = receive(withValue(42), "status", { status: "reconnecting", retryCount: 3, error: "socket closed" });
  assert.deepEqual(Object.keys(reconnecting.values), []);
  assert.match(projectIotRuntimeNode(target, reconnecting, NOW).unavailable, /网络异常／正在重连（第 3 次）.*socket closed/);
  assert.equal(projectIotRuntimeNode(target, withValue(42), NOW, "parentOrigin 配置错误").unavailable, "parentOrigin 配置错误");
});

test("preview replaces an unavailable bound component without leaking its authored sample", () => {
  const target = node();
  target.props.value = "987654321";
  target.props.title = "入口温度";
  const runtime = projectIotRuntimeNode(target, readyState(), NOW);
  const markup = render(doc([target]), { previewMode: true, iotRuntimeNodes: { [target.id]: runtime } });
  assert.match(markup, /入口温度/);
  assert.match(markup, /点位数据未知/);
  assert.doesNotMatch(markup, /987654321/);
  const editMarkup = render(doc([target]), { previewMode: false, iotRuntimeNodes: { [target.id]: runtime } });
  assert.match(editMarkup, /987654321/);
  assert.doesNotMatch(editMarkup, /点位数据未知/);
});

test("binding inspector explains IoT device properties and stays absent on unrelated components", () => {
  const renderInspector = (target) => renderToStaticMarkup(createElement(IotBindingInspector, { node: target, document: doc([target]), editable: true, onNodeChange: ignore, onValidationChange: ignore }));
  const markup = renderInspector(node("metric-card", "readout", binding("pump-01/temperature")));
  assert.match(markup, /设备 ID \/ 属性 ID/);
  assert.doesNotMatch(markup, /请填写 设备ID\/属性ID/);
  assert.match(markup, /共声明 1 个点位/);
  assert.equal(renderInspector(node("rectangle", "shape", false)), "");
});

test("API validation preserves optional bindings and leaves legacy nodes unmodified", async () => {
  const legacy = node("plain-text", "legacy", false);
  const bound = node();
  const patch = validateCanvasPatch({ expectedRevision: 0, upsertNodes: [legacy, bound], deleteNodeIds: [] });
  assert.equal(Object.hasOwn(patch.upsertNodes[0], "iotBinding"), false);
  assert.deepEqual(patch.upsertNodes[1].iotBinding, binding());
  assert.throws(() => validateCanvasPatch({ expectedRevision: 0, upsertNodes: [{ ...bound, iotBinding: null }], deleteNodeIds: [] }), /IoT/);
  let touchedDatabase = false;
  const env = { get DB() { touchedDatabase = true; throw new Error("Database must not be touched"); } };
  await assert.rejects(applyCanvasPatch(env, "project", {}, patch), (error) => error.status === 501 && error.code === "canvas_iot_binding_not_supported");
  assert.equal(touchedDatabase, false, "legacy backend must reject unsupported bindings before any writes");
});
