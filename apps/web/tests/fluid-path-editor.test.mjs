import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { fluidPointOnPlane, FluidPathGuide } from '../src/scene/fluid-path-editor';
import { createSceneObjectPickingService } from '../src/scene/picking-service';
import { FluidManager } from '../src/scene/fluid-manager';
import { createFluidDefinition } from '../../../shared/fluids';

test('mouse ray preserves scene-local coordinates under centering, rotation and scale', () => {
  const matrix = new THREE.Matrix4().compose(new THREE.Vector3(12, -3, 4), new THREE.Quaternion().setFromEuler(new THREE.Euler(.2, 1.1, -.3)), new THREE.Vector3(2, 2, 2));
  for (const [plane, origin, direction, expected] of [
    ['xz', [3, 8, -2], [0, -1, 0], [3, 2, -2]],
    ['xy', [3, -2, 8], [0, 0, -1], [3, -2, 2]],
    ['yz', [8, 3, -2], [-1, 0, 0], [2, 3, -2]],
  ]) {
    const ray = new THREE.Ray(new THREE.Vector3(...origin), new THREE.Vector3(...direction)).applyMatrix4(matrix);
    assert.deepEqual(fluidPointOnPlane(ray, matrix, { plane, offset: 2 }), expected);
  }
  assert.throws(() => fluidPointOnPlane(new THREE.Ray(new THREE.Vector3(0, 5, 0), new THREE.Vector3(1, 0, 0)), new THREE.Matrix4(), { plane: 'xz', offset: 0 }), /平行/);
  assert.throws(() => fluidPointOnPlane(new THREE.Ray(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, 1, 0)), new THREE.Matrix4(), { plane: 'xz', offset: 0 }), /后方/);
});

test('models and fluid proxies compete in one nearest-hit selection, hidden fluids are ignored', () => {
  const camera = new THREE.PerspectiveCamera(45, 1, .01, 100);
  camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0);
  const parent = new THREE.Group();
  const manager = new FluidManager(parent);
  const config = { ...createFluidDefinition('pick-fluid', 'gas'), points: [[-2, 0, 0], [2, 0, 0]], mode: 'stream' };
  manager.reconcile([config]);
  const wrapper = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 1), new THREE.MeshBasicMaterial());
  wrapper.add(mesh); wrapper.position.z = 3;
  const records = [{ id: 'wall', wrapper, mixer: null }];
  const pick = createSceneObjectPickingService(camera, { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) });
  assert.deepEqual(pick(50, 50, records, new Map(), manager), { instanceId: 'wall', path: null });
  wrapper.position.z = -3;
  assert.deepEqual(pick(50, 50, records, new Map(), manager), { fluidId: 'pick-fluid' });
  manager.reconcile([{ ...config, visible: false }]);
  assert.deepEqual(pick(50, 50, records, new Map(), manager), { instanceId: 'wall', path: null });
  manager.dispose(); mesh.geometry.dispose(); mesh.material.dispose();
});

test('editor guide owns and releases every geometry and material on redraw and disposal', () => {
  const parent = new THREE.Group(), guide = new FluidPathGuide(parent);
  guide.update({ points: [[0, 0, 0], [2, 1, 0]], plane: 'xz', offset: 0, active: true, direction: 'forward', selectedPointIndex: 1 });
  const released = new Set(), resources = new Set();
  parent.traverse(object => {
    if (object.geometry) resources.add(object.geometry);
    if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => resources.add(material));
  });
  for (const resource of resources) resource.addEventListener('dispose', () => released.add(resource));
  guide.update(null);
  assert.equal(released.size, resources.size);
  guide.dispose(); assert.equal(parent.children.length, 0);
});

test('draft flow arrows and the source marker follow reverse flow without changing point indices', () => {
  const parent = new THREE.Group(), guide = new FluidPathGuide(parent);
  for (const direction of ['forward', 'reverse']) {
    guide.update({ points: [[0, 0, 0], [2, 0, 0]], plane: 'xz', offset: 0, active: false, direction, selectedPointIndex: null });
    let arrow, source;
    parent.traverse(object => {
      if (object instanceof THREE.ArrowHelper) arrow = object;
      if (object.material?.color?.getHex() === 0x4ade80) source = object;
    });
    const actual = new THREE.Vector3(0, 1, 0).applyQuaternion(arrow.quaternion);
    assert.ok(actual.distanceTo(new THREE.Vector3(direction === 'forward' ? 1 : -1, 0, 0)) < 1e-7);
    assert.equal(source.position.x, direction === 'forward' ? 0 : 2);
  }
  guide.dispose();
});
