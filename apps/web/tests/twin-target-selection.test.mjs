import assert from 'node:assert/strict';
import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { InstanceManager } from '../src/scene/instance-manager';
import { ResourceManager } from '../src/scene/resource-manager';
import { TwinDriveRuntime } from '../src/scene/twin-drive-runtime';
import { buildTwinNodeCatalog, createTwinTargetPickingService, resolveTwinTarget, TwinTargetSelectionOutline } from '../src/scene/twin-target-selection';
import { emptyTwinDriveConfig } from '../../../shared/twin-drive';
import { twinTargetLabel, twinTargetSearch } from '../src/twin/twin-target-label';

// The name shown to a user must remain searchable, including parts beyond the list limit.
const unnamedCatalog = Array.from({ length: 250 }, (_, index) => ({ nodeName: `mesh_${index}` }));
const lastPart = unnamedCatalog[249];
assert.equal(twinTargetLabel(lastPart, unnamedCatalog), '部件 250');
assert.equal(twinTargetSearch(lastPart, '部件 250', unnamedCatalog), true);
assert.equal(twinTargetSearch(lastPart, 'mesh_249', unnamedCatalog), true);
assert.equal(twinTargetLabel({ nodeName: 'arm_23', label: '夹持机构' }, unnamedCatalog), '夹持机构');
assert.equal(twinTargetLabel({ nodeName: '旋转底座' }, unnamedCatalog), '旋转底座');
assert.equal(twinTargetSearch({ nodeName: 'arm_23', label: '夹持机构' }, '夹持', unnamedCatalog), true);

const definition = (id, assetId = 'assembly') => ({ id, assetId, label: id, visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } });
const source = () => {
  const scene = new Group(); scene.name = 'resource-root';
  const assembly = new Group(); assembly.name = 'moving-group'; assembly.userData.label = '运输机构';
  const intermediary = new Group(); // Unnamed authoring nodes are not persisted as targets.
  const geometry = new BoxGeometry(1, 1, 1); geometry.boundsTree = new MeshBVH(geometry, { indirect: true });
  const part = new Mesh(geometry, new MeshBasicMaterial()); part.name = 'contact-part'; part.userData.label = '夹持部件';
  scene.add(assembly); assembly.add(intermediary); intermediary.add(part);
  return { scene, animations: [] };
};
const world = new Scene();
const resources = new ResourceManager(async () => source(), () => {});
const manager = new InstanceManager(resources, world);
await manager.reconcile([definition('first'), definition('second')]);
const [first, second] = manager.records;
first.wrapper.position.x = -3;
second.wrapper.position.x = 2;
const camera = new PerspectiveCamera(45, 1, .01, 100); camera.position.set(2, 0, 5); camera.lookAt(2, 0, 0);
const canvas = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 100 }) };
const pick = createTwinTargetPickingService(camera, canvas);
const target = (record, nodeName) => ({ instanceId: record.id, modelAssetId: record.assetId, nodeName });

// Actual nearest BVH geometry identifies the second loaded instance and its leaf-to-group chain.
assert.deepEqual(pick(60, 70, manager.records), [target(second, 'contact-part'), target(second, 'moving-group')]);
assert.equal(resolveTwinTarget(manager.records, target(second, 'contact-part')).object, second.objectsByName.get('contact-part')[0]);
assert.deepEqual(pick(500, 500, manager.records), []);
assert.throws(() => pick(NaN, 70, manager.records), /坐标无效/);
assert.throws(() => createTwinTargetPickingService(camera, { getBoundingClientRect: () => ({ width: 0, height: 0 }) })(0, 0, manager.records), /尺寸无效/);

// Catalog metadata comes from the authored glTF extras; names retain their persistent identity.
const catalog = buildTwinNodeCatalog(manager.records);
assert.deepEqual(catalog.find(entry => entry.instanceId === 'second' && entry.nodeName === 'contact-part'), {
  ...target(second, 'contact-part'), unique: true, drivable: true, label: '夹持部件', parentNodeName: 'moving-group',
});
assert.equal(catalog.find(entry => entry.instanceId === 'second' && entry.nodeName === 'resource-root').drivable, false);
assert.equal(catalog.find(entry => entry.instanceId === 'second' && entry.nodeName === 'moving-group').parentNodeName, undefined);
let published;
const runtime = new TwinDriveRuntime(manager.records, {
  config: emptyTwinDriveConfig(), source: { getState: () => ({ connected: false, snapshot: null }) }, onCatalog: entries => { published = entries; },
});
assert.deepEqual(published, catalog); runtime.dispose();
const part = second.objectsByName.get('contact-part')[0];
part.userData.label = { invalid: true };
assert.equal(buildTwinNodeCatalog(manager.records).find(entry => entry.instanceId === 'second' && entry.nodeName === 'contact-part').label, undefined);
part.userData.label = '夹持部件';

