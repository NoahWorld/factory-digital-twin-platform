import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasSurface } from "../src/canvas/CanvasSurface";
import { ComponentInspector } from "../src/canvas/ComponentInspector";
import { TwinActionEditor } from "../src/twin/TwinActionEditor";
import { createCanvasNode } from "../src/canvas/types";
import { canvasViewportScale, isOverlayNode, isRuntimeNodeVisible, projectRuntimeNode, runtimeNodeCapturesPointer } from "../src/canvas/runtime-projection";

const node = (type, id = type) => ({ ...createCanvasNode(type, 0, 0, 1), id });
const doc = (nodes) => ({ projectId: "test-2d", nodes, width: 1920, height: 1080, revision: 0, updatedAt: null, theme: { accentColor: "#00ffff", backgroundColor: "#071525", borderColor: "#115577", glowIntensity: 0, panelRadius: 0, surfaceColor: "#102030", textColor: "#ffffff", backgroundPattern: "grid", fontFamily: "system", mode: "dark", presetId: "deep-blue" } });
const ignore = () => undefined;
const render = (document, props = {}) => renderToStaticMarkup(createElement(CanvasSurface, { document, editable: false, selectedNodeId: null, selectedModelSceneNodePath: null, onCreateNode: ignore, onModelSceneNodeSelect: ignore, onNodeChange: ignore, onSelectNode: ignore, ...props }));

test("overlay includes the real fullscreen button but excludes recursive 3D nodes and background texture", () => {
  const markup = render(doc([node("fullscreen-toggle"), node("scene-3d"), node("model-3d")]), { presentation: "overlay" });
  assert.match(markup, /data-node-id="fullscreen-toggle"/);
  assert.doesNotMatch(markup, /data-node-id="(?:scene-3d|model-3d)"/);
  assert.doesNotMatch(markup, /data-canvas-fullscreen-root|canvas-theme-pattern/);
  assert.match(markup, /background-color:transparent/);
  assert.match(markup, /pointer-events:none/);
  assert.match(markup, /pointer-events:auto/);
});

