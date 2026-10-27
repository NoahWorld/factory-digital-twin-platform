import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TwinActionEditor } from "../src/twin/TwinActionEditor";
import { TwinActionFeedback } from "../src/twin/TwinActionFeedback";
import { emptyTwinActionState, planTwinActions, validateTwinActionTargets } from "../src/twin/useTwinActions";
import { createTwinActionReceiver, parseTwinActionEvent, publishTwinActions, subscribeTwinActions, TWIN_ACTION_EVENT_NAME } from "../src/twin/action-events";
import { runtimeNodeModelSelected } from "../src/canvas/runtime-projection";

test("model selection highlights only controls with one matching explicit scene target", () => {
  const focus = { type: "focus-model", projectId: "scene-a", instanceId: "model-a" };
  const node = { type: "button", interaction: { clickActions: [focus], hiddenInPreview: false } };
  assert.equal(runtimeNodeModelSelected(node, { "scene-a": "model-a" }), true);
  assert.equal(runtimeNodeModelSelected({ ...node, type: "vector-icon" }, { "scene-a": "model-b" }), false);
  assert.equal(runtimeNodeModelSelected(node, { "scene-b": "model-a" }), false);
  assert.equal(runtimeNodeModelSelected({ ...node, type: "plain-text" }, { "scene-a": "model-a" }), undefined);
  assert.equal(runtimeNodeModelSelected({ ...node, interaction: { clickActions: [focus, { ...focus, instanceId: "model-b" }] } }, { "scene-a": "model-a" }), undefined);
  assert.equal(runtimeNodeModelSelected({ type: "button" }, { "scene-a": "model-a" }), undefined);
});

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


