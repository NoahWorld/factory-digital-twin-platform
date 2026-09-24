import assert from 'node:assert/strict';
import { emptyTwinDriveConfig } from '../../../shared/twin-drive';
import { prepareTwinBindingRemap, suggestTwinRemapNodes, twinRemapRows, twinRemapSources } from '../src/twin/twin-binding-remap';

const target = (nodeName, instanceId = 'old', modelAssetId = 'old-asset') => ({ instanceId, modelAssetId, nodeName });
const motion = (id, nodeName, parentBindingId = null) => ({ id, label: id, pointId: 'distance', target: target(nodeName), parentBindingId, useNodeRestPose: true, kind: 'translation', axis: [1, 0, 0], pivot: [0, 0, 0], valueScale: 2, valueOffset: 1, poses: [] });
const fixture = () => {
  const config = {
    ...emptyTwinDriveConfig(), enabled: true,
    points: [{ id: 'distance', label: '行程', assetId: 'device', metricKey: 'distance', topic: 'device/distance', unit: 'm', min: 0, max: 10, initialValue: 0, maxSpeed: 1, staleAfterMs: 1000 }],
    bindings: [motion('arm', 'arm'), motion('tool', 'tool', 'arm')],
    colliders: [{ id: 'tool-box', label: '工具碰撞区域', target: target('tool'), center: [1, 0, 0], size: [2, 1, 1] }, { id: 'fixed-box', label: '固定区域', target: target('fixed', 'untouched', 'fixed-asset'), center: [0, 0, 0], size: [1, 1, 1] }],
    collisionRules: [{ id: 'contact', label: '接触', first: 'tool-box', second: 'fixed-box', severity: 'warning', enabled: true }],
    procedures: [{ id: 'sequence', label: '动作工序', steps: [{ id: 'forward', label: '前进', targets: [{ pointId: 'distance', value: 5 }], tolerance: 0.01, timeoutMs: 30000 }] }],
    simulation: { enabled: true, procedureId: 'sequence', repeat: true },
  };
  const scene = { instances: [{ id: 'old', modelAssetId: 'old-asset', label: '原模型' }, { id: 'new', modelAssetId: 'new-asset', label: '新模型' }] };
  const catalog = ['arm', 'tool', 'replacement'].map(nodeName => ({ instanceId: 'new', modelAssetId: 'new-asset', nodeName, unique: true, drivable: true }));
  const key = twinRemapSources(config, scene)[0].key;
  const nodes = suggestTwinRemapNodes(twinRemapRows(config, key), scene, catalog, 'new');
  return { config, scene, catalog, key, nodes };
};
const prepare = (f) => prepareTwinBindingRemap(f.config, f.scene, f.catalog, f.key, 'new', f.nodes);

// A replacement changes only target identity. Source input, IDs, topics, parameters, rules and procedure references survive.
{
  const f = fixture(), original = structuredClone(f.config);
  const result = prepare(f);
  assert.deepEqual(result.errors, []);
  assert.equal(result.mappedCount, 3);
  assert.deepEqual(f.config, original);
  assert.deepEqual(result.config, { ...original,
    bindings: original.bindings.map(item => ({ ...item, target: target(item.target.nodeName, 'new', 'new-asset') })),
    colliders: original.colliders.map(item => item.id === 'tool-box' ? { ...item, target: target('tool', 'new', 'new-asset') } : item),
  });
  assert.equal(result.config.bindings[1].parentBindingId, 'arm');
  assert.equal(result.config.colliders[1], f.config.colliders[1]);
}

// Removed instances and same-instance resource replacements remain selectable and distinguishable.
{
  const f = fixture();
  f.scene.instances = f.scene.instances.filter(item => item.id !== 'old');
  assert.equal(twinRemapSources(f.config, f.scene)[0].unavailable, true);
  assert.equal(prepare(f).errors.length, 0);
  f.scene.instances.push({ id: 'old', modelAssetId: 'replacement-asset', label: '替换后的模型' });
  f.catalog = ['arm', 'tool'].map(nodeName => ({ instanceId: 'old', modelAssetId: 'replacement-asset', nodeName, unique: true, drivable: true }));
  const result = prepareTwinBindingRemap(f.config, f.scene, f.catalog, f.key, 'old', f.nodes);
  assert.deepEqual(result.errors, []);
  assert.equal(result.config.bindings[0].target.modelAssetId, 'replacement-asset');
}

