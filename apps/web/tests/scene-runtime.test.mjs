import './walk-physics.test.mjs';
import { sceneCameraClipping } from '../src/scene/camera-clipping';
import assert from 'node:assert/strict';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, InstancedMesh, Matrix4 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { ResourceManager } from '../src/scene/resource-manager';
import { InstanceManager } from '../src/scene/instance-manager';
import { createPickingService } from '../src/scene/picking-service';
import { constrainEditableInstanceScale, readEditableInstanceTransform } from '../src/scene/instance-transform';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };

// Coalescing and final-reference ownership, including one caller cancelling a shared request.
{
  const gate = deferred(); let loads = 0; const disposed = [];
  const resources = new ResourceManager(async () => { loads++; return gate.promise; }, (value) => disposed.push(value));
  const abort = new AbortController();
  const a = resources.acquire('shared', abort.signal);
  const rejected = assert.rejects(a, { name: 'AbortError' });
  const b = resources.acquire('shared'); await tick();
  abort.abort(); gate.resolve('source'); await rejected;
  const lease = await b; assert.equal(loads, 1); assert.deepEqual(disposed, []);
  lease.release(); lease.release(); assert.deepEqual(disposed, ['source']);
  resources.dispose(); assert.equal(resources.stats.resources, 0);
}
// Concurrency ceiling, queued cancellation, and a late loader that ignores cancellation.
{
  const pending = new Map(); const started = []; const destroyed = []; let active = 0, peak = 0;
  const resources = new ResourceManager(async (id) => {
    active++; peak = Math.max(peak, active); started.push(id);
    const gate = deferred(); pending.set(id, gate); const result = await gate.promise; active--; return result;
  }, (value) => destroyed.push(value), 2);
  const abort = new AbortController();
  const a = resources.acquire('a'), b = resources.acquire('b');
  const c = resources.acquire('c', abort.signal); const cancelled = assert.rejects(c, { name: 'AbortError' });
  const d = resources.acquire('d'); await tick(); assert.deepEqual(started, ['a', 'b']);
  abort.abort(); await cancelled; pending.get('a').resolve('a'); const la = await a; await tick();
  assert.deepEqual(started, ['a', 'b', 'd']); assert.equal(peak, 2);
  pending.get('b').resolve('b'); pending.get('d').resolve('d');
  const leases = await Promise.all([b, d]); la.release(); leases.forEach((lease) => lease.release());
  resources.dispose(); assert.deepEqual(destroyed.sort(), ['a', 'b', 'd']);
  const late = deferred(); const done = [];
  const slow = new ResourceManager(async () => late.promise, (value) => done.push(value));
  const signal = new AbortController(); const request = slow.acquire('late', signal.signal);
  const failure = assert.rejects(request, { name: 'AbortError' }); await tick(); signal.abort(); await failure;
  slow.dispose(); late.resolve('late-result'); await tick(); assert.deepEqual(done, ['late-result']);
}
// Failed resources can be retried; manager shutdown drains queued requests without starting them.
{
  let attempts = 0;
  const resources = new ResourceManager(async () => { if (++attempts === 1) throw new Error('bad glTF'); return 'ok'; }, () => {});
  await assert.rejects(resources.acquire('retry'), /bad glTF/);
  const lease = await resources.acquire('retry'); assert.equal(attempts, 2); lease.release(); resources.dispose();
  const gate = deferred(); const started = [];
  const queued = new ResourceManager(async (id) => { started.push(id); return gate.promise; }, () => {}, 1);
  const a = queued.acquire('a'), b = queued.acquire('b');
  const rejected = Promise.all([assert.rejects(a, { name: 'AbortError' }), assert.rejects(b, { name: 'AbortError' })]);
  await tick(); queued.dispose(); gate.resolve('late'); await rejected; assert.deepEqual(started, ['a']);
}

