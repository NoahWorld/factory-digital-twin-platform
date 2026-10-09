// Original, articulated handling cell. Existing workshop assets are never rewritten.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyHandlingCellGeometry } from './handling-cell-geometry-check.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(join(root, 'apps/web/package.json'));
const T = require('three');
const threeRoot = dirname(dirname(require.resolve('three')));
const { GLTFExporter } = await import(pathToFileURL(join(threeRoot, 'examples/jsm/exporters/GLTFExporter.js')));
const { RoundedBoxGeometry } = await import(pathToFileURL(join(threeRoot, 'examples/jsm/geometries/RoundedBoxGeometry.js')));
const contract = JSON.parse(readFileSync(join(root, 'shared/handling-cell-geometry.json')));
const captions = JSON.parse(readFileSync(join(root, 'scripts/handling-cell-label-outlines.json')));
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(value => { this.result = value; this.onloadend?.(); }, error => this.onerror?.(error)); }
  readAsDataURL(blob) { blob.arrayBuffer().then(value => { this.result = `data:${blob.type};base64,${Buffer.from(value).toString('base64')}`; this.onloadend?.(); }, error => this.onerror?.(error)); }
};

const colors = {
  orange: '#be661d', dark: '#202c35', steel: '#879aa3', blue: '#376579',
  rubber: '#18232a', carton: '#b08957', tape: '#d3b687', white: '#e2e7e6',
  green: '#399880', yellow: '#e4b544', floor: '#3b4a51', lane: '#24343d',
};
const materials = Object.fromEntries(Object.entries(colors).map(([name, color]) => [name, new T.MeshStandardMaterial({
  name, color, roughness: name === 'steel' ? .34 : .72,
  metalness: name === 'steel' ? .82 : ['orange', 'dark', 'blue'].includes(name) ? .28 : 0,
})]));
const geometryCache = new Map();
const geometry = (key, make) => { if (!geometryCache.has(key)) geometryCache.set(key, make()); return geometryCache.get(key); };
function group(parent, name, position = [0, 0, 0]) {
  const object = new T.Group(); object.name = name; object.position.fromArray(position); parent?.add(object); return object;
}
function mesh(parent, name, shape, material, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const object = new T.Mesh(shape, materials[material]); object.name = name;
  object.position.fromArray(position); object.rotation.set(...rotation); parent.add(object); return object;
}
function box(parent, name, size, position, material = 'steel', rotation) {
  const radius = Math.min(.025, ...size.map(value => value * .10));
  return mesh(parent, name, geometry(`box:${size}`, () => new RoundedBoxGeometry(...size, 2, radius)), material, position, rotation);
}
function cylinder(parent, name, radius, length, position, material = 'steel', rotation) {
  return mesh(parent, name, geometry(`cylinder:${radius}:${length}`, () => new T.CylinderGeometry(radius, radius, length, 24)), material, position, rotation);
}
function label(parent, name, text, size, position) {
  const commands = captions.captions[text]; assert.ok(commands, `Missing authored Chinese label: ${text}`);
  const path = new T.ShapePath(), scale = size / captions.unitsPerEm;
  for (const [op, ...points] of commands) {
    const values = points.map(value => value * scale);
    if (op === 'm') path.moveTo(...values);
    else if (op === 'l') path.lineTo(...values);
    else if (op === 'q') path.quadraticCurveTo(...values);
    else if (op === 'c') path.bezierCurveTo(...values);
    else if (op === 'z') path.currentPath.closePath();
    else throw new Error(`Unknown caption outline ${op}`);
  }
  const shape = new T.ShapeGeometry(path.toShapes(), 4); shape.computeBoundingBox();
  assert.ok(shape.attributes.position.count, `Empty caption ${text}`);
  shape.translate(-(shape.boundingBox.min.x + shape.boundingBox.max.x) / 2, -shape.boundingBox.min.y, 0);
  return mesh(parent, name, shape, 'white', position, [-Math.PI / 2, 0, 0]);
}

const scene = group(null, 'handling_cell');
scene.userData = { label: '搬运送检单元', units: 'meters', upAxis: 'Y', origin: 'dock-center', proceduralVersion: 1,
  visibleLabels: contract.clearance.captionTexts, geometryContract: 'shared/handling-cell-geometry.json' };
