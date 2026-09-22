import assert from 'node:assert/strict';
import test from 'node:test';
import { Group } from 'three';
import { SceneFrameClock } from '../src/scene/frame-clock';
import { FluidManager } from '../src/scene/fluid-manager';
import { createFluidDefinition } from '../../../shared/fluids';

test('first callback owns the baseline, including a frame timestamp earlier than loop startup', () => {
  // Reproduce the previous mixed-sampling calculation and its strict fluid failure.
  const startupNow = 1000.4;
  const firstFrameTimestamp = 1000;
  const fluids = new FluidManager(new Group());
  assert.throws(() => fluids.update(Math.min((firstFrameTimestamp - startupNow) / 1000, .1), true, 1), /时钟/);
  const clock = new SceneFrameClock();
  const first = clock.tick(firstFrameTimestamp);
  assert.deepEqual(first, { frameMs: 0, deltaSeconds: 0 });
  assert.doesNotThrow(() => fluids.update(first.deltaSeconds, true, 1));
  assert.deepEqual(clock.tick(1016), { frameMs: 16, deltaSeconds: .016 });
  assert.deepEqual(clock.tick(1016), { frameMs: 0, deltaSeconds: 0 });
  // Long frames stay observable while animation retains its existing 100 ms cap.
  assert.deepEqual(clock.tick(3016), { frameMs: 2000, deltaSeconds: .1 });
  fluids.dispose();
});

test('visibility/viewport restart establishes a new baseline without advancing fluid time', () => {
  const clock = new SceneFrameClock();
  const fluids = new FluidManager(new Group());
  fluids.reconcile([{ ...createFluidDefinition('clock-regression'), points: [[0, 0, 0], [10, 0, 0]] }]);
  const positions = () => Array.from(fluids.getObjects()[0].getObjectByName('fluid-particles').geometry.getAttribute('aCenter').array);
  clock.tick(1000);
  fluids.update(clock.tick(1016).deltaSeconds, true, 1);
  const beforePause = positions();
  for (const resumeTimestamp of [50000, 100000]) {
    clock.reset();
    const first = clock.tick(resumeTimestamp);
    assert.deepEqual(first, { frameMs: 0, deltaSeconds: 0 });
    fluids.update(first.deltaSeconds, true, 1);
    assert.deepEqual(positions(), beforePause);
  }
  fluids.update(clock.tick(100016).deltaSeconds, true, 1);
  assert.notDeepEqual(positions(), beforePause);
  fluids.dispose();
});

test('invalid and backwards callback times fail with context without corrupting the baseline', () => {
  const clock = new SceneFrameClock();
  for (const value of [NaN, Infinity, -Infinity, -1, undefined]) assert.throws(() => clock.tick(value), /场景帧时钟/);
  assert.deepEqual(clock.tick(1000), { frameMs: 0, deltaSeconds: 0 });
  assert.throws(() => clock.tick(999), /当前 999，上一帧 1000/);
  assert.throws(() => clock.tick(NaN), /当前 NaN，上一帧 1000/);
  assert.deepEqual(clock.tick(1016), { frameMs: 16, deltaSeconds: .016 });
  clock.reset();
  assert.deepEqual(clock.tick(0), { frameMs: 0, deltaSeconds: 0 });
});