test("normal canvas keeps its fullscreen target and authored background", () => {
  const markup = render(doc([node("plain-text")]));
  assert.match(markup, /data-canvas-fullscreen-root="true"/);
  assert.match(markup, /canvas-theme-pattern/);
  assert.match(markup, /background-color:#071525/);
});

test("decorative overlay regions pass through, only controls and configured action nodes intercept", () => {
  assert.equal(runtimeNodeCapturesPointer(node("rectangle")), false);
  assert.equal(runtimeNodeCapturesPointer(node("plain-text")), false);
  assert.equal(runtimeNodeCapturesPointer(node("fullscreen-toggle")), true);
  assert.equal(runtimeNodeCapturesPointer({ ...node("plain-text"), interaction: { clickActions: [{ type: "message", title: "消息", text: "文本" }], hiddenInPreview: false } }), true);
  assert.equal(isOverlayNode(node("scene-3d")), false);
  assert.equal(isOverlayNode(node("image")), true);
});

test("runtime visibility and text changes never mutate the saved node", () => {
  const original = { ...node("plain-text", "details"), interaction: { clickActions: [], hiddenInPreview: true } };
  const before = JSON.stringify(original);
  assert.equal(isRuntimeNodeVisible(original, {}), false);
  assert.equal(isRuntimeNodeVisible(original, { details: true }), true);
  const projected = projectRuntimeNode(original, { details: "设备运行中" });
  assert.equal(projected.props.text, "设备运行中");
  assert.equal(JSON.stringify(original), before);
  assert.equal(projectRuntimeNode(original, {}), original);
  assert.doesNotMatch(render(doc([original])), /data-node-id="details"/);
  assert.match(render(doc([original]), { editable: true }), /data-node-id="details"/);
  assert.match(render(doc([original]), { runtimeNodeVisibility: { details: true }, runtimeTextOverrides: { details: "设备运行中" } }), /设备运行中/);
});

test("overlay fits without an editor inset or 1x ceiling; fullscreen keeps cover scaling", () => {
  assert.equal(canvasViewportScale(3840, 2160, 1920, 1080, true, false), 2);
  assert.equal(canvasViewportScale(1920, 1080, 1920, 1080, true, false), 1);
  assert.equal(canvasViewportScale(1920, 1200, 1920, 1080, true, true), 1200 / 1080);
  assert.equal(canvasViewportScale(3840, 2160, 1920, 1080, false, false), 1);
  assert.equal(canvasViewportScale(1920, 1080, 1920, 1080, false, false), 1032 / 1080);
});

test("click actions get keyboard access and href-free buttons retain native button semantics", () => {
  const text = { ...node("plain-text"), interaction: { clickActions: [{ type: "message", title: "消息", text: "详情" }], hiddenInPreview: false } };
  assert.match(render(doc([text])), /role="button"[^>]*tabindex="0"/);
  const button = node("button");
  button.props.href = "";
  assert.match(render(doc([button])), /<button class="basic-button-link basic-action-button"/);
});

test("node click capture ignores events bubbled through React from portal dropdowns", () => {
  const surface = readFileSync("apps/web/src/canvas/CanvasSurface.tsx", "utf8");
  const captureHandler = surface.slice(surface.indexOf("onClickCapture={"), surface.indexOf("onKeyDown={"));
  assert.match(captureHandler, /if \(event\.currentTarget\.contains\(event\.target as Node\)\) onNodeActions\?\.\(node\)/);
});

test("read-only editing still exposes hidden nodes without enabling runtime interactions", () => {
  const text = { ...node("plain-text", "hidden-details"), interaction: { clickActions: [{ type: "message", title: "消息", text: "详情" }], hiddenInPreview: true } };
  const markup = render(doc([text]), { previewMode: false });
  assert.match(markup, /data-node-id="hidden-details"/);
  assert.doesNotMatch(markup, /role="button"|tabindex="0"/);
  assert.doesNotMatch(render(doc([{ ...text, interaction: { ...text.interaction, hiddenInPreview: false } }]), { runtimeControlsEnabled: false }), /role="button"|tabindex="0"/);
});

test("3D references direct event editing to the source scene instead of exposing unsupported 2D actions", () => {
  for (const type of ["scene-3d", "model-3d"]) {
    const markup = renderToStaticMarkup(createElement(ComponentInspector, { editable: true, node: node(type), onNodeChange: ignore, onModelEditorOpen: ignore, onValidationChange: ignore, projectId: "test-2d" }));
    assert.match(markup, /模型点击事件请在源 3D 项目中配置/);
    assert.doesNotMatch(markup, /预览时默认隐藏（由联动事件显示）/);
  }
});

test("authored dropdowns use the shared combobox and preserve selected text and editor locking", () => {
  const dropdown = node("select", "authored-dropdown");
  dropdown.props.label = "设备选择";
  dropdown.props.options = [{ value: "pump", label: "循环水泵" }, { value: "tower", label: "冷却塔" }];
  dropdown.props.selectedValue = "tower";
  const preview = render(doc([dropdown]));
  assert.match(preview, /role="combobox"/);
  assert.match(preview, /aria-label="设备选择"/);
  assert.match(preview, /冷却塔/);
  assert.doesNotMatch(preview, /<select\b|<option\b/);
  const editing = render(doc([dropdown]), { editable: true });
  assert.match(editing, /<button[^>]*disabled=""[^>]*role="combobox"|<button[^>]*role="combobox"[^>]*disabled=""/);
});

test("action target comboboxes keep unavailable references visible and inherit read-only fieldsets", () => {
  const actions = [
    { type: "select-asset", assetId: "missing-pump" },
    { type: "panel", nodeId: "missing-panel", operation: "show" },
    { type: "focus-model", projectId: "missing-scene", instanceId: "missing-model" },
  ];
  const markup = renderToStaticMarkup(createElement(TwinActionEditor, { actions, onChange: ignore, disabled: true }));
  assert.doesNotMatch(markup, /<select\b|<option\b/);
  assert.match(markup, /不可用的设备（missing-pump）/);
  assert.match(markup, /不可用的组件（missing-panel）/);
  assert.match(markup, /不可用的场景（missing-scene）/);
  assert.match(markup, /不可用的模型（missing-model）/);
  assert.equal((markup.match(/<fieldset[^>]*disabled=""/g) ?? []).length, actions.length);
});