const environment = group(scene, 'cell_environment');
box(environment, 'supporting_floor', [6.4, .12, 8], [.5, -.06, -1.8], 'floor');
box(environment, 'transport_lane', [1.46, .005, 5.6], [0, .0025, -2], 'lane');
for (const x of [-.73, .73]) box(environment, `lane_edge_${x < 0 ? 'left' : 'right'}`, [.035, .005, 5.6], [x, .005, -2], 'yellow');
for (const z of [-4, 0]) {
  const mark = z === 0 ? 'dock' : 'origin';
  box(environment, `${mark}_parking_line`, [1.45, .006, .035], [0, .009, z + .90], 'white');
  for (const x of [-.67, .67]) box(environment, `${mark}_parking_${x < 0 ? 'left' : 'right'}`, [.035, .006, .45], [x, .009, z + .66], 'white');
}
label(environment, 'origin_caption', '运输起点', .23, [0, .016, -5.35]);
label(environment, 'dock_caption', '停靠取放', .23, [-1.62, .012, -.15]);
label(environment, 'inspection_caption', '检验台', .23, [1.4, .012, 1.98]);
const table = group(environment, 'inspection_table', contract.inspectionTable.center);
const tableTop = contract.inspectionTable.topYM;
box(table, 'inspection_tabletop', contract.inspectionTable.topSize, [0, tableTop - .045, 0], 'blue');
for (const x of [-.33, .33]) for (const z of [-.33, .33]) {
  box(table, `table_leg_${x}_${z}`, [.06, tableTop - .09, .06], [x, (tableTop - .09) / 2, z], 'steel');
  box(table, `table_foot_${x}_${z}`, [.12, .025, .12], [x, .0125, z], 'dark');
}
for (const x of [-.275, .275]) box(table, `inspection_alignment_${x}`, [.015, .006, .47], [x, tableTop + .003, 0], 'yellow');

const agv = group(scene, contract.agv.node);
box(agv, 'agv_underbody', [1.05, .18, 1.4], [0, .21, 0], 'dark');
box(agv, 'agv_chassis', [1.1, .27, 1.45], [0, .43, 0], 'orange');
box(agv, 'agv_deck', [1.03, .07, 1.37], [0, .61, 0], 'steel');
for (const z of [-.75, .75]) {
  const end = z > 0 ? 'front' : 'rear';
  box(agv, `agv_${end}_bumper`, [1.06, .11, .065], [0, .31, z], 'rubber');
  box(agv, `agv_${end}_status_strip`, [.54, .035, .014], [0, .5, z], 'green');
}
cylinder(agv, 'agv_lidar_mount', .10, .05, [0, .68, -.56], 'dark');
cylinder(agv, 'agv_lidar', .07, .065, [0, .735, -.56], 'green');
for (const [index, name] of contract.agv.wheelNodes.entries()) {
  const center = contract.agv.wheelCenters[index], wheel = group(agv, name, center);
  cylinder(wheel, `${name}_tire`, contract.agv.wheelRadiusM, .1, [0, 0, 0], 'rubber', [0, 0, Math.PI / 2]);
  const side = center[0] < 0 ? -1 : 1;
  cylinder(wheel, `${name}_hub`, .073, .014, [side * .057, 0, 0], 'steel', [0, 0, Math.PI / 2]);
  for (let spoke = 0; spoke < 3; spoke++) box(wheel, `${name}_spoke_${spoke}`, [.014, .27, .016], [side * .060, 0, 0], 'white', [spoke * Math.PI / 3, 0, 0]);
}

