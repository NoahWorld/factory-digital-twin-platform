import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TwinActionEditor } from "../src/twin/TwinActionEditor";
import { TwinActionFeedback } from "../src/twin/TwinActionFeedback";
import { emptyTwinActionState, planTwinActions, validateTwinActionTargets } from "../src/twin/useTwinActions";
import { createTwinActionReceiver, parseTwinActionEvent, publishTwinActions, subscribeTwinActions, TWIN_ACTION_EVENT_NAME } from "../src/twin/action-events";

const context = {
  canvasDocument: {
    projectId: "canvas-a",
    nodes: [
      { id: "panel-a", type: "panel-frame", props: { title: "详情面板" }, interaction: { clickActions: [], hiddenInPreview: true } },
      { id: "text-a", type: "plain-text", props: { text: "保存的原文" } },
      { id: "scene-node", type: "scene-3d", props: { sceneProjectId: "scene-a" } },
      { id: "model-node", type: "model-3d", props: {} },
    ],
  },
  assets: [{ assetId: "pump-001", name: "水泵", projectId: "canvas-a" }],
  scenes: [{ projectId: "scene-a", name: "示例场景", instances: [
    { id: "model-a", label: "水泵模型", visible: true, renderMode: "interactive" },
    { id: "hidden-model", label: "隐藏模型", visible: false, renderMode: "interactive" },
  ] }],
};
const newEvent = (overrides = {}) => ({
  type: "twin-actions", version: 1,
  originProjectId: "scene-a", targetProjectId: "canvas-a",
  correlationId: "correlation-a", timestamp: new Date().toISOString(),
  actions: [{ type: "message", title: "消息", text: "设备已选择" }],
  ...overrides,
});

test("one click can change a panel, its message and selected device/model without mutating saved documents", () => {
  const saved = structuredClone(context);
  const initial = emptyTwinActionState();
  const actions = [
    { type: "panel", nodeId: "panel-a", operation: "toggle" },
    { type: "set-text", nodeId: "text-a", text: "点击了水泵" },
    { type: "message", title: "水泵", text: "请查看详情" },
    { type: "select-asset", assetId: "pump-001" },
    { type: "focus-model", projectId: "scene-a", instanceId: "model-a" },
  ];
  const planned = planTwinActions(actions, context, initial);
  assert.deepEqual(planned.state.nodeVisibility, { "panel-a": true });
  assert.deepEqual(planned.state.textOverrides, { "text-a": "点击了水泵" });
  assert.deepEqual(planned.state.messages, [{ title: "水泵", text: "请查看详情" }]);
  assert.deepEqual(planned.effects, actions.slice(3));
  assert.deepEqual(context, saved);
  assert.deepEqual(initial, emptyTwinActionState());
});

test("show, hide and toggle apply in order and respect initial hidden state", () => {
  const first = planTwinActions([
    { type: "panel", nodeId: "panel-a", operation: "show" },
    { type: "panel", nodeId: "panel-a", operation: "toggle" },
    { type: "panel", nodeId: "text-a", operation: "toggle" },
  ], context, emptyTwinActionState());
  assert.deepEqual(first.state.nodeVisibility, { "panel-a": false, "text-a": false });
  const second = planTwinActions([{ type: "panel", nodeId: "text-a", operation: "show" }], context, first.state);
  assert.equal(second.state.nodeVisibility["text-a"], true);
});

test("a later invalid target rejects the whole action group before any mutable state change", () => {
  const initial = emptyTwinActionState();
  assert.throws(() => planTwinActions([
    { type: "message", title: "不能显示", text: "首条消息" },
    { type: "panel", nodeId: "not-authorized", operation: "show" },
  ], context, initial), /动作 2.*canvas-a.*not-authorized/);
  assert.deepEqual(initial, emptyTwinActionState());
});

test("missing context, stale asset/model references and hidden models produce actionable errors", () => {
  const cases = [
    [{ type: "select-asset", assetId: "missing-asset" }, /业务设备 missing-asset 不存在/],
    [{ type: "focus-model", projectId: "other-scene", instanceId: "model-a" }, /other-scene.*未加载.*无权访问/],
    [{ type: "focus-model", projectId: "scene-a", instanceId: "missing-model" }, /scene-a.*missing-model/],
    [{ type: "focus-model", projectId: "scene-a", instanceId: "hidden-model" }, /已隐藏/],
    [{ type: "set-text", nodeId: "panel-a", text: "不能覆盖面板配置" }, /不是纯文本/],
    [{ type: "panel", nodeId: "scene-node", operation: "hide" }, /仅支持纯 2D/],
    [{ type: "panel", nodeId: "model-node", operation: "hide" }, /仅支持纯 2D/],
  ];
  for (const [action, expected] of cases) assert.throws(() => validateTwinActionTargets([action], context), expected);
  assert.throws(() => validateTwinActionTargets([{ type: "panel", nodeId: "panel-a", operation: "show" }], { ...context, canvasDocument: null }), /未关联/);
});

