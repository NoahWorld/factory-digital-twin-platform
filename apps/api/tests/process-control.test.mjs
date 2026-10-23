import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCanvasPatch, applyCanvasPatch } from '../src/canvas';
import { validateStandaloneScenePatch, applyStandaloneScenePatch } from '../src/standalone-scenes';
import { renderProjectCoverSvg } from '../src/project-covers';
import { createPipeProps } from '../../../shared/process-control';
import { createFluidDefinition } from '../../../shared/fluids';

const binding = (type = 'number') => ({ pointKey: '生产线 温度', valueType: type, staleAfterSeconds: 30, states: [{ label: '运行', operator: 'eq', value: type === 'number' ? 1 : type === 'boolean' ? true : 'run', color: '#00ff88', visible: true, flowing: true, direction: 'forward', speed: 1 }] });
const pipe = () => ({ id: 'water', type: 'process-pipe', x: 0, y: 0, width: 1, height: 1, zIndex: 0, props: createPipeProps(100, 100), resourceRefs: [], dataBindingRefs: [], stateBinding: binding() });
const patch = node => ({ expectedRevision: 0, upsertNodes: [node], deleteNodeIds: [] });

test('authoring contract preserves process pipes and generic point state rules exactly', () => {
  const node = pipe();
  assert.deepEqual(validateCanvasPatch(patch(node)).upsertNodes, [node]);
  const legacy = { ...node, id: 'legacy', type: 'rectangle', width: 240, height: 160, props: { fillColor: '#001122', borderColor: '#334455', borderWidth: 1, borderRadius: 8, opacity: 1 } };
  delete legacy.stateBinding;
  assert.equal(Object.hasOwn(validateCanvasPatch(patch(legacy)).upsertNodes[0], 'stateBinding'), false);
  for (const type of ['number', 'boolean', 'string']) {
    const withRule = { ...node, stateBinding: binding(type) };
    assert.deepEqual(validateCanvasPatch(patch(withRule)).upsertNodes[0], withRule);
  }
});

test('invalid bindings, pipe props, interactions and resource references fail at the API boundary', () => {
  const invalid = [
    { ...pipe(), stateBinding: null },
    { ...pipe(), stateBinding: { ...binding(), pointKey: ' bad' } },
    { ...pipe(), stateBinding: { ...binding(), pointKey: '🙂'.repeat(101) } },
    { ...pipe(), props: { ...createPipeProps(0, 0), width: 41 } },
    { ...pipe(), props: { ...createPipeProps(0, 0), script: 'forbidden' } },
    { ...pipe(), props: { ...createPipeProps(0, 0), waypoints: [{ x: 16385, y: 0 }] } },
    { ...pipe(), interaction: { clickActions: [] } },
    { ...pipe(), resourceRefs: ['external'] },
    { ...pipe(), dataBindingRefs: ['external'] },
  ];
  for (const node of invalid) assert.throws(() => validateCanvasPatch(patch(node)), error => error.status === 400);
});

test('historical Worker rejects unsupported state persistence before accessing storage', async () => {
  const env = new Proxy({}, { get() { throw new Error('Storage must not be accessed'); } });
  await assert.rejects(applyCanvasPatch(env, 'project', {}, validateCanvasPatch(patch(pipe()))), error => error.status === 501 && error.code === 'canvas_process_control_not_supported');
  const fluid = { ...createFluidDefinition('flow'), points: [[0, 0, 0], [1, 0, 0]], stateBinding: binding() };
  const scenePatch = validateStandaloneScenePatch({ expectedRevision: 0, upsertInstances: [], deleteInstanceIds: [], fluids: [fluid] });
  assert.deepEqual(scenePatch.fluids, [fluid]);
  await assert.rejects(applyStandaloneScenePatch(env, 'project', {}, scenePatch), error => error.status === 501 && error.code === 'scene_state_binding_not_supported');
});

test('static cover uses the authored orthogonal route and resolves connected equipment ports', () => {
  const node = pipe();
  node.props.source = { nodeId: 'device', port: 'right', x: 0, y: 0 };
  const device = { id: 'device', type: 'rectangle', x: 80, y: 80, width: 240, height: 160, zIndex: 1, props: { fillColor: '#001122', borderColor: '#334455', borderWidth: 1, borderRadius: 8, opacity: 1 }, resourceRefs: [], dataBindingRefs: [] };
  const theme = { mode: 'dark', presetId: 'deep-blue', backgroundPattern: 'none', fontFamily: 'system', glowIntensity: .3, panelRadius: 8, backgroundColor: '#001122', surfaceColor: '#112233', textColor: '#ffffff', accentColor: '#00ccff', borderColor: '#334455' };
  const svg = renderProjectCoverSvg({ projectId: 'canvas', width: 1920, height: 1080, theme, revision: 0, updatedAt: null, nodes: [node, device] });
  assert.match(svg, /d="M 80\.00 40\.00 L 86\.00 40\.00/);
  assert.match(svg, /stroke="#38bdf8" stroke-width="2\.50"/);
  assert.equal(node.props.source.x, 0, 'Rendering must not rewrite authored fallback coordinates');
  assert.throws(() => renderProjectCoverSvg({ projectId: 'canvas', width: 1920, height: 1080, theme, revision: 0, updatedAt: null, nodes: [node] }), /不存在/);
});
