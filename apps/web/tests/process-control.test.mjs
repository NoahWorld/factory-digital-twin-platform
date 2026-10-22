import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as THREE from 'three';
import { createPipeProps, parsePipeProps, pipeEndpoint, pipeRoute, validatePipeReferences, parseStateBinding, evaluateStateBinding } from '../../../shared/process-control';
import { buildIotPointManifest } from '../../../shared/iot-embed';
import { createFluidDefinition, parseFluids } from '../../../shared/fluids';
import { createCanvasNode } from '../src/canvas/types';
import { initialIotRuntimeState, projectIotRuntimeNode, projectIotFluid } from '../src/canvas/iot-runtime';
import { ProcessPipe } from '../src/canvas/ProcessPipe';
import { FluidManager } from '../src/scene/fluid-manager';
import { RoomAlarmSceneNode } from '../src/scene/RoomAlarmSceneNode';
import { PublicationRunPage } from '../src/publications';
import { NotificationProvider } from '../src/components/NotificationProvider';
import { canvasThemePresets } from '../src/canvas/themes';
import { fluidHookCalls, renderedModels, setFluidRuntime } from './fixtures/room-alarm-renderer-probe.mjs';
import { canvasHookCalls, setPublicationRuntime } from './fixtures/publication-runtime-probe.mjs';

const NOW = 1_800_000_000_000;
const rule = (value = 1, overrides = {}) => ({ label: '运行', operator: 'eq', value, color: '#22c55e', visible: true, flowing: true, direction: 'forward', speed: 2, ...overrides });
const binding = (overrides = {}) => ({ pointKey: 'pump/running', valueType: 'number', staleAfterSeconds: 10, states: [rule(0, { label: '停止', flowing: false, color: '#94a3b8' }), rule()], ...overrides });
const point = (value = 1, overrides = {}) => ({ key: 'pump/running', value, quality: 'good', timestamp: NOW, ...overrides });
const runtime = (value = 1, overrides = {}) => ({ ...initialIotRuntimeState(), status: 'connected', values: { 'pump/running': point(value) }, ...overrides });
const node = (type, id, x = 100, y = 100) => ({ ...createCanvasNode(type, x, y, 1), id });
const a = node('rectangle', 'tank'), b = node('rectangle', 'reactor', 700, 300);
const pipe = { ...node('process-pipe', 'pipe'), props: { ...createPipeProps(200, 200), source: { nodeId: 'tank', port: 'right', x: 0, y: 0 }, target: { nodeId: 'reactor', port: 'left', x: 0, y: 0 }, waypoints: [{ x: 500, y: 200 }] }, stateBinding: binding() };

test('orthogonal pipe follows moved/resized equipment, retains waypoints and permits shared branch ports', () => {
  const original = structuredClone(pipe);
  for (const routing of ['horizontal', 'vertical']) {
    const route = pipeRoute({ ...pipe.props, routing }, [a, b]);
    assert.deepEqual(route[0], { x: a.x + a.width, y: a.y + a.height / 2 });
    assert.deepEqual(route.at(-1), { x: b.x, y: b.y + b.height / 2 });
    assert.ok(route.some(p => p.x === 500 && p.y === 200));
    for (let i = 1; i < route.length; i++) assert.ok(route[i].x === route[i - 1].x || route[i].y === route[i - 1].y);
  }
  const moved = { ...a, x: 200, width: a.width + 80 };
  assert.equal(pipeRoute(pipe.props, [moved, b])[0].x, moved.x + moved.width);
  assert.equal(validatePipeReferences([a, b, pipe, { ...pipe, id: 'branch' }]).ok, true);
  assert.equal(validatePipeReferences([b, pipe]).ok, false);
  assert.throws(() => pipeEndpoint(pipe.props.source, [b]), /不存在/);
  assert.equal(validatePipeReferences([a, b, { ...pipe, props: { ...pipe.props, target: { ...pipe.props.target, nodeId: 'pipe' } } }]).ok, false);
  assert.deepEqual(pipe, original);
});

