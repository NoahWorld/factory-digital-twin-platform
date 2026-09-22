import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { FluidManager } from '../src/scene/fluid-manager';
import { createFluidDefinition, parseFluids, FLUID_LIMITS } from '../../../shared/fluids';

const fluid = (overrides = {}) => ({ ...createFluidDefinition('test-fluid'), points: [[0, 0, 0], [10, 0, 0]], ...overrides });
const manager = () => new FluidManager(new THREE.Group());
const particles = (runtime) => runtime.getObjects()[0].getObjectByName('fluid-particles');
const center = (runtime, index) => new THREE.Vector3().fromBufferAttribute(particles(runtime).geometry.getAttribute('aCenter'), index);
const fade = (runtime, index) => particles(runtime).geometry.getAttribute('aFade').getX(index);
const resources = (runtime) => {
  const geometry = new Set(), material = new Set();
  runtime.getObjects().forEach((group) => group.traverse((child) => {
    if (child.geometry) geometry.add(child.geometry);
    if (child.material) material.add(child.material);
  }));
  return [...geometry, ...material];
};
const within = (actual, expected, epsilon = 1e-5) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} differs from ${expected}`);

test('all three fluids independently support stream/diffuse and world-space bounds', () => {
  const parent = new THREE.Group();
  parent.position.set(5, 2, -7);
  parent.scale.setScalar(2);
  const runtime = new FluidManager(parent);
  for (const kind of ['gas', 'liquid', 'molten']) for (const mode of ['stream', 'diffuse']) {
    runtime.reconcile([fluid({ kind, mode, spread: 3, radius: .4, points: [[-2, 1, 4], [3, 4, 1], [8, 2, -3]] })]);
    const bounds = runtime.getBounds();
    for (let frame = 0; frame < 20; frame++) {
      runtime.update(.17, true, 1);
      const mesh = particles(runtime);
      for (let index = 0; index < mesh.geometry.instanceCount; index++) {
        const point = center(runtime, index).applyMatrix4(mesh.matrixWorld);
        const radius = mesh.geometry.getAttribute('aSize').getX(index) * Math.SQRT2; // size/2 × parent scale × diagonal
        assert.ok(bounds.containsPoint(point.clone().addScalar(radius)), `${kind}/${mode} positive extent`);
        assert.ok(bounds.containsPoint(point.clone().addScalar(-radius)), `${kind}/${mode} negative extent`);
      }
    }
    assert.equal(Boolean(runtime.getObjects()[0].getObjectByName('fluid-surface')), kind !== 'gas' && mode === 'stream');
    assert.equal(runtime.diagnostics().fluidCount, 1);
  }
  runtime.dispose();
  assert.equal(parent.children.length, 0);
});

test('billboard bounds remain conservative under rotated, nonuniform parent transforms', () => {
  const parent = new THREE.Group();
  parent.scale.set(.1, .4, 3);
  parent.rotation.set(.3, .7, .2);
  parent.position.set(2, -3, 4);
  const runtime = new FluidManager(parent);
  runtime.reconcile([fluid({ kind: 'gas', mode: 'diffuse', spread: 10, points: [[0, 0, 0], [0, 10, 0]] })]);
  const bounds = runtime.getBounds();
  const mesh = particles(runtime);
  for (let index = 0; index < mesh.geometry.instanceCount; index++) {
    const point = center(runtime, index).applyMatrix4(mesh.matrixWorld);
    const billboardRadius = mesh.geometry.getAttribute('aSize').getX(index) * 3 / Math.SQRT2;
    assert.ok(bounds.containsPoint(point.clone().addScalar(billboardRadius)));
    assert.ok(bounds.containsPoint(point.clone().addScalar(-billboardRadius)));
  }
  runtime.dispose();
});

test('arc-length motion, forward/reverse, speeds and frame-rate independence', () => {
  const a = manager(), b = manager();
  // Unequally spaced path points must not cause the particle to slow near dense points.
  const config = fluid({ points: [[0, 0, 0], [.1, 0, 0], [1, 0, 0], [10, 0, 0]], speed: 2 });
  a.reconcile([config]); b.reconcile([config]);
  const start = center(a, 12);
  for (let i = 0; i < 120; i++) a.update(1 / 120, true, 1.5);
  for (let i = 0; i < 30; i++) b.update(1 / 30, true, 1.5);
  within(center(a, 12).x - start.x, 3, .004);
  assert.ok(center(a, 12).distanceTo(center(b, 12)) < .00001);
  const reverse = manager();
  reverse.reconcile([fluid({ ...config, direction: 'reverse' })]);
  const reverseStart = center(reverse, 12);
  reverse.update(1, true, 1.5);
  within(center(reverse, 12).x - reverseStart.x, -3, .004);
  a.dispose(); b.dispose(); reverse.dispose();
});

test('diffusion widens from the chosen source, and endpoint respawn fades out/in', () => {
  const forward = manager(), reverse = manager();
  forward.reconcile([fluid({ kind: 'gas', mode: 'diffuse', spread: 5 })]);
  reverse.reconcile([fluid({ kind: 'gas', mode: 'diffuse', spread: 5, direction: 'reverse' })]);
  const early = 8, late = particles(forward).geometry.instanceCount - 8;
  assert.ok(particles(forward).geometry.getAttribute('aSize').getX(late) > particles(forward).geometry.getAttribute('aSize').getX(early) * 2);
  for (const index of [early, late]) {
    within(center(forward, index).x + center(reverse, index).x, 10);
    within(center(forward, index).y, center(reverse, index).y);
    within(center(forward, index).z, center(reverse, index).z);
  }
  assert.equal(fade(forward, 0), 0);
  forward.update(9.99, true, 1);
  assert.ok(center(forward, 0).x > 9.98);
  assert.ok(fade(forward, 0) < .001);
  forward.update(.02, true, 1);
  assert.ok(center(forward, 0).x < .02);
  assert.ok(fade(forward, 0) < .001);
  forward.dispose(); reverse.dispose();
});

test('pause/hidden state, cosmetic updates and the shared clock retain geometry and position', () => {
  const runtime = manager();
  runtime.reconcile([fluid()]);
  runtime.update(.5, true, 1);
  const original = resources(runtime);
  const position = center(runtime, 20);
  runtime.update(2, false, 1);
  runtime.update(2, true, 0);
  assert.deepEqual(center(runtime, 20), position);
  runtime.reconcile([fluid({ playing: false, color: '#9933aa', opacity: .6, speed: 2 })]);
  runtime.update(2, true, 1);
  assert.deepEqual(center(runtime, 20), position);
  assert.deepEqual(resources(runtime), original);
  assert.equal(particles(runtime).material.uniforms.uColor.value.getHexString(), '9933aa');
  runtime.reconcile([fluid({ visible: false })]);
  assert.equal(runtime.getObjects().length, 0);
  assert.equal(runtime.getBounds().isEmpty(), true);
  runtime.update(1, true, 1);
  runtime.reconcile([fluid()]);
  assert.deepEqual(center(runtime, 20), position);
  runtime.dispose();
});

test('shape changes/removal/dispose release each owned resource once; invalid transactions preserve old scene', () => {
  const runtime = manager();
  runtime.reconcile([fluid()]);
  const original = resources(runtime);
  const disposal = new Map(original.map((resource) => [resource, 0]));
  original.forEach((resource) => resource.addEventListener('dispose', () => disposal.set(resource, disposal.get(resource) + 1)));
  assert.throws(() => runtime.reconcile([fluid(), fluid()]), /duplicates/);
  assert.throws(() => runtime.reconcile([fluid({ id: 'new-one' }), fluid({ id: 'tiny', points: [[0, 0, 0], [1e-200, 0, 0]] })]), /tiny/);
  assert.deepEqual(resources(runtime), original);
  assert.ok([...disposal.values()].every((count) => count === 0));
  runtime.reconcile([fluid({ radius: .8 })]);
  assert.ok([...disposal.values()].every((count) => count === 1));
  const next = resources(runtime);
  let released = 0;
  next.forEach((resource) => resource.addEventListener('dispose', () => released++));
  runtime.reconcile([]);
  assert.equal(released, next.length);
  assert.deepEqual(runtime.diagnostics(), { fluidCount: 0, visibleFluidCount: 0, particleCount: 0, geometryCount: 0, materialCount: 0 });
  runtime.dispose(); runtime.dispose();
  assert.throws(() => runtime.update(1, true, 1), /已释放/);
  assert.throws(() => runtime.reconcile([]), /已释放/);
  assert.throws(() => runtime.getObjects(), /已释放/);
});

test('pick volumes resolve real IDs, ignore hidden flows and obey scene raycast depth', () => {
  const parent = new THREE.Group();
  const runtime = new FluidManager(parent);
  runtime.reconcile([fluid({ mode: 'diffuse', kind: 'gas', radius: .5 })]);
  parent.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster(new THREE.Vector3(5, 0, 10), new THREE.Vector3(0, 0, -1));
  const hits = raycaster.intersectObjects(runtime.getObjects(), true);
  assert.ok(hits.length > 0);
  assert.equal(runtime.pickId(hits[0].object), 'test-fluid');
  const axial = new THREE.Raycaster(new THREE.Vector3(-5, 0, 0), new THREE.Vector3(1, 0, 0));
  const endHits = axial.intersectObjects(runtime.getObjects(), true);
  assert.ok(endHits.length > 0, 'The source/destination caps must remain selectable along the flow axis');
  assert.equal(runtime.pickId(endHits[0].object), 'test-fluid');
  const wall = new THREE.Mesh(new THREE.BoxGeometry(2, 2, .2), new THREE.MeshBasicMaterial());
  wall.position.set(5, 0, 5); wall.updateMatrixWorld();
  const occluded = raycaster.intersectObjects([...runtime.getObjects(), wall], true);
  assert.equal(occluded[0].object, wall);
  assert.equal(runtime.pickId(wall), null);
  runtime.reconcile([fluid({ visible: false })]);
  assert.equal(runtime.pickId(hits[0].object), null);
  runtime.dispose(); wall.geometry.dispose(); wall.material.dispose();
});

test('32-flow budget, deterministic geometry/particles and explicit invalid clock/config errors', () => {
  const a = manager(), b = manager();
  const configs = Array.from({ length: FLUID_LIMITS.maximumFluids }, (_, i) => fluid({ id: `flow-${i}`, points: [[0, 0, 0], [100, i, 0]], kind: 'gas', mode: 'diffuse' }));
  a.reconcile(configs); b.reconcile(configs);
  assert.equal(a.diagnostics().particleCount, 32 * 256);
  assert.deepEqual(particles(a).geometry.getAttribute('aCenter').array, particles(b).geometry.getAttribute('aCenter').array);
  for (const args of [[NaN, true, 1], [-1, true, 1], [1, true, Infinity], [1, true, -1], [1, 'true', 1]]) assert.throws(() => a.update(...args), /时钟/);
  assert.throws(() => a.reconcile([fluid({ points: [[0, 0, 0], [0, 0, 0]] })]), /previous point/);
  assert.throws(() => a.reconcile([fluid({ color: 'red' })]), /hexadecimal/);
  assert.equal(parseFluids([fluid({ unknown: 123 })]).ok, false);
  assert.equal(parseFluids([fluid({ points: [[0, 0, 0], [1, 2, 3], [0, 0, 0]] })]).ok, true);
  a.dispose(); b.dispose();
});

test('short positive paths preserve GPU rings and unit normals even near the coordinate limit', () => {
  const runtime = manager();
  for (const [origin, distance] of [[0, 1e-8], [0, 1e-20], [9999, 1e-8], [9999, 1e-10], [9999, 1e-12]]) {
    const config = fluid({ points: [[origin, 0, 0], [origin + distance, 0, 0]] });
    assert.equal(parseFluids([config]).ok, true);
    runtime.reconcile([config]);
    runtime.update(1 / 60, true, 1);
    const group = runtime.getObjects()[0];
    const surface = group.getObjectByName('fluid-surface');
    const positions = surface.geometry.getAttribute('position');
    const normals = surface.geometry.getAttribute('normal');
    assert.equal(group.position.x, origin);
    assert.ok(new Set(Array.from({ length: positions.count }, (_, i) => positions.getX(i))).size > 1,
      `Separate rings must not collapse in Float32: ${origin}/${distance}`);
    for (let i = 0; i < normals.count; i++) within(new THREE.Vector3().fromBufferAttribute(normals, i).length(), 1, 1e-6);
    group.traverse(object => {
      for (const attribute of Object.values(object.geometry?.attributes ?? {})) assert.ok(Array.from(attribute.array).every(Number.isFinite));
    });
    const bounds = runtime.getBounds();
    config.points.forEach(point => assert.ok(bounds.containsPoint(new THREE.Vector3(...point))));
    const axialRay = new THREE.Raycaster(new THREE.Vector3(origin - 1, 0, 0), new THREE.Vector3(1, 0, 0));
    assert.equal(runtime.pickId(axialRay.intersectObjects(runtime.getObjects(), true)[0].object), config.id);
  }
  runtime.dispose();
});

test('far-origin geometry keeps transformed bounds and picking through cosmetic, direction and path updates', () => {
  const parent = new THREE.Group();
  parent.position.set(3, -5, 7);
  parent.rotation.set(.3, .7, .2);
  parent.scale.set(.4, 2, 3);
  const runtime = new FluidManager(parent);
  const initial = fluid({ kind: 'gas', mode: 'diffuse', points: [[9999, 1, -4], [9999 + 1e-8, 1, -4]] });
  const verifyWorldCoordinates = (config) => {
    const group = runtime.getObjects()[0];
    assert.deepEqual(group.position.toArray(), config.points[0]);
    const bounds = runtime.getBounds();
    config.points.forEach(point => assert.ok(bounds.containsPoint(parent.localToWorld(new THREE.Vector3(...point)))));
    const source = parent.localToWorld(new THREE.Vector3(...config.points[0]).add(new THREE.Vector3(-1, 0, 0)));
    const direction = new THREE.Vector3(1, 0, 0).transformDirection(parent.matrixWorld);
    const hits = new THREE.Raycaster(source, direction).intersectObjects(runtime.getObjects(), true);
    assert.ok(hits.length > 0);
    assert.equal(runtime.pickId(hits[0].object), config.id);
  };
  runtime.reconcile([initial]);
  verifyWorldCoordinates(initial);
  const group = runtime.getObjects()[0];
  const original = resources(runtime);
  const cosmetic = { ...initial, color: '#9933aa', opacity: .6, speed: 2 };
  runtime.reconcile([cosmetic]);
  runtime.update(.2, true, 1);
  assert.equal(runtime.getObjects()[0], group);
  assert.deepEqual(resources(runtime), original);
  verifyWorldCoordinates(cosmetic);
  const reverse = { ...cosmetic, direction: 'reverse' };
  runtime.reconcile([reverse]);
  assert.notEqual(runtime.getObjects()[0], group);
  verifyWorldCoordinates(reverse);
  const moved = { ...reverse, points: [[9998, 2, -3], [9998 + 1e-8, 2, -3]] };
  runtime.reconcile([moved]);
  runtime.update(.2, true, 1);
  verifyWorldCoordinates(moved);
  runtime.dispose();
});