test("action and pending-message budgets reject overload without truncation", () => {
  const message = { type: "message", title: "标题", text: "内容" };
  assert.equal(validateTwinActionTargets(Array.from({ length: 8 }, () => message), context).length, 8);
  assert.throws(() => validateTwinActionTargets(Array.from({ length: 9 }, () => message), context));
  const full = { ...emptyTwinActionState(), messages: Array.from({ length: 32 }, () => ({ title: "标题", text: "内容" })) };
  assert.throws(() => planTwinActions([message], context, full), /32 条/);
  assert.equal(full.messages.length, 32);
});

test("unsupported executable actions and extra fields are rejected, not ignored", () => {
  assert.throws(() => validateTwinActionTargets([{ type: "javascript", code: "alert(1)" }], context));
  assert.throws(() => validateTwinActionTargets([{ type: "message", title: "标题", text: "内容", html: "<script>bad()</script>" }], context));
});

test("editor uses authorized dropdown targets, excludes 3D panel targets and exposes stale references", () => {
  const markup = renderToStaticMarkup(createElement(TwinActionEditor, {
    ...context,
    onChange() {},
    actions: [
      { type: "panel", nodeId: "missing-node", operation: "toggle" },
      { type: "focus-model", projectId: "scene-a", instanceId: "model-a" },
      { type: "select-asset", assetId: "pump-001" },
    ],
  }));
  assert.match(markup, /不可用的组件/);
  assert.match(markup, /水泵模型/);
  assert.match(markup, /水泵.*pump-001/);
  assert.doesNotMatch(markup, /value="scene-node"|value="model-node"/);
  assert.doesNotMatch(markup, /<input/);
  assert.match(markup, /移除动作 1/);
  assert.match(markup, /跨项目聚焦需打开目标 3D 预览/);
});

test("runtime messages are plain text, accessible and absent when unused", () => {
  const props = { messages: [], error: null, onDismissMessage() {}, onDismissError() {} };
  assert.equal(renderToStaticMarkup(createElement(TwinActionFeedback, props)), "");
  const markup = renderToStaticMarkup(createElement(TwinActionFeedback, { ...props, messages: [{ title: "<设备>", text: "<script>alert(1)</script>" }] }));
  assert.match(markup, /<dialog[^>]*aria-describedby=/);
  assert.match(markup, /&lt;script&gt;/);
  assert.doesNotMatch(markup, /<script>/);
  const error = renderToStaticMarkup(createElement(TwinActionFeedback, { ...props, error: "业务资产不存在" }));
  assert.match(error, /role="alert"/);
  assert.match(error, /业务资产不存在/);
});

test("bus validates version, timestamp, extra fields and action shape", () => {
  assert.equal(parseTwinActionEvent(newEvent()).targetProjectId, "canvas-a");
  for (const overrides of [
    { type: "script" }, { version: 2 }, { originProjectId: "" }, { correlationId: null },
    { timestamp: "not-a-date" }, { timestamp: new Date(Date.now() - 6 * 60_000).toISOString() },
    { timestamp: new Date(Date.now() + 6 * 60_000).toISOString() },
    { unknown: true }, { actions: [{ type: "fetch", url: "https://example.invalid" }] },
  ]) assert.throws(() => parseTwinActionEvent(newEvent(overrides)));
});

test("bus isolates target/origin projects and deduplicates the two delivery paths", () => {
  const handled = [];
  const errors = [];
  const receive = createTwinActionReceiver({ targetProjectIds: ["canvas-a"], allowedOriginProjectIds: ["scene-a"], onActions: (event) => handled.push(event), onError: (error) => errors.push(error) });
  const event = newEvent();
  receive(event);
  receive(structuredClone(event));
  receive(newEvent({ correlationId: "other-page", targetProjectId: "canvas-b" }));
  assert.equal(handled.length, 1);
  const previous = console.error;
  console.error = () => {};
  try {
    receive(newEvent({ correlationId: "bad-origin", originProjectId: "unrelated-scene" }));
    receive(newEvent({ correlationId: "bad-action", actions: [{ type: "javascript", code: "evil()" }] }));
  } finally { console.error = previous; }
  assert.equal(handled.length, 1);
  assert.equal(errors.length, 2);
  assert.match(errors[0].message, /未关联项目 unrelated-scene/);
});