test('pipe contracts reject unknown fields, malformed anchors and invalid geometry budgets', () => {
  assert.equal(parsePipeProps(pipe.props).ok, true);
  const props = createPipeProps(0, 0);
  for (const invalid of [{ ...props, extra: 1 }, { ...props, width: 0 }, { ...props, speed: Infinity }, { ...props, label: ' ' }, { ...props, source: { ...props.source, nodeId: '' } }, { ...props, target: { ...props.target, port: 'near' } }, { ...props, waypoints: Array(33).fill({ x: 1, y: 2 }) }, { ...props, waypoints: [{ x: -1, y: 2 }] }]) assert.equal(parsePipeProps(invalid).ok, false);
});

test('state rules use exact types, first-match numeric comparisons and explicit stop/hide/reverse', () => {
  const numeric = binding({ states: [rule(10, { operator: 'gte', label: '高位', direction: 'reverse' }), rule(0, { operator: 'gte' })] });
  assert.equal(evaluateStateBinding(numeric, point(11), NOW, null).value.label, '高位');
  assert.equal(evaluateStateBinding(numeric, point(11), NOW, null).value.direction, 'reverse');
  assert.equal(evaluateStateBinding(binding(), point(0), NOW, null).value.flowing, false);
  assert.equal(evaluateStateBinding(binding({ states: [rule(1, { speed: 0, visible: false })] }), point(), NOW, null).value.flowing, false);
  for (const [valueType, value] of [['boolean', true], ['string', 'running']]) {
    const config = binding({ valueType, states: [rule(value)] });
    assert.equal(parseStateBinding(config).ok, true);
    assert.equal(evaluateStateBinding(config, point(value), NOW, null).ok, true);
    assert.equal(parseStateBinding({ ...config, states: [rule(value, { operator: 'gt' })] }).ok, false);
  }
  for (const invalid of [{ ...binding(), extra: true }, binding({ staleAfterSeconds: .5 }), binding({ pointKey: 'host.url' }), binding({ states: [] }), binding({ states: Array(9).fill(rule()) }), binding({ states: [rule('1')] }), binding({ states: [rule(NaN)] })]) assert.equal(parseStateBinding(invalid).ok, false);
});

test('missing, bad, stale, future, mismatched and unmatched data never show a running state', () => {
  for (const observation of [undefined, point(null, { quality: 'unknown' }), point(1, { quality: 'bad' }), point(1, { timestamp: NOW - 10001 }), point(1, { timestamp: NOW + 300001 }), point(1, { timestamp: 0 }), point('1'), point(99)]) assert.equal(evaluateStateBinding(binding(), observation, NOW, null).ok, false);
  assert.equal(evaluateStateBinding(binding(), point(1, { timestamp: NOW - 10000 }), NOW, null).ok, true);
  const original = structuredClone(pipe);
  for (const state of [runtime(99), runtime(1, { status: 'disconnected' }), runtime(1, { values: {} }), runtime(1, { status: 'reconnecting', retryCount: 3, error: '请求失败' })]) {
    const projected = projectIotRuntimeNode(pipe, state, NOW);
    assert.equal(projected.node.props.flowing, false);
    assert.equal(projected.node.props.color, '#94a3b8');
    assert.ok(projected.unavailable);
  }
  assert.match(projectIotRuntimeNode(pipe, runtime(1, { status: 'reconnecting', retryCount: 3, error: '请求失败' }), NOW).unavailable, /网络异常／正在重连（第 3 次）.*请求失败/);
  const active = projectIotRuntimeNode(pipe, runtime(), NOW);
  assert.equal(active.node.props.flowing, true);
  assert.equal(active.stateLabel, '运行');
  assert.equal(projectIotRuntimeNode(pipe, runtime(), NOW + 10001).node.props.flowing, false);
  assert.deepEqual(pipe, original);
});

