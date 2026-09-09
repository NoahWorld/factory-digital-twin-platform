import assert from 'node:assert/strict';
import { createWalkPhysics, WALK_STEP } from '../src/scene/walk-physics';

export const room = {
  version: 1, units: 'meters', spawn: [0, 0.02, 0], yaw: 0,
  bounds: { min: [-10, -2, -10], max: [10, 5, 10] },
  colliders: [
    { id: 'floor', role: 'floor', center: [0, -0.25, 0], halfExtents: [10, 0.25, 10] },
    { id: 'wall', role: 'obstacle', center: [0, 1.5, -2], halfExtents: [5, 1.5, 0.1] },
  ],
};
const settle = (world) => { for (let i = 0; i < 60; i++) world.advance(WALK_STEP, 0, 0, 0); };
{
  const world = await createWalkPhysics(room);
  settle(world);
  assert.ok(world.diagnostics().grounded, JSON.stringify(world.diagnostics()));
  assert.ok(Math.abs(world.feet()[1]) < 0.03);
  for (let i = 0; i < 180; i++) world.advance(WALK_STEP, 0, 1, 0);
  assert.ok(world.feet()[2] > -1.62 && world.feet()[2] < -1.5, `Wall must stop the capsule: ${world.feet()}`);
  assert.ok(world.diagnostics().collisions.includes('wall'), JSON.stringify(world.diagnostics()));
  const before = world.feet();
  for (let i = 0; i < 60; i++) world.advance(WALK_STEP, 1, 1, 0);
  assert.ok(world.feet()[0] > before[0] + 1, 'Slide sideways along the wall');
  assert.ok(world.feet()[2] > -1.62);
  world.dispose(); world.dispose();
  assert.throws(() => world.feet(), /已释放/);
}
// Fixed-rate integration is frame-rate independent; diagonal input cannot move faster.
{
  const simulate = async (frames, delta, right, forward) => {
    const world = await createWalkPhysics({ ...room, colliders: [room.colliders[0]] });
    try { settle(world); for (let i = 0; i < frames; i++) world.advance(delta, right, forward, 0); return world.feet(); }
    finally { world.dispose(); }
  };
  const fast = await simulate(120, 1 / 120, 0, 1);
  const slow = await simulate(30, 1 / 30, 0, 1);
  const diagonal = await simulate(60, WALK_STEP, 1, 1);
  assert.ok(Math.abs(fast[2] - slow[2]) < 1e-5, JSON.stringify({ fast, slow }));
  // Contact projection/nudging can shorten travel; input normalization must never accelerate it.
  const distance = Math.hypot(diagonal[0], diagonal[2]);
  assert.ok(distance <= 2.51 && distance >= 2.4, JSON.stringify({ fast, diagonal }));
  assert.ok(Math.abs(fast[2]) >= 2.4 && Math.abs(fast[2]) <= 2.51);
}
// Bounded catch-up, explicit failures and independently owned worlds.
{
  const [a, b] = await Promise.all([createWalkPhysics(room), createWalkPhysics(room)]);
  a.advance(30, 1, 0, 0);
  assert.equal(a.diagnostics().steps, 6);
  assert.ok(a.diagnostics().droppedSeconds > 29);
  assert.equal(b.feet()[0], 0);
  a.dispose(); settle(b);
  assert.ok(b.diagnostics().grounded);
  assert.throws(() => b.advance(NaN, 0, 0, 0), /有限/);
  b.dispose();
  await assert.rejects(createWalkPhysics({ ...room, units: 'cm' }), /米制/);
  await assert.rejects(createWalkPhysics({ ...room, spawn: Array(3) }), /有限/);
  await assert.rejects(createWalkPhysics({ ...room, spawn: [1e100, 0, 0] }), /有限/);
  await assert.rejects(createWalkPhysics({ ...room, colliders: [] }), /碰撞体/);
  await assert.rejects(createWalkPhysics({ ...room, colliders: [room.colliders[1]] }), /地面/);
  await assert.rejects(createWalkPhysics({ ...room, colliders: [room.colliders[0], room.colliders[0]] }), /重复/);
  await assert.rejects(createWalkPhysics({ ...room, spawn: [0, 0.02, -2] }), /重叠/);
  await assert.rejects(createWalkPhysics({ ...room, spawn: [0, 3, 0] }), /出生点下方/);
  await assert.rejects(createWalkPhysics({ ...room, colliders: [{ ...room.colliders[0], halfExtents: [1, -1, 1] }] }), /半尺寸/);
  const bounded = await createWalkPhysics({ ...room, bounds: { min: [-1, -1, -1], max: [1, 3, 1] } });
  try { assert.throws(() => { for (let i = 0; i < 60; i++) bounded.advance(WALK_STEP, 1, 0, 0); }, /离开通行边界/); }
  finally { bounded.dispose(); }
}
console.log('Rapier physics tests passed: grounding, wall blocking/sliding, fixed steps, diagonal speed, catch-up budget, invalid inputs/spawns, bounds and world ownership.');