const instance = (id, assetId = 'model') => ({ id, assetId, label: id, visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } });
const makeSource = () => {
  const scene = new Group(); const geometry = new BoxGeometry(1, 1, 1); geometry.boundsTree = new MeshBVH(geometry, { indirect: true });
  const mesh = new Mesh(geometry, new MeshBasicMaterial()); mesh.name = 'device'; scene.add(mesh);
  return { scene, animations: [] };
};
// Incremental identity, resource sharing, failed swap rollback, removal, and wall occlusion.
{
  let loads = 0; const destroyed = [];
  const resources = new ResourceManager(async (id) => { loads++; if (id === 'broken') throw new Error('broken model'); return makeSource(); }, (source) => destroyed.push(source));
  const root = new Group(); const manager = new InstanceManager(resources, root);
  await manager.reconcile([instance('wall')]); const wall = manager.records[0]; const geometry = wall.model.children[0].geometry;
  await manager.reconcile([instance('wall'), instance('device')]); assert.equal(manager.records[0], wall); assert.equal(loads, 1);
  assert.equal(manager.records[1].model.children[0].geometry, geometry);
  await assert.rejects(manager.reconcile([instance('wall'), instance('bad', 'broken')]), /broken model/);
  assert.equal(manager.records.length, 2); assert.equal(manager.records[0], wall);
  const camera = new PerspectiveCamera(45, 1, .01, 100); camera.position.set(0, 0, 5); camera.lookAt(0, 0, 0);
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) };
  const pick = createPickingService(camera, canvas); const device = manager.records[1]; device.wrapper.position.z = -2;
  assert.equal(pick(50, 50, manager.records, new Map()).instanceId, 'wall');
  wall.model.children[0].visible = false; assert.equal(pick(50, 50, manager.records, new Map()).instanceId, 'device');
  wall.wrapper.position.x = 10; wall.model.children[0].visible = true;
  assert.equal(pick(50, 50, manager.records, new Map()).instanceId, 'device');
  await manager.reconcile([instance('device')]); assert.equal(destroyed.length, 0); assert.equal(root.children.length, 1);
  await manager.reconcile([]); assert.equal(destroyed.length, 1); assert.equal(root.children.length, 0);
  await assert.rejects(manager.reconcile([instance('dup'), instance('dup')]), /重复/);
  manager.dispose(); resources.dispose();
}
// Imported GPU instancing must keep its specialized per-instance raycaster.
{
  const source = makeSource(); const original = source.scene.children[0];
  source.scene.remove(original);
  const mesh = new InstancedMesh(original.geometry, original.material, 1);
  mesh.setMatrixAt(0, new Matrix4().makeTranslation(3, 0, 0)); source.scene.add(mesh);
  const resources = new ResourceManager(async () => source, () => {});
  const manager = new InstanceManager(resources, new Group()); await manager.reconcile([instance('gpu')]);
  assert.equal(manager.records[0].model.children[0].raycast, InstancedMesh.prototype.raycast);
  const camera = new PerspectiveCamera(45, 1, .01, 100); camera.position.set(3, 0, 5); camera.lookAt(3, 0, 0);
  const pick = createPickingService(camera, { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) });
  assert.equal(pick(50, 50, manager.records, new Map()).instanceId, 'gpu');
  manager.dispose(); resources.dispose();
}
// Superseded additions never resurrect after returning to a previous graph.
{
  const gate = deferred(); const disposed = [];
  const resources = new ResourceManager(async (id) => id === 'slow' ? gate.promise : makeSource(), (source) => disposed.push(source));
  const root = new Group(); const manager = new InstanceManager(resources, root);
  await manager.reconcile([instance('a')]); const original = manager.records[0];
  const pending = manager.reconcile([instance('a'), instance('slow', 'slow')]); await tick();
  manager.cancelPending(); assert.equal(await pending, false);
  gate.resolve(makeSource()); await tick(); assert.deepEqual(manager.records, [original]); assert.equal(root.children.length, 1);
  manager.dispose(); resources.dispose(); assert.equal(disposed.length, 2);
}
console.log('Scene runtime tests passed: coalescing, concurrency, cancellation, retry, shutdown, incremental identity, rollback, ownership, BVH picking and occlusion.');

// Mouse transforms use the same finite, bounded and degree-based contract as persisted scene instances.
{
  const object = new Group();
  object.position.set(12.345678, -2, 4);
  object.rotation.set(Math.PI / 2, -Math.PI / 4, 0);
  object.scale.set(-2, 2.345678, 2_000);
  constrainEditableInstanceScale(object);
  assert.deepEqual(readEditableInstanceTransform(object), {
    position: [12.3457, -2, 4],
    rotation: [90, -45, 0],
    scale: [0.001, 2.3457, 1_000],
  });
  object.position.x = Number.POSITIVE_INFINITY;
  assert.throws(() => readEditableInstanceTransform(object), /位置超出可保存范围/);
  object.position.x = 0;
  object.scale.y = Number.NaN;
  assert.throws(() => constrainEditableInstanceScale(object), /非有限数值/);
}
console.log('Instance transform tests passed: mouse scale bounds, finite values, degree conversion and stable precision.');

// Keep visible scene bounds while recovering precision for millimeter-spaced details.
for (const [distance, radius] of [[50,18], [0,18], [-10,18], [-100,18], [10,18], [10000,18], [.02,.01]]) {
  const { near, far } = sceneCameraClipping(distance, radius);
  assert.ok(near > 0 && far > near);
  assert.ok(far >= distance + radius);
  if (distance > radius * 1.15) assert.ok(near <= distance - radius);
}
{
  const { near, far } = sceneCameraClipping(50, 18);
  const depthStep = (n, f) => 50 ** 2 * (f - n) / (f * n * 2 ** 24);
  assert.ok(depthStep(near, far) < depthStep(.01, 1800) / 1000);
}
assert.throws(() => sceneCameraClipping(NaN, 18), /Invalid scene clipping/);
assert.throws(() => sceneCameraClipping(1, 0), /Invalid scene clipping/);
console.log('Camera clipping tests passed: outside/inside bounds, small scenes, distant zoom and depth precision.');
