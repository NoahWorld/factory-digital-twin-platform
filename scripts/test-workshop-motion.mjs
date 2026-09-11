import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createWorkshopFloor } from './workshop-floor.mjs';
import { checkWorkshopMotion } from './workshop-motion-check.mjs';

const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const THREE = require('three');
const moving = new THREE.Group();
const body = new THREE.Mesh(new THREE.BoxGeometry(.2, .2, .2));
body.name = 'moving-body';
moving.add(body);
const clip = new THREE.AnimationClip('round-trip', 2, [
  new THREE.VectorKeyframeTrack('moving-body.position', [0, 1, 2], [-2, 0, 0, 2, 0, 0, -2, 0, 0]),
]);
const machine = new THREE.Mesh(new THREE.BoxGeometry(.5, 1, 1));
machine.name = 'machine-housing';
const sources = new Map([
  ['robot-arm', { scene: moving, animations: [clip] }],
  ['production-machine', { scene: machine, animations: [] }],
]);
const instance = (slug, id, position) => ({
  id, label: id, modelAssetId: `builtin:workshop-${slug}-v2`,
  transform: { position, rotation: [0, 0, 0], scale: [1, 1, 1] },
});
const robot = instance('robot-arm', 'robot', [0, 0, 0]);
// Both clip endpoints are clear; the obstacle is crossed midway through the animation.
assert.throws(() => checkWorkshopMotion(THREE, [robot, instance('production-machine', 'machine', [0, 0, 0])], sources),
  /Motion clearance failed at .*robot\/moving-body intersects machine\/machine-housing/);
const safe = checkWorkshopMotion(THREE, [robot, instance('production-machine', 'machine', [0, 0, 3])], sources);
assert.equal(safe.checked[0].samples, 121);
assert.ok(safe.checked[0].minimumMachineGapMeters > 2);
assert.throws(() => checkWorkshopMotion(THREE, [robot, instance('robot-arm', 'other-robot', [1, 0, 0])], sources), /Moving swept paths overlap/);
assert.throws(() => checkWorkshopMotion(THREE, [instance('missing', 'missing', [0, 0, 0])], sources), /No motion-check source/);
console.log('PASS: detects mid-cycle housing intersections, overlapping moving paths and missing geometry; accepts separated layout.');

// Detect duplicate top surfaces and holes, including at paint/line intersections.
const floorMaterials = Object.fromEntries(['floor','steel','blue','yellow','white'].map(name => [name, new THREE.MeshStandardMaterial()]));
const floor = createWorkshopFloor(THREE, floorMaterials);
floor.updateMatrixWorld(true);
const positions = floor.geometry.attributes.position;
let topArea = 0;
for (let i = 0; i < positions.count; i += 3) {
  const a = new THREE.Vector3().fromBufferAttribute(positions, i);
  const b = new THREE.Vector3().fromBufferAttribute(positions, i + 1);
  const c = new THREE.Vector3().fromBufferAttribute(positions, i + 2);
  const cross = b.sub(a).cross(c.sub(a));
  if (cross.y > 0) { assert.equal(a.y, 0); topArea += cross.length() / 2; }
}
assert.ok(Math.abs(topArea - 560) < .001, `Top surface must cover exactly 560 square meters, got ${topArea}`);
const ray = new THREE.Raycaster();
for (let i = 0; i < 300; i++) {
  const x = -13.99 + ((i * .61803398875) % 1) * 27.98;
  const z = -9.99 + ((i * .41421356237) % 1) * 19.98;
  ray.set(new THREE.Vector3(x, 1, z), new THREE.Vector3(0, -1, 0));
  const hits = ray.intersectObject(floor).filter(hit => Math.abs(hit.point.y) < .000001);
  assert.equal(hits.length, 1, `Duplicate or missing floor at ${x},${z}`);
}
floor.geometry.dispose(); Object.values(floorMaterials).forEach(material => material.dispose());
console.log('Floor topology tests passed: one top surface, 560 square meters, no duplicate layers or sampled holes.');