test('value and state bindings share point requests and reject conflicting types', () => {
  const text = { ...node('plain-text', 'readout'), iotBinding: { pointKey: 'pump/running', valueType: 'number', staleAfterSeconds: 5 } };
  assert.deepEqual(buildIotPointManifest([pipe, text]).value, [{ key: 'pump/running', valueType: 'number', staleAfterSeconds: 5 }]);
  assert.equal(buildIotPointManifest([pipe, { ...text, iotBinding: { ...text.iotBinding, valueType: 'string' } }]).ok, false);
  assert.equal(projectIotRuntimeNode({ ...a, stateBinding: binding() }, runtime(), NOW).node.props.fillColor, '#22c55e');
  assert.equal(projectIotRuntimeNode({ ...node('vector-icon', 'pump'), stateBinding: binding() }, runtime(), NOW).node.props.iconColor, '#22c55e');
  const hidden = binding({ states: [rule(1, { visible: false })] });
  assert.equal(projectIotRuntimeNode({ ...pipe, stateBinding: hidden }, runtime(), NOW).visible, false);
  assert.equal(projectIotRuntimeNode({ ...pipe, stateBinding: hidden }, runtime(99), NOW).visible, true);
});

test('rendered pipe has accessible edit handles and removes animated flow on data failure', () => {
  const document = { nodes: [a, b, pipe], width: 1920, height: 1080, theme: { textColor: '#ffffff' } };
  const props = { document, editable: true, selected: true, onSelect() {}, onChange() {} };
  const active = projectIotRuntimeNode(pipe, runtime(), NOW);
  const markup = renderToStaticMarkup(createElement(ProcessPipe, { ...props, node: active.node, stateLabel: active.stateLabel }));
  assert.match(markup, /拖动管路起点/);
  assert.match(markup, /拖动管路途经点 1/);
  assert.match(markup, /process-pipe-flow/);
  const stale = projectIotRuntimeNode(pipe, runtime(), NOW + 10001);
  const failed = renderToStaticMarkup(createElement(ProcessPipe, { ...props, node: stale.node, error: stale.unavailable }));
  assert.doesNotMatch(failed, /class="process-pipe-flow"/);
  assert.match(failed, /数据已过期/);
});

test('3D fluid state survives serialization, drives shared renderer and stops without changing authored settings', () => {
  const fluid = { ...createFluidDefinition('flow'), points: [[0, 0, 0], [10, 0, 0]], stateBinding: binding() };
  assert.equal(parseFluids(JSON.parse(JSON.stringify([fluid]))).ok, true);
  assert.equal(parseFluids([{ ...fluid, stateBinding: binding({ states: [rule('wrong')] }) }]).ok, false);
  const runtime3d = new FluidManager(new THREE.Group());
  const flowing = projectIotFluid(fluid, runtime(), NOW);
  runtime3d.reconcile([flowing.fluid]);
  runtime3d.update(.5, true, 1);
  const mesh = runtime3d.getObjects()[0].getObjectByName('fluid-particles');
  const positions = Array.from(mesh.geometry.getAttribute('aCenter').array);
  const stale = projectIotFluid(fluid, runtime(), NOW + 10001);
  assert.match(stale.error, /数据已过期/);
  runtime3d.reconcile([stale.fluid]);
  runtime3d.update(1, true, 1);
  assert.deepEqual(Array.from(mesh.geometry.getAttribute('aCenter').array), positions);
  assert.equal(mesh.material.uniforms.uColor.value.getHexString(), '94a3b8');
  const reversed = { ...fluid, stateBinding: binding({ states: [rule(1, { direction: 'reverse' })] }) };
  runtime3d.reconcile([projectIotFluid(reversed, runtime(), NOW).fluid]);
  assert.equal(runtime3d.getObjects()[0].getObjectByName('fluid-surface').material.uniforms.uDirection.value, -1);
  assert.equal(fluid.direction, 'forward');
  assert.equal(fluid.playing, true);
  runtime3d.dispose();
});

