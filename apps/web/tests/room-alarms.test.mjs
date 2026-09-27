import assert from 'node:assert/strict';
import { Group, Mesh, BoxGeometry, MeshBasicMaterial } from 'three';
import { parseRoomAlarms, ROOM_ALARM_LIMITS } from '../../../shared/room-alarms';
import { RoomAlarmRuntime } from '../src/scene/room-alarm-runtime';

const rule = (id, instanceId, nodeName, color = '#ff0000') => ({
  id, label: id, enabled: true,
  source: { projectId: 'project-1', assetId: 'room-1', metricKey: 'temperature' },
  target: { instanceId, modelAssetId: 'model-1', nodeName },
  condition: { operator: 'gt', value: 60 }, color,
});
const at = (seconds) => new Date(seconds * 1000).toISOString();
const live = (value, seconds = 100) => ({ status: 'live', timestamp: at(seconds), staleAfterMs: 20_000, value });
const makeRecord = (id, material, multi = false) => {
  const model = new Group(); model.name = 'root';
  const room = new Group(); room.name = 'room'; model.add(room);
  const mesh = new Mesh(new BoxGeometry(), multi ? [material, material] : material);
  mesh.name = 'wall'; room.add(mesh);
  const other = new Mesh(new BoxGeometry(), material); other.name = 'other'; model.add(other);
  return { id, assetId: 'model-1', model, objectsByName: new Map([['root', [model]], ['room', [room]], ['wall', [mesh]], ['other', [other]]]), mesh, other, room };
};
const base = new MeshBasicMaterial({ color: '#123456' });
const left = makeRecord('left', base, true);
const right = makeRecord('right', base);
const runtime = new RoomAlarmRuntime();
const red = rule('red', 'left', 'room');
runtime.reconcile([left, right], [red]);
assert.deepEqual(runtime.update({ red: live(80) }, 105_000)[0].state, 'alarm');
assert.notEqual(left.mesh.material[0], base);
assert.notEqual(left.mesh.material[0], left.mesh.material[1]);
assert.equal(left.mesh.material[0].color.getHexString(), 'ff0000');
assert.equal(left.mesh.material[1].color.getHexString(), 'ff0000');
assert.equal(left.other.material, base);
assert.equal(right.mesh.material, base);
assert.equal(base.color.getHexString(), '123456');
const overlay = left.mesh.material;
let released = 0;
overlay.forEach((material) => { const dispose = material.dispose.bind(material); material.dispose = () => { released++; dispose(); }; });
assert.equal(runtime.update({ red: live(80, 101) }, 106_000)[0].state, 'alarm');
assert.equal(left.mesh.material, overlay, 'unchanged alarm does not clone each update');
assert.equal(runtime.update({ red: live(80, 101) }, 110_000)[0].state, 'alarm', 'same sample stays live across frames');
assert.equal(runtime.update({ red: live(0, 101) }, 110_000)[0].state, 'error', 'conflicting same-timestamp value cannot clear alarm');
assert.equal(left.mesh.material, overlay);
assert.equal(runtime.update({ red: live(80, 101) }, 121_001)[0].state, 'stale', 'same sample expires only after TTL');
for (const observation of [
  { status: 'offline', timestamp: null, staleAfterMs: 20_000, value: null },
  live(0, 70), live(0, 200), { ...live(0, 102), value: null },
]) {
  assert.equal(runtime.update({ red: observation }, 107_000)[0].active, true);
  assert.equal(left.mesh.material, overlay);
}
assert.equal(runtime.update({}, 108_000)[0].state, 'waiting');
assert.equal(left.mesh.material, overlay);
assert.equal(runtime.update({ red: live(0, 102) }, 108_000)[0].state, 'normal');
assert.equal(runtime.update({ red: live(0, 102) }, 109_000)[0].state, 'normal', 'same normal sample stays normal');
assert.equal(left.mesh.material[0], base);
assert.equal(released, 2, 'all overlay slots are disposed on clear');

// Restore the current static appearance, including its exact material references.
const custom = new MeshBasicMaterial({ color: '#19aabb' });
left.mesh.material = [custom, custom];
runtime.update({ red: live(80, 103) }, 109_000);
assert.notEqual(left.mesh.material[0], custom);
runtime.beforeModelStateChange(); runtime.beforeModelStateChange();
assert.equal(left.mesh.material[0], custom);
assert.equal(left.mesh.material[1], custom);
runtime.update({}, 110_000);
assert.notEqual(left.mesh.material[0], custom, 'logical alarm reattaches after static rebuild');
runtime.reconcile([left, right], [{ ...red, source: { ...red.source, metricKey: 'pressure' } }]);
assert.equal(left.mesh.material[0], custom, 'changed rule clears old source state');
assert.equal(runtime.update({}, 111_000)[0].active, false);

// Invalid or overlapping targets cannot color a valid independent rule.
const rightRule = rule('right-rule', 'right', 'wall', '#00ff00');
const invalid = rule('invalid', 'left', 'missing');
const overlap = rule('overlap', 'left', 'wall');
runtime.reconcile([left, right], [red, overlap, rightRule, invalid]);
const states = runtime.update({ 'right-rule': live(80, 112), red: live(80, 112), overlap: live(80, 112) }, 113_000);
assert.equal(states.find((item) => item.id === 'red').state, 'error');
assert.equal(states.find((item) => item.id === 'overlap').state, 'error');
assert.equal(states.find((item) => item.id === 'invalid').state, 'error');
assert.equal(states.find((item) => item.id === 'right-rule').state, 'alarm');
assert.equal(left.mesh.material[0], custom);
assert.equal(right.mesh.material.color.getHexString(), '00ff00');
runtime.dispose();
assert.equal(right.mesh.material, base);

