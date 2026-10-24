import assert from 'node:assert/strict';
import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, Vector2 } from 'three';
import { RuntimeSelectionOutline } from '../src/scene/runtime-selection-outline';

// Real Three.js passes and buffers, without a WebGL context. Raster/occlusion is checked in the browser.
const scene = new Scene();
const material = new MeshStandardMaterial({ color: '#64788a', opacity: 0.55, transparent: true });
const geometry = new BoxGeometry();
const equipment = new Group();
const movingPart = new Mesh(geometry, material);
equipment.add(movingPart); scene.add(equipment);
const otherInstance = new Mesh(geometry, material); scene.add(otherInstance);
let directFrames = 0, resets = 0;
const frameOrder = [];
const renderer = {
  getSize: target => target.copy(new Vector2(800, 450)),
  getPixelRatio: () => 2,
  info: { autoReset: true, reset: () => resets++ },
  render: () => { directFrames++; frameOrder.push('scene'); },
  autoClear: true,
  shadowMap: { autoUpdate: true },
  target: null,
  getRenderTarget() { return this.target; },
  setRenderTarget(target) { this.target = target; },
  clearColor: new Color('#071525'),
  clearAlpha: 0.5,
  getClearColor(target) { return target.copy(this.clearColor); },
  getClearAlpha() { return this.clearAlpha; },
  setClearColor(color, alpha) { this.clearColor.set(color); this.clearAlpha = alpha; },
  clear() {},
};
const selection = new RuntimeSelectionOutline(renderer, scene, new PerspectiveCamera());
selection.render();
assert.equal(selection.edges, null, 'No postprocessing buffers allocated until selection');
assert.equal(directFrames, 1);
const originalMaterial = material.toJSON();
selection.set(equipment);
const edges = selection.edges;
assert.deepEqual(selection.outline.selectedObjects, [equipment], 'Whole assembly including animated children is selected');
assert.equal(edges.width, 1600);
assert.equal(edges.height, 900);
selection.resize(400, 300);
assert.equal(edges.width, 800);
assert.equal(edges.height, 600);
assert.equal(selection.outline.renderTargetMaskBuffer.width, 800);
assert.equal(selection.outline.hiddenEdgeColor.getHex(), 0, 'Occluded edges do not highlight through other equipment');
movingPart.rotation.y = 1;
assert.equal(selection.outline.selectedObjects[0].children[0].rotation.y, 1, 'No frozen clone of animated parts');
selection.set(otherInstance);
assert.equal(selection.edges, edges, 'Switching selection reuses GPU buffers');
assert.deepEqual(selection.outline.selectedObjects, [otherInstance]);
otherInstance.visible = false;
selection.render();
assert.equal(directFrames, 2, 'Hidden selection renders directly');
otherInstance.visible = true; scene.remove(otherInstance);
selection.render();
assert.equal(directFrames, 3, 'Removed selection renders directly');
selection.set(equipment); equipment.visible = false; selection.render();
assert.equal(directFrames, 4, 'Ancestor visibility is respected');
selection.clear();
assert.deepEqual(selection.outline.selectedObjects, []);
assert.deepEqual(material.toJSON(), originalMaterial, 'Selection never mutates shared source materials');
assert.equal(movingPart.material, otherInstance.material);
assert.equal(movingPart.geometry, otherInstance.geometry);
assert.equal(renderer.info.autoReset, true);
assert.equal(resets, 4);
equipment.visible = true;
selection.set(equipment);
const originalClearColor = renderer.clearColor.clone();
selection.outline.render = () => {
  frameOrder.push('outline');
  assert.equal(renderer.target, edges);
  assert.equal(renderer.shadowMap.autoUpdate, false, 'Mask passes must not overwrite scene shadows');
};
selection.overlay.render = () => {
  frameOrder.push('overlay');
  assert.equal(renderer.target, null, 'Only edges are composited over the original frame');
  assert.equal(renderer.autoClear, false);
};
frameOrder.length = 0;
selection.render();
assert.deepEqual(frameOrder, ['scene', 'outline', 'overlay']);
assert.equal(renderer.clearColor.equals(originalClearColor), true);
assert.equal(renderer.clearAlpha, 0.5);
assert.equal(renderer.autoClear, true);
assert.equal(renderer.shadowMap.autoUpdate, true);
frameOrder.length = 0;
const framesBeforeComposer = directFrames;
selection.render(() => frameOrder.push('existing-composer'));
assert.deepEqual(frameOrder, ['existing-composer', 'outline', 'overlay'], 'Single-model studio composition is preserved before outlining');
assert.equal(directFrames, framesBeforeComposer, 'The existing composer replaces, rather than duplicates, the beauty render');
selection.outline.render = () => { throw new Error('GPU outline failure'); };
assert.throws(() => selection.render(), /GPU outline failure/, 'Render failures propagate, not hidden by a fallback');
assert.equal(renderer.target, null);
assert.equal(renderer.clearColor.equals(originalClearColor), true);
assert.equal(renderer.clearAlpha, 0.5);
assert.equal(renderer.autoClear, true);
assert.equal(renderer.info.autoReset, true);
assert.equal(renderer.shadowMap.autoUpdate, true);
const disposed = new Set();
const owned = [edges, selection.outline.renderTargetMaskBuffer,
  selection.outline.renderTargetDepthBuffer, selection.outline.prepareMaskMaterial,
  selection.outline.overlayMaterial, selection.overlayMaterial];
for (const resource of owned) resource.addEventListener('dispose', () => disposed.add(resource));
let sourceDisposed = false;
geometry.addEventListener('dispose', () => sourceDisposed = true);
material.addEventListener('dispose', () => sourceDisposed = true);
selection.dispose(); selection.dispose();
assert.equal(disposed.size, owned.length, 'Postprocessing buffers and materials are released');
assert.equal(sourceDisposed, false, 'Disposing selection does not dispose shared models');
assert.throws(() => selection.set(equipment), /disposed/);
material.dispose(); geometry.dispose();
console.log('Runtime model outline lifecycle tests passed.');