test('shared embedded and published scene wrapper forwards live fluids and visible failures instead of authored playback', () => {
  const fluid = { ...createFluidDefinition('embedded-flow'), points: [[0, 0, 0], [10, 0, 0]], stateBinding: binding({ states: [rule(1, { direction: 'reverse', visible: false })] }) };
  const scene = { projectId: 'scene', linked2dProjectId: null, fluids: [fluid], roomAlarms: [], decorations: [] };
  const authored = structuredClone(scene);
  const render = (projection, rendererProps) => {
    renderedModels.length = 0;
    setFluidRuntime({ fluids: [projection.fluid], errors: projection.error ? [projection.error] : [] });
    const markup = renderToStaticMarkup(createElement(RoomAlarmSceneNode, { scene, rendererProps }));
    assert.equal(renderedModels.length, 1);
    assert.deepEqual(fluidHookCalls, [{ scene, enabled: true }]);
    assert.equal(renderedModels[0].fluids[0], projection.fluid);
    return markup;
  };

  // Embedded callers already have authored fluids in their renderer props;
  // published scenes omit them. Both must use the same live projection.
  for (const rendererProps of [{ fluids: scene.fluids }, {}]) {
    const active = projectIotFluid(fluid, runtime(), NOW);
    assert.doesNotMatch(render(active, rendererProps), /process-runtime-error/);
    assert.equal(active.fluid.color, '#22c55e');
    assert.equal(active.fluid.playing, true);
    assert.equal(active.fluid.direction, 'reverse');
    assert.equal(active.fluid.visible, false);

    for (const failed of [projectIotFluid(fluid, initialIotRuntimeState(), NOW), projectIotFluid(fluid, runtime(), NOW + 10001)]) {
      const markup = render(failed, rendererProps);
      assert.match(markup, /process-runtime-error/);
      assert.ok(markup.includes(failed.error));
      assert.equal(failed.fluid.color, '#94a3b8');
      assert.equal(failed.fluid.playing, false);
      assert.equal(failed.fluid.visible, true);
    }
  }
  assert.deepEqual(scene, authored);
});

test('published 3D scenes enable linked canvas data and render the projected overlay pipe state', () => {
  const fluid = { ...createFluidDefinition('published-flow'), points: [[0, 0, 0], [10, 0, 0]], stateBinding: binding() };
  const scene = { projectId: 'published-scene', linked2dProjectId: 'linked-canvas', instances: [], settings: {}, fluids: [fluid], roomAlarms: [] };
  const canvas = { projectId: 'linked-canvas', revision: 7, nodes: [a, b, pipe], width: 1920, height: 1080, theme: canvasThemePresets['deep-blue'] };
  const response = { version: { id: 'frozen-v1', title: '发布版本', snapshot: { schemaVersion: 1, rootProjectId: scene.projectId, projects: {
    [scene.projectId]: { project: { id: scene.projectId, name: '3D 发布', projectType: '3d' }, document: scene, assets: [] },
    [canvas.projectId]: { project: { id: canvas.projectId, name: '关联看板', projectType: '2d' }, document: canvas, assets: [] },
  }, resources: [] } } };
  const authored = structuredClone(response);

  for (const now of [NOW, NOW + 10001]) {
    const pipeProjection = projectIotRuntimeNode(pipe, runtime(), now);
    const fluidProjection = projectIotFluid(fluid, runtime(), now);
    setPublicationRuntime(response, { nodes: { [pipe.id]: pipeProjection } });
    setFluidRuntime({ fluids: [fluidProjection.fluid], errors: fluidProjection.error ? [fluidProjection.error] : [] });
    renderedModels.length = 0;
    const markup = renderToStaticMarkup(createElement(NotificationProvider, null,
      createElement(PublicationRunPage, { projectId: scene.projectId, versionId: response.version.id })));
    assert.deepEqual(canvasHookCalls, [{ document: canvas, enabled: true }]);
    assert.equal(renderedModels[0].fluids[0], fluidProjection.fluid);
    assert.match(markup, /data-pipe-id="pipe"/);
    if (now === NOW) assert.match(markup, /class="process-pipe-flow"/);
    else {
      assert.doesNotMatch(markup, /class="process-pipe-flow"/);
      assert.match(markup, /数据已过期/);
      assert.equal(renderedModels[0].fluids[0].playing, false);
    }
  }
  assert.deepEqual(response, authored);
});