// Suggestions never use stale resources, ambiguous names or catalog rows from another model.
{
  const f = fixture();
  f.catalog = [
    { instanceId: 'new', modelAssetId: 'stale-asset', nodeName: 'arm', unique: true, drivable: true },
    { instanceId: 'different', modelAssetId: 'new-asset', nodeName: 'arm', unique: true, drivable: true },
    { instanceId: 'new', modelAssetId: 'new-asset', nodeName: 'tool', unique: false, drivable: false },
  ];
  assert.deepEqual(suggestTwinRemapNodes(twinRemapRows(f.config, f.key), f.scene, f.catalog, 'new'), { 'binding:arm': '', 'binding:tool': '', 'collider:tool-box': '' });
  assert.equal(prepare(f).config, null);
  assert.match(prepare(f).errors.join(' '), /重名/);
}

// Named resource roots remain collision targets, but cannot be suggested or applied to a motion binding.
{
  const f = fixture();
  f.catalog.find(node => node.nodeName === 'tool').drivable = false;
  assert.deepEqual(suggestTwinRemapNodes(twinRemapRows(f.config, f.key), f.scene, f.catalog, 'new'), {
    'binding:arm': 'arm', 'binding:tool': '', 'collider:tool-box': 'tool',
  });
  const rejected = prepare(f);
  assert.equal(rejected.config, null);
  assert.equal(rejected.mappedCount, 2);
  assert.match(rejected.errors.join(' '), /模型根节点仅支持碰撞区域/);
  f.nodes['binding:tool'] = 'replacement';
  const accepted = prepare(f);
  assert.deepEqual(accepted.errors, []);
  assert.equal(accepted.config.bindings[1].target.nodeName, 'replacement');
  assert.equal(accepted.config.colliders[0].target.nodeName, 'tool');
}

// One missing mapping, a duplicate catalog entry or a second driver of a target blocks the entire operation.
{
  const f = fixture(); delete f.nodes['collider:tool-box'];
  assert.equal(prepare(f).config, null);
  assert.match(prepare(f).errors.join(' '), /工具碰撞区域/);
  f.nodes['collider:tool-box'] = 'tool'; f.nodes['binding:tool'] = 'arm';
  assert.match(prepare(f).errors.join(' '), /重复驱动/);
  f.nodes['binding:tool'] = 'tool'; f.catalog.push({ ...f.catalog[0] });
  assert.match(prepare(f).errors.join(' '), /重名/);
}

// A destination already driven elsewhere cannot silently gain a conflicting driver.
{
  const f = fixture();
  f.config.bindings.push({ ...motion('existing', 'arm'), target: target('arm', 'new', 'new-asset') });
  assert.equal(prepare(f).config, null);
  assert.match(prepare(f).errors.join(' '), /重复驱动/);
}

// Parent IDs are preserved; crossing models, missing parents and cycles require explicit repair.
{
  const f = fixture();
  f.config.bindings[0].target = target('arm', 'other', 'other-asset');
  assert.match(prepare(f).errors.join(' '), /上级关节必须属于同一模型实例/);
  f.config.bindings[0].target = target('arm'); f.config.bindings[0].parentBindingId = 'tool';
  assert.match(prepare(f).errors.join(' '), /循环/);
  f.config.bindings[0].parentBindingId = 'missing';
  assert.match(prepare(f).errors.join(' '), /上级关节/);
}

// Old and current resources of the same instance are not merged into one mapping group.
{
  const f = fixture();
  f.config.colliders.push({ id: 'legacy', label: '旧部件', target: target('legacy', 'old', 'older-asset'), center: [0, 0, 0], size: [1, 1, 1] });
  const sources = twinRemapSources(f.config, f.scene).filter(item => item.instanceId === 'old');
  assert.equal(sources.length, 2);
  assert.deepEqual(sources.map(item => twinRemapRows(f.config, item.key).length), [3, 1]);
}

// Destination changes after a suggestion invalidate the old catalog; no stale suggestion is ever applied.
{
  const f = fixture();
  f.scene.instances[1].modelAssetId = 'newer-asset';
  assert.equal(prepare(f).config, null);
  assert.equal(prepare(f).mappedCount, 0);
  f.scene.instances = f.scene.instances.filter(item => item.id !== 'new');
  assert.match(prepare(f).errors.join(' '), /请选择场景中的新模型/);
}

// Parent identity also includes the resource, even when both references name the same instance.
{
  const f = fixture();
  f.config.bindings[0].target = target('arm', 'new', 'stale-asset');
  assert.equal(prepare(f).config, null);
  assert.match(prepare(f).errors.join(' '), /不同模型资源/);
}

console.log('twin binding remap: atomic replacement, reuse, stale targets, ambiguity and parent validation passed');