// Ambiguous leaves are never candidates. A unique parent can still be deliberately chosen.
second.objectsByName.set('contact-part', [part, new Group()]);
assert.deepEqual(pick(60, 70, manager.records), [target(second, 'moving-group')]);
assert.throws(() => resolveTwinTarget(manager.records, target(second, 'contact-part')), /名称不唯一/);
assert.equal(buildTwinNodeCatalog(manager.records).find(entry => entry.instanceId === 'second' && entry.nodeName === 'contact-part').drivable, false);
second.objectsByName.set('contact-part', [part]);
assert.equal(resolveTwinTarget(manager.records, target(second, 'resource-root')).object, second.model);
assert.throws(() => resolveTwinTarget(manager.records, { ...target(second, 'contact-part'), modelAssetId: 'replaced-asset' }), /资源已替换/);
assert.throws(() => resolveTwinTarget(manager.records, target(second, 'missing')), /不存在/);

// A closest wall with no bindable identity blocks the named geometry behind it.
const wallSource = { scene: new Group(), animations: [] };
wallSource.scene.name = 'wall-root'; wallSource.scene.add(new Mesh(new BoxGeometry(2, 2, .2), new MeshBasicMaterial()));
const wallResources = new ResourceManager(async () => wallSource, () => {});
const wallManager = new InstanceManager(wallResources, world); await wallManager.reconcile([definition('wall', 'wall-asset')]);
const wall = wallManager.records[0]; wall.wrapper.position.set(2, 0, 2);
assert.deepEqual(pick(60, 70, [wall, ...manager.records]), [], 'Cannot click through an unnamed model wall');
wall.wrapper.visible = false;
assert.deepEqual(pick(60, 70, [wall, ...manager.records]), [target(second, 'contact-part'), target(second, 'moving-group')]);
const decoration = new Mesh(new BoxGeometry(2, 2, .2), new MeshBasicMaterial()); decoration.position.set(2, 0, 2);
assert.deepEqual(pick(60, 70, manager.records, [decoration]), [], 'Fluid/decoration/map geometry also retains occlusion');
decoration.visible = false;
assert.equal(pick(60, 70, manager.records, [decoration])[0].instanceId, 'second');
second.objectsByName.get('moving-group')[0].visible = false;
assert.deepEqual(pick(60, 70, manager.records), []);
second.objectsByName.get('moving-group')[0].visible = true;

// Selection uses the real object bounds and follows its current world pose without altering materials.
const material = part.material;
const materialSnapshot = material.toJSON();
const outline = new TwinTargetSelectionOutline(world);
outline.set(manager.records, target(second, 'contact-part'));
let helper = world.children.find(child => child.type === 'BoxHelper');
assert.ok(helper);
assert.ok(new Box3().setFromBufferAttribute(helper.geometry.getAttribute('position')).getCenter(new Vector3()).distanceTo(new Vector3(2, 0, 0)) < 1e-8);
part.position.y = 1; outline.update();
const movedCenter = new Box3().setFromBufferAttribute(helper.geometry.getAttribute('position')).getCenter(new Vector3());
assert.ok(movedCenter.distanceTo(new Vector3(2, 1, 0)) < 1e-6, `Float32 outline vertices follow the selected pose: ${movedCenter.toArray()}`);
assert.equal(part.material, material); assert.deepEqual(material.toJSON(), materialSnapshot);
let geometryReleased = 0, materialReleased = 0;
helper.geometry.addEventListener('dispose', () => geometryReleased++); helper.material.addEventListener('dispose', () => materialReleased++);
outline.set(manager.records, null); outline.clear();
assert.equal(helper.parent, null); assert.equal(geometryReleased, 1); assert.equal(materialReleased, 1);
assert.equal(world.children.filter(child => child.type === 'BoxHelper').length, 0);
outline.set(manager.records, target(second, 'resource-root'));
helper = world.children.find(child => child.type === 'BoxHelper');
assert.equal(helper.object, second.model, 'Existing root collider bindings can display their actual model bounds');
assert.equal(buildTwinNodeCatalog(manager.records).find(entry => entry.instanceId === 'second' && entry.nodeName === 'resource-root').drivable, false);
assert.ok(pick(60, 70, manager.records).every(candidate => candidate.nodeName !== 'resource-root'), 'Read-only root outline does not make the root a picked motion target');
outline.set(manager.records, null);
assert.equal(helper.parent, null, 'No target clears a previous root outline without falling back to instance bounds');
assert.equal(world.children.filter(child => child.type === 'BoxHelper').length, 0);
outline.set(manager.records, target(second, 'moving-group'));
helper = world.children.find(child => child.type === 'BoxHelper');
assert.equal(helper.object, second.objectsByName.get('moving-group')[0]);
second.wrapper.visible = false; outline.update(); assert.equal(helper.visible, false);
second.wrapper.visible = true; outline.update(); assert.equal(helper.visible, true);
second.wrapper.removeFromParent(); outline.update(); assert.equal(helper.parent, null);
world.add(second.wrapper);
outline.set(manager.records, target(second, 'contact-part'));
outline.dispose(); outline.dispose();
assert.equal(world.children.filter(child => child.type === 'BoxHelper').length, 0);
assert.equal(part.material, material);
manager.dispose(); resources.dispose(); wallManager.dispose(); wallResources.dispose();
decoration.geometry.dispose(); decoration.material.dispose();
console.log('Twin target selection tests passed: actual second-instance picking, leaf/parent candidates, authored labels, unique identity, occlusion and outline ownership.');