const duplicate = makeRecord('duplicate', base);
duplicate.objectsByName.set('wall', [duplicate.mesh, duplicate.other]);
const empty = makeRecord('empty', base);
const bare = new Group(); bare.name = 'empty-room'; empty.model.add(bare);
empty.objectsByName.set('empty-room', [bare]);
const targetRuntime = new RoomAlarmRuntime();
targetRuntime.reconcile([duplicate, empty, right], [
  rule('duplicate-rule', 'duplicate', 'wall'),
  rule('root-rule', 'empty', 'root'),
  rule('empty-rule', 'empty', 'empty-room'),
  rightRule,
]);
const targetStates = targetRuntime.update({ 'right-rule': live(90, 114) }, 115_000);
assert.equal(targetStates.filter((item) => item.state === 'error').length, 3);
assert.equal(targetStates.find((item) => item.id === 'right-rule').state, 'alarm');
assert.equal(duplicate.mesh.material, base);
targetRuntime.dispose();

// Same asset in a rebuilt record gets new overlays without mutating shared source.
const rebuilt = makeRecord('right', base);
const rebuildRuntime = new RoomAlarmRuntime();
rebuildRuntime.reconcile([right], [rightRule]);
rebuildRuntime.update({ 'right-rule': live(80, 100) }, 105_000);
rebuildRuntime.beforeModelStateChange();
rebuildRuntime.reconcile([rebuilt], [rightRule]);
assert.equal(rebuildRuntime.update({}, 106_000)[0].active, false, 'new record needs a new observation');
rebuildRuntime.update({ 'right-rule': live(80, 106) }, 107_000);
assert.notEqual(rebuilt.mesh.material, base);
rebuildRuntime.dispose();
assert.equal(rebuilt.mesh.material, base);

const parsed = parseRoomAlarms([red]);
assert.equal(parsed.ok, true);
const mutable = { ...red, source: { ...red.source }, target: { ...red.target }, condition: { ...red.condition } };
const detached = parseRoomAlarms([mutable]);
mutable.source.metricKey = 'changed'; mutable.target.nodeName = 'other'; mutable.condition.value = 1;
assert.equal(detached.value[0].source.metricKey, 'temperature');
assert.equal(detached.value[0].target.nodeName, 'room');
assert.equal(detached.value[0].condition.value, 60);
assert.equal(parseRoomAlarms([{ ...red, condition: { operator: 'eq', value: '' } }]).ok, true);
for (const input of [null, {}, Array(ROOM_ALARM_LIMITS.maximumRules + 1).fill(red), [red, red],
  [{ ...red, condition: { operator: 'gt', value: 'hot' } }],
  [{ ...red, condition: { operator: 'eq', value: null } }],
  [{ ...red, target: { ...red.target, nodeName: '' } }],
  [{ ...red, color: '#fff' }], [{ ...red, extra: true }],
  [red, { ...red, id: 'different' }],
  [{ ...red, id: 'bad\n' }], [{ ...red, color: '#ff0000\n' }],
]) assert.equal(parseRoomAlarms(input).ok, false);

// An invalid full candidate leaves the previous active overlay untouched.
const safety = makeRecord('safety', base);
const safeRule = rule('safe', 'safety', 'wall');
const safeRuntime = new RoomAlarmRuntime();
safeRuntime.reconcile([safety], [safeRule]);
safeRuntime.update({ safe: live(80, 100) }, 105_000);
const safeOverlay = safety.mesh.material;
assert.throws(() => safeRuntime.reconcile([safety], [{ ...safeRule, color: '#bad' }]), /color/);
assert.equal(safety.mesh.material, safeOverlay);
assert.equal(safeRuntime.update({ safe: live(80, 100) }, 106_000)[0].state, 'alarm');
safeRuntime.dispose();

// Disabled targets consume neither overlap ownership nor the mesh budget.
const disabled = { ...safeRule, id: 'disabled', enabled: false, target: { ...safeRule.target, nodeName: 'room' } };
const budgetRuntime = new RoomAlarmRuntime();
budgetRuntime.reconcile([safety], [disabled, safeRule]);
assert.equal(budgetRuntime.update({ safe: live(80, 100) }, 105_000).find((item) => item.id === 'safe').state, 'alarm');
budgetRuntime.dispose();

// Clone exceptions release every newly allocated slot and leave all meshes unchanged.
const fragileMaterial = new MeshBasicMaterial({ color: '#123456' });
const fragile = makeRecord('fragile', fragileMaterial, true);
let clonesMade = 0, clonesReleased = 0;
fragileMaterial.clone = () => {
  if (++clonesMade === 2) throw new Error('clone failed');
  const clone = new MeshBasicMaterial({ color: '#123456' });
  clone.dispose = () => { clonesReleased++; };
  return clone;
};
const fragileRuntime = new RoomAlarmRuntime();
fragileRuntime.reconcile([fragile], [rule('fragile-rule', 'fragile', 'wall')]);
assert.equal(fragileRuntime.update({ 'fragile-rule': live(80, 100) }, 105_000)[0].state, 'error');
assert.equal(clonesReleased, 1);
assert.equal(fragile.mesh.material[0], fragileMaterial);
assert.equal(fragile.mesh.material[1], fragileMaterial);
fragileRuntime.dispose();
console.log('room alarms: parser, material isolation, lifecycle and freshness passed');