// A real authored canvas exercises cross-component gates and reference validation.
import { composeCanvas, composeScene } from "../../../demo-assets/silver-nitrate-workshop/author";
import { sceneFluidBindings } from "../../../demo-assets/silver-nitrate-workshop/process-configuration";
import { parseCanvasNodeInteraction, parseTwinActions } from "../../../shared/twin-actions";
import { validFluidBindings } from "../../../shared/scene-playback";
import { projectPlaybackNode, projectPlaybackScene } from "../src/twin/playback-projection";
import { linkedPlaybackBindings, projectRuntimePlayback } from "../src/twin/preview-playback";
import { parseSceneDecorations } from "../../../shared/scene-decorations";
import { isOrnamentNodeType, parseOrnamentProps } from "../../../shared/canvas-ornaments";
const authored = composeCanvas("scene-a");
const authoredScene = {...composeScene({}, true), projectId:"scene-a", name:"工艺场景", settings:{playAnimations:true,autoRotate:true}};
const authoredContext = {canvasDocument:{projectId:"board",...authored},scenes:[authoredScene],assets:[],selection:{"scene-a":"silver-neutral"}};
const control = (target,operation="toggle") => ({type:"scene-playback",projectId:"scene-a",target,operation});
test("native process diagram is selectable, bounded and has valid scene / fluid bindings",()=>{
  assert.ok(authored.nodes.length <= 100);
  assert.equal(new Set(authored.nodes.map(n=>n.id)).size,authored.nodes.length);
  for(const node of authored.nodes){
    assert.ok(node.x>=0 && node.y>=0 && node.x+node.width<=1920 && node.y+node.height<=1080,node.id);
    if(isOrnamentNodeType(node.type)) {
      const parsed = parseOrnamentProps(node.type,node.props);
      assert.equal(parsed.ok,true,node.id);
      assert.deepEqual(parsed.value,node.props,`${node.id}: authored props must match the persistence contract without discarded fields`);
    }
    if(node.interaction){assert.equal(parseCanvasNodeInteraction(node.interaction).ok,true,node.id);validateTwinActionTargets(node.interaction.clickActions,authoredContext);}
  }
  assert.equal(validFluidBindings(sceneFluidBindings()),true);
  assert.equal(parseSceneDecorations(authoredScene.decorations).ok,true);
  assert.equal(authoredScene.decorations.filter(d=>d.kind==="security-camera").length,3);
  assert.equal(projectPlaybackScene(authoredScene,{},sceneFluidBindings()),authoredScene);
  assert.throws(()=>projectPlaybackScene(authoredScene,{},[{instanceId:"missing",fluidIds:[]}]),/missing/);
  assert.throws(()=>projectPlaybackScene(authoredScene,{},[{instanceId:"silver-neutral",fluidIds:["missing-flow"]}]),/missing-flow/);
});
test("global pause preserves independent device gates and resume keeps manually paused equipment stopped",()=>{
  const before=structuredClone(authoredScene);
  let state=planTwinActions([control("selected","pause")],authoredContext,emptyTwinActionState()).state;
  state=planTwinActions([control("scene","pause")],authoredContext,state).state;
  let scene=projectPlaybackScene(authoredScene,state.playback,sceneFluidBindings());
  assert.equal(scene.settings.playAnimations,false);assert.equal(scene.settings.autoRotate,false);
  assert.ok(scene.fluids.every(f=>!f.playing));
  state=planTwinActions([control("scene","play")],authoredContext,state).state;
  scene=projectPlaybackScene(authoredScene,state.playback,sceneFluidBindings());
  assert.equal(scene.instances.find(i=>i.id==="silver-neutral").animation.enabled,false);
  assert.equal(scene.instances.find(i=>i.id==="silver-evaporator").animation.enabled,true);
  assert.equal(scene.fluids.find(f=>f.id==="silver-n-e").playing,false);
  assert.equal(scene.fluids.find(f=>f.id==="silver-vapor").playing,true);
  const pipe=authored.nodes.find(n=>n.id==="silver-pid-pipe-n-e");
  assert.equal(projectPlaybackNode(pipe,state.playback,authoredContext.selection).props.flowing,false);
  state=planTwinActions([control("selected","play")],authoredContext,state).state;
  assert.equal(projectPlaybackNode(pipe,state.playback,authoredContext.selection).props.flowing,true);
  assert.deepEqual(authoredScene,before);
});
test("2D view switches as one group and unavailable actions fail without partial effects",()=>{
  const action={type:"panel-group",groupId:"silver-process-view",operation:"show"};
  assert.throws(()=>planTwinActions([{...action,operation:["show"]}],authoredContext,emptyTwinActionState()),/显示分组或操作无效/);
  const state=planTwinActions([action],authoredContext,emptyTwinActionState()).state;
  const grouped=authored.nodes.filter(n=>n.interaction?.visibilityGroup===action.groupId);
  assert.ok(grouped.length>30);assert.ok(grouped.every(n=>state.nodeVisibility[n.id]));
  assert.equal(state.nodeVisibility["silver-scene"],undefined);
  const hidden=planTwinActions([{...action,operation:"hide"}],authoredContext,state).state;
  assert.ok(grouped.every(n=>hidden.nodeVisibility[n.id]===false));
  assert.throws(()=>planTwinActions([action,control(["missing"])],authoredContext,emptyTwinActionState()),/missing/);
  assert.throws(()=>planTwinActions([control("selected")],{...authoredContext,selection:{}},emptyTwinActionState()),/先选择/);
  const button=authored.nodes.find(n=>n.id==="silver-device-playback");
  assert.equal(projectPlaybackNode(button,{},{}).props.disabled,true);
  assert.equal(projectPlaybackNode(button,{"scene-a":{playing:false,instances:{}}},authoredContext.selection).props.text,"整线已暂停");
});
test("playback declarations reject empty, duplicate and executable targets",()=>{
  for(const target of [[],["x","x"],["x\n"],{script:"x"}])assert.equal(parseTwinActions([control(target)]).ok,false);
  assert.equal(parseCanvasNodeInteraction({clickActions:[],hiddenInPreview:false,playbackBinding:{projectId:"a",target:"scene",url:"x"}}).ok,false);
  assert.equal(validFluidBindings([{instanceId:"a",fluidIds:["x","x"]}]),false);
});