test("bus rejects a mismatched focus target before any preceding message or panel action executes", () => {
  const actions = [
    { type: "message", title: "不能部分执行", text: "这条消息也必须拒绝" },
    { type: "focus-model", projectId: "scene-b", instanceId: "model-b" },
  ];
  const mismatched = newEvent({ targetProjectId: "scene-a", actions });
  assert.throws(() => parseTwinActionEvent(mismatched), /scene-b.*scene-a.*整组动作未执行/);
  const handled = [];
  const errors = [];
  const receive = createTwinActionReceiver({ targetProjectIds: ["scene-a"], allowedOriginProjectIds: ["scene-a"], onActions: (event) => handled.push(event), onError: (error) => errors.push(error) });
  const previous = console.error;
  console.error = () => {};
  try { receive(mismatched); } finally { console.error = previous; }
  assert.equal(handled.length, 0);
  assert.equal(errors.length, 1);
  const accepted = newEvent({ targetProjectId: "scene-b", actions });
  assert.equal(parseTwinActionEvent(accepted).actions.length, 2);
});

test("published local actions are not replayed and subscriptions release resources", () => {
  const previousWindow = globalThis.window;
  const previousChannel = globalThis.BroadcastChannel;
  const channels = [];
  globalThis.window = new EventTarget();
  globalThis.BroadcastChannel = class {
    constructor(name) { this.name = name; this.closed = false; channels.push(this); }
    postMessage(event) { this.lastMessage = event; }
    close() { this.closed = true; }
  };
  try {
    const received = [];
    const errors = [];
    const unsubscribe = subscribeTwinActions({ targetProjectIds: ["canvas-a"], allowedOriginProjectIds: ["scene-a"], onActions: (event) => received.push(event), onError: (error) => errors.push(error) });
    const outgoing = publishTwinActions({ originProjectId: "scene-a", targetProjectId: "canvas-a", actions: [{ type: "panel", nodeId: "panel-a", operation: "toggle" }] });
    assert.equal(received.length, 0);
    assert.equal(channels[1].lastMessage.correlationId, outgoing.correlationId);
    assert.equal(channels[1].closed, true);
    const remote = newEvent({ correlationId: "remote-action" });
    window.dispatchEvent(new CustomEvent(TWIN_ACTION_EVENT_NAME, { detail: remote }));
    channels[0].onmessage({ data: remote });
    assert.equal(received.length, 1);
    assert.equal(errors.length, 0);
    unsubscribe();
    assert.equal(channels[0].closed, true);
    window.dispatchEvent(new CustomEvent(TWIN_ACTION_EVENT_NAME, { detail: newEvent({ correlationId: "after-cleanup" }) }));
    assert.equal(received.length, 1);
    const unsubscribeAgain = subscribeTwinActions({ targetProjectIds: ["canvas-a", "newly-embedded-scene"], allowedOriginProjectIds: ["scene-a", "newly-loaded-scene"], onActions: (event) => received.push(event), onError: (error) => errors.push(error) });
    // React dependency changes must not let the delayed BroadcastChannel copy run a second toggle.
    channels[2].onmessage({ data: remote });
    assert.equal(received.length, 1);
    unsubscribeAgain();
  } finally {
    globalThis.window = previousWindow;
    globalThis.BroadcastChannel = previousChannel;
  }
});

test("broadcast transport failures are visible instead of reporting a successful sync", () => {
  const previousWindow = globalThis.window;
  const previousChannel = globalThis.BroadcastChannel;
  const previousError = console.error;
  globalThis.window = new EventTarget();
  globalThis.BroadcastChannel = undefined;
  console.error = () => {};
  try {
    const errors = [];
    const unsubscribe = subscribeTwinActions({ targetProjectIds: ["canvas-a"], allowedOriginProjectIds: ["scene-a"], onActions() {}, onError: (error) => errors.push(error) });
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /无法接收跨页面交互/);
    assert.throws(() => publishTwinActions({ originProjectId: "scene-a", targetProjectId: "canvas-a", actions: [] }), /本页交互已执行，但无法同步其他页面/);
    unsubscribe();
  } finally {
    globalThis.window = previousWindow;
    globalThis.BroadcastChannel = previousChannel;
    console.error = previousError;
  }
});