const base = group(scene, 'robot_base', contract.robot.basePosition);
box(base, 'robot_baseplate', [.85, .14, .85], [0, .07, 0], 'dark');
for (const x of [-.34, .34]) for (const z of [-.34, .34]) cylinder(base, `base_bolt_${x}_${z}`, .028, .035, [x, .155, z]);
cylinder(base, 'robot_pedestal', .27, .44, [0, .35, 0], 'orange');
const turret = group(scene, contract.robot.nodes.turret, contract.robot.turretPosition);
cylinder(turret, 'robot_shoulder_axle', .21, .34, [0, .13, 0], 'dark', [Math.PI / 2, 0, 0]);
const upper = group(turret, contract.robot.nodes.shoulder, [0, .13, 0]);
const upperLength = contract.robot.upperLengthM, foreLength = contract.robot.foreLengthM;
box(upper, 'robot_upper_link', [.25, upperLength - .06, .25], [0, upperLength / 2, 0], 'orange');
box(upper, 'robot_upper_cover', [.18, upperLength - .19, .018], [0, upperLength / 2, .139], 'steel');
cylinder(upper, 'robot_elbow_axle', .17, .34, [0, upperLength, 0], 'dark', [Math.PI / 2, 0, 0]);
const fore = group(upper, contract.robot.nodes.elbow, [0, upperLength, 0]);
box(fore, 'robot_fore_link', [.19, foreLength - .1, .20], [0, foreLength / 2, 0], 'orange');
box(fore, 'robot_fore_cover', [.14, foreLength - .25, .014], [0, foreLength / 2, .11], 'steel');
const wrist = group(fore, contract.robot.nodes.wrist, [0, foreLength, 0]);
wrist.rotation.z = Math.PI;
cylinder(wrist, 'robot_wrist_axle', .11, .24, [0, 0, 0], 'steel', [Math.PI / 2, 0, 0]);
box(wrist, 'gripper_crossbar', [.69, .10, .19], [0, .08, 0], 'dark');
const openCenter = (contract.robot.openGapM + contract.robot.fingerWidthM) / 2;
for (const [side, name] of [[-1, contract.robot.nodes.fingerLeft], [1, contract.robot.nodes.fingerRight]]) {
  const finger = group(wrist, name, [side * openCenter, contract.robot.fingerCenterYM, 0]);
  box(finger, `${name}_body`, [contract.robot.fingerWidthM, contract.robot.fingerHeightM, contract.robot.fingerDepthM], [0, 0, 0], 'steel');
}
group(wrist, contract.robot.nodes.tcp, contract.robot.tcpLocalPosition);

const cargoX = group(scene, contract.cargo.nodeX);
const cargoY = group(cargoX, contract.cargo.nodeY, [0, contract.cargo.restPosition[1], 0]);
const cargoZ = group(cargoY, contract.cargo.nodeZ);
const cargoYaw = group(cargoZ, contract.cargo.nodeYaw);
box(cargoYaw, contract.cargo.meshNode, contract.cargo.size, [0, 0, 0], 'carton');
box(cargoYaw, 'cargo_top_tape', [.075, .003, .4], [0, .2015, 0], 'tape');
box(cargoYaw, 'cargo_front_tape', [.075, .4, .003], [0, 0, .2015], 'tape');
box(cargoYaw, 'cargo_label', [.12, .075, .004], [.10, .045, .205], 'white');
for (let i = 0; i < 5; i++) box(cargoYaw, `cargo_barcode_${i}`, [.008, .05, .001], [.06 + i * .018, .045, .2075], 'dark');
scene.updateMatrixWorld(true);

const framesArgument = process.argv.indexOf('--frames');
const framesPath = framesArgument < 0 ? null : process.argv[framesArgument + 1];
assert.ok(framesArgument < 0 || framesPath, '--frames requires an actual backend fixture path');
const framesBytes = framesPath ? readFileSync(framesPath) : null;
const report = await verifyHandlingCellGeometry(T, scene, contract, framesBytes ? { frames: JSON.parse(framesBytes) } : {});
if (framesBytes) report.backendFixtureSha256 = createHash('sha256').update(framesBytes).digest('hex');
const bytes = Buffer.from(await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: true }));
const sha256 = createHash('sha256').update(bytes).digest('hex');
const document = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
const names = document.nodes.map(node => node.name);
assert.ok(names.every(Boolean) && new Set(names).size === names.length, 'Handling cell must have unique named nodes');
assert.equal(document.animations?.length ?? 0, 0, 'Backend controls all motion; no native animation');
assert.equal((document.buffers ?? []).filter(buffer => buffer.uri).length, 0, 'GLB must be self-contained');
const manifestPath = join(root, 'shared/handling-cell-models.ts');
if (existsSync(manifestPath)) {
  const previous = JSON.parse(readFileSync(manifestPath, 'utf8').split(' = ')[1].split(' as const;')[0]);
  const previousVersion = previous.find(item => item.id === contract.modelId);
  if (previousVersion && previousVersion.sha256 !== sha256) throw new Error(`${contract.modelId}: immutable ID already has different bytes; increment resource version`);
}

