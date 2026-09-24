/** Explicit, editable case configuration. No case names or motion constants belong in the runtime.
 * node scripts/configure-kaide-twin-drive.mjs            # local calibration/config only
 * node scripts/configure-kaide-twin-drive.mjs --apply    # authenticated, revision-checked API writes
 * Requires Node >= 22.18 (native TypeScript stripping) and the verified local case import.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { Box3, Euler, Matrix4, Quaternion, Vector3 } from '../apps/web/node_modules/three/build/three.module.js';
import { twinDriveErrors } from '../shared/twin-drive.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultCaseDirectory = resolve(root, 'deploy/local/.local/cases/kaide');
const SOURCE_SHA256 = '2d98a2b1158e8db9952c91ef3898f3eaad959d4c3e26df9c7d2379d96c1d2dd5';
const DISPLAY_SHA256 = 'f3e5c898edc62e2ac1132dc3c7cf2517fa46ea581c12218abe2f10ff41370d0c';
const zero = () => [0, 0, 0];
const one = () => [1, 1, 1];
const radians = Math.PI / 180;
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const digest = data => createHash('sha256').update(data).digest('hex');
const same = isDeepStrictEqual; // PostgreSQL JSONB does not preserve object-key insertion order.
const writeJson = (path, data, flag = 'w') => writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag });
const JOINTS = [
  { pivot: [-3.1682513, .992, -1.1068307], axis: [0, 1, 0], home: 32.98535832040023, range: [15.684, 137.801] },
  { pivot: [-3.1682513, 1.1520007, -1.0568309], axis: [1, 0, 0], home: 22.058546700057352, range: [-32.178, 66.936] },
  { pivot: [-3.1682513, 1.4820007, -1.0568309], axis: [1, 0, 0], home: -38.6416337932608, range: [-63.638, 48.127] },
  { pivot: [-3.1682513, 1.5170007, -1.0568309], axis: [0, 0, 1], home: 0, range: [-59.595, 16.574] },
  { pivot: [-3.1682513, 1.5170007, -.7218309], axis: [1, 0, 0], home: 106.58309103860938, range: [17.500, 106.584] },
  { pivot: [-3.1682513, 1.5170007, -.6463309], axis: [0, 0, 1], home: 32.98536929433343, range: [15.684, 176.115] },
];

export const CASE_NOTES = [
  '长沙案例：18 个机械控制器、16 个模拟点位；原生 GLB 时间动画关闭，点位值直接决定部件姿态。',
  '这是机械点位驱动与碰撞验证配置，不是完整生产流程。4 个 U 盘和 4 个刻字节点暂未绑定：物料归属、抓取/释放、与托盘交接尚未配置，它们保持模型初始状态。',
  '关节范围来自已有模型轨迹的观测包络，速度为可编辑的保守模拟参数，均不是设备额定参数或安全限位。独立关节点值组合不保证无碰撞。',
  '托盘点值为沿显式几何路径累计的米数，不是时间、帧号或循环百分比；四块托盘分别驱动，没有隐含调度、占用锁或自动物料搬运。',
  '空夹爪/升降验证仅在所有点位已复位且机构为空时运行。碰撞验证会故意令 02 号与 01 号托盘代理盒重叠，再退回，不能用于真实设备。',
  '碰撞为可编辑 OBB 代理盒与指定碰撞对的浏览器检测，不是 CAD 精确接触求解，也不构成机械安全认证。',
  '激光开关点只使用立即设值 0 或 1；它表示标定中心光点的显示状态，不复现原扫描轨迹，不自动打标，也不自动生成刻字。',
  '后端独立模拟源持续发布每个点位配置的 topic；预览仅订阅，不启动或重置模拟器。默认工序为空机构巡检：机械臂 J1 小角度转动、夹爪开合、吊具横移和空升降台升降，到位后返回初始值再重复，不执行物料交接。',
];

export function inspectModel(path) {
  const bytes = readFileSync(path);
  const sha256 = digest(bytes);
  assert.equal(sha256, SOURCE_SHA256, 'Case source model changed: re-calibrate before using this seed.');
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'Expected GLB.');
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  const size = bytes.readUInt32LE(12);
  assert(size > 0 && size <= 8 * 1024 * 1024 && 20 + size <= bytes.length);
  const gltf = JSON.parse(bytes.subarray(20, 20 + size).toString());
  const animated = [...new Set(gltf.animations.flatMap(a => a.channels.map(c => c.target.node)))].map(i => gltf.nodes[i].name).sort();
  assert.equal(animated.length, 26, 'Expected the verified 26-controller source model.');
  return { gltf, sha256, bytes: bytes.length, animated };
}

export function nodeMatrix(node) {
  if (node.matrix) return new Matrix4().fromArray(node.matrix);
  return new Matrix4().compose(new Vector3(...(node.translation ?? zero())), new Quaternion(...(node.rotation ?? [0, 0, 0, 1])), new Vector3(...(node.scale ?? one())));
}

function nodeIndex(gltf, name) {
  const indices = gltf.nodes.flatMap((node, i) => node.name === name ? [i] : []);
  assert.equal(indices.length, 1, `Expected exactly one stable node named ${name}.`);
  const index = indices[0];
  assert(gltf.scenes[gltf.scene ?? 0].nodes.includes(index), `${name} is no longer a scene-root controller; re-calibration required.`);
  return index;
}

function localBounds(gltf, name) {
  const bounds = new Box3();
  function visit(index, matrix, ancestors) {
    assert(!ancestors.has(index), `Node cycle while calibrating ${name}.`);
    const node = gltf.nodes[index];
    const next = new Set(ancestors).add(index);
    if (node.mesh !== undefined) for (const primitive of gltf.meshes[node.mesh].primitives) {
      const position = gltf.accessors[primitive.attributes.POSITION];
      assert(position?.min?.length === 3 && position?.max?.length === 3, `Missing position bounds for ${name}/${node.name}.`);
      bounds.union(new Box3(new Vector3(...position.min), new Vector3(...position.max)).applyMatrix4(matrix));
    }
    for (const child of node.children ?? []) visit(child, matrix.clone().multiply(nodeMatrix(gltf.nodes[child])), next);
  }
  visit(nodeIndex(gltf, name), new Matrix4(), new Set());
  assert(!bounds.isEmpty(), `No geometry found for collision proxy ${name}.`);
  return { center: bounds.getCenter(new Vector3()).toArray(), size: bounds.getSize(new Vector3()).toArray() };
}

function distancePath(positions) {
  const initial = new Vector3(...positions[0]);
  let value = 0;
  const result = [{ value, position: zero(), rotation: zero(), scale: one() }];
  for (let i = 1; i < positions.length; i++) {
    const distance = new Vector3(...positions[i]).distanceTo(new Vector3(...positions[i - 1]));
    if (distance === 0) continue; // Repeated geometric waypoint is not a time-based dwell.
    value += distance;
    result.push({ value, position: new Vector3(...positions[i]).sub(initial).toArray(), rotation: zero(), scale: one() });
  }
  return result;
}

export function buildCaseConfig(manifest, gltf) {
  assert(manifest.projectId && manifest.instanceId && manifest.displayId, 'Incomplete local import manifest.');
  const config = { version: 1, enabled: true, source: 'simulator', description: CASE_NOTES.join('\n\n'), points: [], bindings: [], colliders: [], collisionRules: [], procedures: [] };
  const target = nodeName => { nodeIndex(gltf, nodeName); return { instanceId: manifest.instanceId, modelAssetId: manifest.displayId, nodeName }; };
  function point(id, label, assetId, unit, min, max, initialValue, maxSpeed) {
    config.points.push({ id, label, assetId, metricKey: id, topic: `kaide/${assetId}/${id}`, unit, min, max, initialValue, maxSpeed, staleAfterMs: 3000 });
    return id;
  }
  function bind(id, label, pointId, nodeName, options = {}) {
    const value = { id, label, pointId, target: target(nodeName), parentBindingId: null, useNodeRestPose: false, kind: 'translation', axis: [1, 0, 0], pivot: zero(), valueScale: 1, valueOffset: 0, poses: [], ...options };
    config.bindings.push(value);
    return id;
  }
  JOINTS.forEach((joint, i) => {
    const id = `robot-j${i + 1}`;
    point(id, `机械臂 J${i + 1} 角度`, 'kaide-robot', 'deg', ...joint.range, joint.home, 15);
    bind(id, `机械臂 J${i + 1} · CAD 转轴`, id, `ANIM_ROBOT_J${i + 1}`, { kind: 'rotation', pivot: joint.pivot, axis: joint.axis, parentBindingId: i ? `robot-j${i}` : null });
  });
  point('gripper-opening', '空夹爪单侧开度', 'kaide-robot', 'm', .0154, .0234, .0234, .004);
  for (const [side, sign] of [['R', 1], ['L', -1]]) bind(`finger-${side.toLowerCase()}`, `夹指 ${side}`, 'gripper-opening', `ANIM_ROBOT_FINGER_${side}`, { parentBindingId: 'robot-j6', valueScale: sign });

  const load = [-2.98875, .9735, -.48253], left = [-3.24775, .9735, -.48253], frontLeft = [-3.24775, .9735, .76047];
  const laser = [-1.73275, .9735, .76047], pickup = [-1.13616, .9735, .76047], frontRight = [.39475, .9735, .76047], backRight = [.39475, .9735, -.48253];
  for (let i = 0; i < 4; i++) {
    const number = String(i + 1).padStart(2, '0'), id = `pallet-${number}-distance`, node = `ANIM_PALLET_${number}`;
    const initial = [load[0] + i * .36, load[1], load[2]];
    const route = i === 3
      ? [[-1.13616, 1.626, .76047], [-1.13616, 1.626, .43047], [-1.13616, 1.624, .43047], [-1.13616, 1.624, -.48253], [.39475, 1.624, -.48253], backRight, load]
      : [frontRight, backRight, load];
    const poses = distancePath([initial, load, left, frontLeft, laser, pickup, ...route]);
    point(id, `${number} 号托盘路径距离（${i === 3 ? '含二层' : '一层'}）`, 'kaide-conveyor', 'm', 0, poses.at(-1).value, 0, .12);
    bind(`pallet-${number}`, `${number} 号托盘 · 米制几何路径`, id, node, { kind: 'pose', useNodeRestPose: true, poses });
    config.colliders.push({ id: `pallet-${number}-box`, label: `${number} 号托盘几何包围代理盒`, target: target(node), ...localBounds(gltf, node) });
  }
  point('hoist-height', '吊具升降位移', 'kaide-hoist', 'm', -.6505, .002, 0, .08);
  bind('hoist-z', '吊具升降（模型 Y 轴）', 'hoist-height', 'ANIM_OVERHEAD_Z', { axis: [0, 1, 0] });
  point('hoist-travel', '吊具横移行程', 'kaide-hoist', 'm', 0, .33, 0, .08);
  bind('hoist-y', '吊具横移（模型负 Z 轴）', 'hoist-travel', 'ANIM_OVERHEAD_Y', { axis: [0, 0, -1], parentBindingId: 'hoist-z' });
  point('hoist-jaw-angle', '吊具夹爪张角', 'kaide-hoist', 'deg', 0, .096 / radians, 0, 3);
  for (const [side, sign, x] of [['R', 1, -1.0736618], ['L', -1, -1.1986618]]) bind(`hoist-jaw-${side.toLowerCase()}`, `吊具夹爪 ${side}`, 'hoist-jaw-angle', `ANIM_OVERHEAD_JAW_${side}`, { kind: 'rotation', axis: [0, 0, -1], pivot: [x, 2.0060005, .7604709], valueScale: sign, parentBindingId: 'hoist-y' });
  point('receiving-lift-height', '接收升降台升高', 'kaide-receiving-lift', 'm', 0, .6505, 0, .08);
  bind('receiving-lift', '接收升降台', 'receiving-lift-height', 'ANIM_RECEIVING_LIFT', { axis: [0, 1, 0] });
  point('laser-enabled', '激光光点显示（仅立即设 0/1）', 'kaide-marker', 'bool', 0, 1, 0, 1);
  bind('laser', '激光光点开关 · 不生成刻字', 'laser-enabled', 'ANIM_LASER_SPOT', { kind: 'pose', poses: [
    { value: 0, position: zero(), rotation: zero(), scale: zero() },
    { value: 1, position: [-1.73275, 1.0345, .76047], rotation: zero(), scale: [1, .3, 1] },
  ] });
  for (let i = 1; i <= 4; i++) for (let j = i + 1; j <= 4; j++) config.collisionRules.push({ id: `pallet-${i}-${j}`, label: `托盘 ${i} / ${j} 占用重叠`, first: `pallet-0${i}-box`, second: `pallet-0${j}-box`, severity: 'warning', enabled: true });
  const step = (id, label, pointId, value) => ({ id, label, targets: [{ pointId, value }], tolerance: .0001, timeoutMs: 30000 });
  config.procedures.push(
    { id: 'empty-gripper-inspection', label: '验证：已复位空夹爪开合（不抓料）', steps: [step('close', '空夹爪收拢到 15.4 mm', 'gripper-opening', .0154), step('open', '空夹爪回到 23.4 mm', 'gripper-opening', .0234)] },
    { id: 'empty-lift-inspection', label: '验证：已复位空升降台上升/返回', steps: [step('raise', '空台上升 150 mm', 'receiving-lift-height', .15), step('lower', '空台回零', 'receiving-lift-height', 0)] },
    { id: 'collision-enter-exit-test', label: '仅模拟测试：托盘故意碰撞进入/退出', steps: [step('overlap', '02 号前进 200 mm，触发与 01 号代理盒重叠', 'pallet-02-distance', .20), step('retreat', '02 号退回起点，触发退出', 'pallet-02-distance', 0)] },
    { id: 'automatic-mechanism-inspection', label: '后端连续空机构巡检（不搬运物料）', steps: [
      { id: 'inspect', label: 'J1 转动 6°、夹爪收拢、吊具横移 100 mm、空台上升 150 mm', tolerance: .0001, timeoutMs: 30000, targets: [
        { pointId: 'robot-j1', value: JOINTS[0].home + 6 }, { pointId: 'gripper-opening', value: .0154 },
        { pointId: 'hoist-travel', value: .1 }, { pointId: 'receiving-lift-height', value: .15 },
      ] },
      { id: 'return', label: '以上机构反馈返回初始值后再重复', tolerance: .0001, timeoutMs: 30000, targets: [
        { pointId: 'robot-j1', value: JOINTS[0].home }, { pointId: 'gripper-opening', value: .0234 },
        { pointId: 'hoist-travel', value: 0 }, { pointId: 'receiving-lift-height', value: 0 },
      ] },
    ] },
  );
  config.simulation = { enabled: true, procedureId: 'automatic-mechanism-inspection', repeat: true };
  assert.deepEqual(twinDriveErrors(config), [], 'Generated case violates the shared drive contract.');
  assert.equal(config.bindings.length, 18);
  assert.equal(config.points.length, 16);
  return config;
}

/** Independent calibration evaluator; never plays or samples the GLB animation clock. */
export function evaluateBindings(config, gltf, values = {}) {
  const byId = new Map(config.bindings.map(binding => [binding.id, binding]));
  const result = new Map();
  const initial = Object.fromEntries(config.points.map(point => [point.id, point.initialValue]));
  function evaluate(id) {
    if (result.has(id)) return result.get(id);
    const binding = byId.get(id), value = (values[binding.pointId] ?? initial[binding.pointId]) * binding.valueScale + binding.valueOffset;
    let own = new Matrix4();
    if (binding.kind === 'translation') own.makeTranslation(...binding.axis.map(axis => axis * value));
    else if (binding.kind === 'rotation') {
      own.makeTranslation(...binding.pivot).multiply(new Matrix4().makeRotationAxis(new Vector3(...binding.axis), value * radians)).multiply(new Matrix4().makeTranslation(...binding.pivot.map(x => -x)));
    } else if (binding.kind === 'pose') {
      assert(value >= binding.poses[0].value && value <= binding.poses.at(-1).value, `${id}: point value outside configured pose path.`);
      const upper = binding.poses.findIndex(pose => pose.value >= value);
      const a = binding.poses[upper <= 0 ? upper === 0 ? 0 : binding.poses.length - 1 : upper - 1];
      const b = binding.poses[upper < 0 ? binding.poses.length - 1 : upper];
      const alpha = a === b ? 0 : (value - a.value) / (b.value - a.value);
      const lerp = key => a[key].map((v, i) => v + (b[key][i] - v) * alpha);
      const rotation = pose => new Quaternion().setFromEuler(new Euler(...pose.rotation.map(v => v * radians), 'XYZ'));
      own.compose(new Vector3(...lerp('position')), rotation(a).slerp(rotation(b), alpha), new Vector3(...lerp('scale')));
    } else throw new Error(`Unsupported calibration binding kind: ${binding.kind}`);
    const matrix = binding.parentBindingId ? evaluate(binding.parentBindingId).clone().multiply(own) : own;
    if (binding.useNodeRestPose) matrix.multiply(nodeMatrix(gltf.nodes[nodeIndex(gltf, binding.target.nodeName)]));
    result.set(id, matrix);
    return matrix;
  }
  for (const binding of config.bindings) evaluate(binding.id);
  return result;
}