test("standalone preview resolves all linked views and reports invalid binding references", () => {
  const scene = { projectId: "scene-a", instances: [{ id: "pump" }], fluids: [{ id: "water" }, { id: "steam" }] };
  const view = (id, sceneProjectId, playbackBindings) => ({ id, type: "scene-3d", props: { sceneProjectId, interactionEnabled: true, playbackBindings } });
  const canvas = { nodes: [
    view("first", "scene-a", [{ instanceId: "pump", fluidIds: ["water"] }]),
    view("second", "scene-a", [{ instanceId: "pump", fluidIds: ["water", "steam"] }]),
    view("other", "scene-b", [{ instanceId: "other-pump", fluidIds: ["other-water"] }]),
  ] };
  const before = structuredClone(canvas);
  assert.deepEqual(linkedPlaybackBindings(scene, canvas), { ok: true, value: [{ instanceId: "pump", fluidIds: ["water", "steam"] }] });
  assert.deepEqual(linkedPlaybackBindings(scene, null), { ok: true, value: [] });
  assert.deepEqual(canvas, before);
  assert.match(linkedPlaybackBindings(scene, { nodes: [view("broken", "scene-a", [{ instanceId: "pump", fluidIds: ["missing"] }])] }).message, /broken.*missing/);
  assert.match(linkedPlaybackBindings(scene, { nodes: [view("malformed", "scene-a", [{ instanceId: "pump", fluidIds: ["water", "water"] }])] }).message, /malformed.*绑定无效/);
});

test("preview playback gates IoT-projected fluids without overriding live properties or restarting stopped flow", () => {
  const scene = { projectId: "scene-a", settings: { playAnimations: true, autoRotate: true },
    instances: [{ id: "pump", visible: true, renderMode: "interactive", animation: { enabled: true, speed: 1 } }],
    fluids: [{ id: "water", playing: true, speed: 1, color: "#fff" }, { id: "steam", playing: true, speed: 1, color: "#fff" }],
  };
  const runtimeFluids = [{ id: "water", playing: true, speed: 2.5, color: "#13c8a3" }, { id: "steam", playing: false, speed: 0, color: "#ff3300" }];
  const bindings = [{ instanceId: "pump", fluidIds: ["water", "steam"] }];
  const before = structuredClone({ scene, runtimeFluids });
  const initialProjection = projectRuntimePlayback(scene, runtimeFluids, undefined, bindings);
  assert.deepEqual(initialProjection.fluids, runtimeFluids);
  assert.equal(initialProjection.settings.playAnimations, true);
  const actionContext = { canvasDocument: null, assets: [], scenes: [scene], selection: { "scene-a": "pump" } };
  let state = planTwinActions([control("selected", "pause")], actionContext, emptyTwinActionState()).state;
  let projected = projectRuntimePlayback(scene, runtimeFluids, state.playback, bindings);
  assert.ok(projected.fluids.every(fluid => !fluid.playing));
  assert.equal(projected.instances[0].animation.enabled, false);
  assert.equal(projected.fluids[0].speed, 2.5);
  assert.equal(projected.fluids[0].color, "#13c8a3");
  state = planTwinActions([control("selected", "play")], actionContext, state).state;
  projected = projectRuntimePlayback(scene, runtimeFluids, state.playback, bindings);
  assert.equal(projected.fluids[0].playing, true);
  assert.equal(projected.fluids[1].playing, false);
  assert.equal(projected.fluids[1].color, "#ff3300");
  state = planTwinActions([control("scene", "pause")], actionContext, state).state;
  projected = projectRuntimePlayback(scene, runtimeFluids, state.playback, bindings);
  assert.equal(projected.settings.playAnimations, false);
  assert.ok(projected.fluids.every(fluid => !fluid.playing));
  assert.deepEqual({ scene, runtimeFluids }, before);
});

test("selected equipment detail and controls share the same preview playback state", () => {
  const selection = { "scene-a": "pump" };
  const binding = { projectId: "scene-a", target: "selected" };
  const detail = { type: "plain-text", props: { text: "设备状态" }, interaction: { playbackBinding: binding, clickActions: [] } };
  const button = { type: "button", props: { text: "启停" }, interaction: { clickActions: [control("selected")] } };
  const state = { "scene-a": { playing: true, instances: { pump: false } } };
  assert.equal(projectPlaybackNode(detail, state, selection).props.text, "已暂停");
  assert.equal(projectPlaybackNode(button, state, selection).props.text, "启动该设备");
  assert.equal(projectPlaybackNode(button, state, selection).props.disabled, false);
  assert.equal(projectPlaybackNode(button, state, {}).props.disabled, true);
});