// Project the actual prepared meshes, including Chinese glyphs, for the thumbnail.
function thumbnail(model) {
  const bounds = new T.Box3().setFromObject(model), center = bounds.getCenter(new T.Vector3());
  const camera = new T.PerspectiveCamera(35, 1, .01, 100);
  camera.position.copy(center).add(new T.Vector3(1.6, 1.7, 2).normalize().multiplyScalar(bounds.getSize(new T.Vector3()).length() * 1.7));
  camera.lookAt(center); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  const faces = [], projected = [], light = new T.Vector3(-.4, 1, .7).normalize();
  model.traverse(object => {
    if (!object.isMesh) return;
    const positions = object.geometry.attributes.position, indices = object.geometry.index;
    for (let i = 0; i < (indices?.count ?? positions.count); i += 3) {
      const points = [0, 1, 2].map(k => new T.Vector3().fromBufferAttribute(positions, indices ? indices.getX(i + k) : i + k).applyMatrix4(object.matrixWorld));
      const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).normalize();
      if (normal.dot(camera.position.clone().sub(points[0])) <= 0) continue;
      const color = object.material.color.clone().multiplyScalar(.6 + .4 * Math.max(0, normal.dot(light))).getHexString();
      const screen = points.map(point => point.clone().project(camera)); projected.push(...screen);
      faces.push({ points: screen, color, depth: points.reduce((sum, point) => sum + point.distanceToSquared(camera.position), 0) / 3 });
    }
  });
  const minX = Math.min(...projected.map(p => p.x)), maxX = Math.max(...projected.map(p => p.x));
  const minY = Math.min(...projected.map(p => p.y)), maxY = Math.max(...projected.map(p => p.y));
  const scale = Math.min(285 / (maxX - minX), 255 / (maxY - minY));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 290"><rect width="320" height="290" rx="12" fill="#e6edf0"/>${faces.sort((a, b) => b.depth - a.depth).map(face => `<polygon points="${face.points.map(p => `${(160 + (p.x - (minX + maxX) / 2) * scale).toFixed(2)},${(145 - (p.y - (minY + maxY) / 2) * scale).toFixed(2)}`).join(' ')}" fill="#${face.color}"/>`).join('')}</svg>`;
}
const filename = `handling-cell.${sha256.slice(0, 12)}.glb`, thumbnailFile = `handling-cell.${sha256.slice(0, 12)}.svg`;
const out = join(root, 'apps/web/public/models/handling-cell'); mkdirSync(out, { recursive: true });
const asset = {
  id: contract.modelId, name: '搬运送检单元', description: '运输车纵向送件，机械臂夹取送检并装车回收；独立车轮、关节、夹爪与单一箱子，由真实后端接口反馈驱动。',
  contentPath: `/models/handling-cell/${filename}`, thumbnailPath: `/models/handling-cell/${thumbnailFile}`,
  originalFilename: '搬运送检单元.glb', format: 'glb', contentType: 'model/gltf-binary', byteSize: bytes.length, sha256, createdAt: '2026-10-09T00:00:00.000Z',
  inspection: { format: 'glb', gltfVersion: '2.0', sceneCount: 1, nodeCount: document.nodes.length, meshCount: document.meshes.length,
    materialCount: document.materials.length, textureCount: document.textures?.length ?? 0, imageCount: document.images?.length ?? 0,
    animationCount: 0, namedNodeCount: names.length, duplicateNodeNames: [], externalResourceCount: 0 },
  defaults: { backgroundColor: '#152431', backgroundOpacity: 1, environmentLightColor: '#e4efff', environmentLightIntensity: 1.5,
    keyLightColor: '#fff3db', keyLightIntensity: 2.5, cameraFov: 38, cameraView: 'isometric', modelScale: 1,
    autoRotate: false, playAnimations: false, animationSpeed: 1,
    presentation: { lighting: 'studio', shellMode: 'original', showFlow: true, explosion: 0 } },
};
writeFileSync(join(out, filename), bytes);
writeFileSync(join(out, thumbnailFile), thumbnail(scene));
writeFileSync(manifestPath, `// Generated by scripts/generate-handling-cell.mjs; original articulated geometry.\nexport const handlingCellModels = ${JSON.stringify([asset], null, 2)} as const;\n`);
const records = join(root, 'demo-assets/handling-cell'); mkdirSync(records, { recursive: true });
writeFileSync(join(records, 'inspection.json'), `${JSON.stringify({ version: 1, modelId: asset.id, sha256, byteSize: bytes.length, source: 'Original procedural geometry; no customer or external assets', contractSha256: createHash('sha256').update(readFileSync(join(root, 'shared/handling-cell-geometry.json'))).digest('hex'), ...report }, null, 2)}\n`);
console.log(JSON.stringify({ status: 'PASS', modelId: asset.id, sha256, byteSize: bytes.length, nodes: names.length, animationCount: 0, ...report }, null, 2));