export function calibrate(config, model) {
  const home = evaluateBindings(config, model.gltf);
  const nodes = config.bindings.map(binding => {
    const expected = nodeMatrix(model.gltf.nodes[nodeIndex(model.gltf, binding.target.nodeName)]);
    const actual = home.get(binding.id);
    const maxMatrixElementError = Math.max(...actual.elements.map((v, i) => Math.abs(v - expected.elements[i])));
    assert(maxMatrixElementError <= 0.00001, `${binding.target.nodeName} home mismatch: ${maxMatrixElementError}.`);
    return { bindingId: binding.id, nodeName: binding.target.nodeName, maxMatrixElementError };
  });
  const boxes = values => {
    const matrices = evaluateBindings(config, model.gltf, values);
    return config.colliders.map(collider => {
      const binding = config.bindings.find(binding => binding.target.nodeName === collider.target.nodeName);
      return new Box3().setFromCenterAndSize(new Vector3(...collider.center), new Vector3(...collider.size)).applyMatrix4(matrices.get(binding.id));
    });
  };
  const homeBoxes = boxes({}), testBoxes = boxes({ 'pallet-02-distance': .20 });
  assert(!homeBoxes[0].intersectsBox(homeBoxes[1]), 'Pallet proxies overlap at home.');
  assert(testBoxes[0].intersectsBox(testBoxes[1]), 'Collision test does not cause proxy overlap.');
  const bound = new Set(nodes.map(node => node.nodeName));
  const unboundAnimatedNodes = model.animated.filter(name => !bound.has(name));
  assert.equal(unboundAnimatedNodes.length, 8);
  return {
    version: 1, generatedAt: new Date().toISOString(), modelSha256: model.sha256,
    sourceBytes: model.bytes, coordinateSystem: 'metres, Y-up, Euler XYZ degrees',
    source: 'CAD pivots, mechanical dimensions and geometric waypoints from output/kaide/工程文件/scripts/motion_plan.py; no timeline sampling/playback',
    boundControllers: nodes.length, pointCount: config.points.length,
    maxHomeMatrixElementError: Math.max(...nodes.map(node => node.maxMatrixElementError)), nodes,
    unboundAnimatedNodes, incomplete: 'Material ownership/attachment, pickup/release, pallet handoff and engraving are intentionally not implemented by this seed.',
    collisionCalibration: { method: 'local descendant POSITION accessor bounds, transformed by controller; conservative proxy, not exact mesh', initiallySeparated: true, pallet02TestDistanceMetres: .20, testOverlapsPallet01: true, returningToZeroSeparates: true },
    notes: CASE_NOTES,
  };
}

export function businessAssets(config) {
  const names = { 'kaide-robot': ['长沙凯德 · 六轴机械臂', 'robot', 'ANIM_ROBOT_J1'], 'kaide-conveyor': ['长沙凯德 · 四托盘输送轨道', 'conveyor', 'ANIM_PALLET_01'], 'kaide-hoist': ['长沙凯德 · 二层吊具', 'hoist', 'ANIM_OVERHEAD_Z'], 'kaide-receiving-lift': ['长沙凯德 · 接收升降台', 'lift', 'ANIM_RECEIVING_LIFT'], 'kaide-marker': ['长沙凯德 · 激光打标光点', 'marker', 'ANIM_LASER_SPOT'] };
  return [...new Set(config.points.map(point => point.assetId))].map(assetId => ({ assetId, name: names[assetId][0], assetType: names[assetId][1], modelNode: names[assetId][2], metadata: { source: 'explicit-kaide-twin-drive-seed-v1', dataMode: 'simulator', caseScope: CASE_NOTES[0], caseLimitations: CASE_NOTES.slice(1) } }));
}

async function applyCase({ caseDirectory, manifest, config, report, origin, expectedConfig }) {
  const base = new URL('/api/v1', origin).href;
  let cookie;
  async function api(path, method = 'GET', body) {
    const response = await fetch(`${base}${path}`, { method, redirect: 'manual', signal: AbortSignal.timeout(60000), headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const requestId = response.headers.get('x-request-id');
    if (!response.ok) throw new Error(`${method} ${path} failed with HTTP ${response.status}; requestId=${requestId ?? 'unavailable'}. No rollback or success is implied; inspect the saved before/journal files.`);
    if (path === '/auth/login') { cookie = response.headers.get('set-cookie')?.split(';')[0]; assert(cookie, 'Login returned no session cookie.'); }
    return response.json();
  }
  const credentials = readJson(resolve(root, 'deploy/local/.local/admin.json'));
  assert(typeof credentials.identifier === 'string' && typeof credentials.password === 'string', 'Local admin credentials are missing.');
  await api('/auth/login', 'POST', { identifier: credentials.identifier, password: credentials.password });
  const path = `/projects/${encodeURIComponent(manifest.projectId)}`;
  const [before, drive, resources, existing] = await Promise.all([api(`${path}/scene`), api(`${path}/twin-drive`), api(`${path}/model-assets`), api(`${path}/assets`)]);
  assert(before.editable && drive.editable, 'Case must be editable by the current account.');
  const instance = before.scene.instances.find(item => item.id === manifest.instanceId);
  assert(instance && instance.modelAssetId === manifest.displayId, 'Imported case instance/resource changed.');
  assert.equal(resources.modelAssets.find(item => item.id === manifest.displayId)?.sha256, DISPLAY_SHA256, 'Case display model differs from calibrated lossless import.');
  assert(drive.revision === 0 || same(drive.config, config) || (expectedConfig && same(drive.config, expectedConfig)), 'Existing data-drive configuration differs from the seed and explicit --expected-config. Refusing to overwrite; merge it explicitly in the configuration editor.');
  const now = new Date().toISOString().replaceAll(':', '-');
  const journalPath = resolve(caseDirectory, `drive-apply-${now}.json`);
  const backupPath = resolve(caseDirectory, `before-drive-${now}-scene${before.scene.revision}-drive${drive.revision}.json`);
  writeJson(backupPath, { sceneDocument: before, twinDriveDocument: drive, assets: existing }, 'wx');
  const journal = { projectId: manifest.projectId, backupPath, configSha256: digest(JSON.stringify(config)), steps: [], complete: false };
  writeJson(journalPath, journal, 'wx');
  const record = step => { journal.steps.push(step); writeJson(journalPath, journal); };
  for (const asset of businessAssets(config)) {
    const found = existing.assets.find(item => item.assetId === asset.assetId);
    if (found) {
      assert.equal(found.metadata?.source, asset.metadata.source, `Business asset ${asset.assetId} already belongs to another configuration.`);
      assert.equal(found.modelNode, asset.modelNode, `Business asset ${asset.assetId} mapping was changed.`);
    } else { const created = await api(`${path}/assets`, 'POST', asset); record({ action: 'asset-created', assetId: asset.assetId, id: created.asset.id }); }
  }
  let scene = before.scene;
  if (scene.settings.playAnimations || instance.animation.enabled) {
    const patched = await api(`${path}/scene`, 'PATCH', { expectedRevision: scene.revision, settings: { ...scene.settings, playAnimations: false }, linked2dProjectId: scene.linked2dProjectId, upsertInstances: [{ ...instance, animation: { ...instance.animation, enabled: false } }], deleteInstanceIds: [] });
    scene = patched.scene;
    record({ action: 'native-animation-disabled', revision: scene.revision });
  }
  const saved = same(drive.config, config) ? drive : await api(`${path}/twin-drive`, 'PUT', { expectedRevision: drive.revision, config });
  record({ action: 'drive-config-saved', revision: saved.revision });
  const [verifiedScene, verifiedDrive] = await Promise.all([api(`${path}/scene`), api(`${path}/twin-drive`)]);
  assert.equal(verifiedScene.scene.settings.playAnimations, false);
  assert.equal(verifiedScene.scene.instances.find(item => item.id === manifest.instanceId).animation.enabled, false);
  assert(same(verifiedDrive.config, config), 'Saved twin configuration readback differs.');
  journal.complete = true;
  journal.sceneRevision = verifiedScene.scene.revision;
  journal.driveRevision = verifiedDrive.revision;
  writeJson(journalPath, journal);
  writeJson(resolve(caseDirectory, 'twin-drive-applied.json'), { ...journal, calibration: report });
  return { applied: true, projectId: manifest.projectId, sceneRevision: journal.sceneRevision, driveRevision: journal.driveRevision, backupPath, journalPath };
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name, defaultValue) => { const index = args.indexOf(name); if (index < 0) return defaultValue; assert(args[index + 1] && !args[index + 1].startsWith('--'), `${name} requires a value.`); return args[index + 1]; };
  const allowed = new Set(['--apply', '--case-dir', '--model', '--origin', '--expected-config']);
  for (let i = 0; i < args.length; i++) { assert(allowed.has(args[i]), `Unknown option: ${args[i]}`); if (args[i] !== '--apply') i++; }
  const caseDirectory = resolve(option('--case-dir', defaultCaseDirectory));
  const manifest = readJson(resolve(caseDirectory, 'manifest.json'));
  const verification = readJson(resolve(caseDirectory, 'verification.json'));
  const model = inspectModel(resolve(option('--model', verification.originalPath)));
  const config = buildCaseConfig(manifest, model.gltf);
  const report = calibrate(config, model);
  const expectedPath = option('--expected-config', null);
  assert(!expectedPath || args.includes('--apply'), '--expected-config requires --apply.');
  const expectedConfig = expectedPath ? readJson(resolve(expectedPath)) : undefined;
  if (expectedConfig) assert.deepEqual(twinDriveErrors(expectedConfig), [], 'Expected prior configuration is invalid.');
  mkdirSync(caseDirectory, { recursive: true });
  writeJson(resolve(caseDirectory, 'twin-drive-config.json'), config);
  writeJson(resolve(caseDirectory, 'twin-drive-calibration.json'), report);
  const result = args.includes('--apply') ? await applyCase({ caseDirectory, manifest, config, report, expectedConfig, origin: option('--origin', 'http://127.0.0.1:5174') }) : { applied: false, mode: 'dry-run', noNetworkRequests: true };
  console.log(JSON.stringify({ ...result, controllers: report.boundControllers, points: report.pointCount, maxHomeMatrixElementError: report.maxHomeMatrixElementError, unbound: report.unboundAnimatedNodes, configPath: resolve(caseDirectory, 'twin-drive-config.json'), reportPath: resolve(caseDirectory, 'twin-drive-calibration.json') }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
