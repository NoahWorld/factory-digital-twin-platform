// Real GLB, production binding/FK/runtime, and independently exported continuous backend trajectory.
// Export frameAt fixture in the backend first, then:
// node scripts/test-handling-cell.mjs --frames /absolute/path/handling-cell-states.json
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyHandlingCellGeometry } from './handling-cell-geometry-check.mjs';

const root = fileURLToPath(new URL('..', import.meta.url)), require = createRequire(join(root, 'apps/web/package.json'));
const T = require('three'), threeRoot = dirname(dirname(require.resolve('three')));
const { GLTFLoader } = await import(pathToFileURL(join(threeRoot, 'examples/jsm/loaders/GLTFLoader.js')));
const { build } = createRequire(require.resolve('vite'))('esbuild');
const contract = JSON.parse(await readFile(join(root, 'shared/handling-cell-geometry.json')));
const manifest = JSON.parse((await readFile(join(root, 'shared/handling-cell-models.ts'), 'utf8')).split(' = ')[1].split(' as const;')[0]);
const asset = manifest.find(item => item.id === contract.modelId); assert.ok(asset, 'Prepared handling-cell resource is registered');
const framesArgument = process.argv.indexOf('--frames');
assert.ok(framesArgument >= 0 && process.argv[framesArgument + 1], 'Provide the actual backend frameAt fixture with --frames');
const fixtureBytes = await readFile(process.argv[framesArgument + 1]), frames = JSON.parse(fixtureBytes);
assert.equal(frames.length, 3200, 'Expected the independently exported 20 ms / 64 s backend fixture');
const bytes = await readFile(join(root, 'apps/web/public', asset.contentPath));
const sha256 = createHash('sha256').update(bytes).digest('hex'); assert.equal(sha256, asset.sha256); assert.equal(bytes.length, asset.byteSize);
const document = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
assert.equal(document.animations?.length ?? 0, 0, 'All visible motion comes from actual backend feedback');
assert.equal((document.buffers ?? []).filter(item => item.uri).length, 0);
assert.equal((document.images ?? []).filter(item => item.uri).length, 0);
assert.equal((document.nodes ?? []).filter(item => item.name === contract.cargo.meshNode).length, 1);
const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const model = gltf.scene, wrapper = new T.Group(); wrapper.add(model); model.updateMatrixWorld(true);
const record = { id: 'handling-cell', assetId: contract.modelId, model, wrapper, originals: new Map(), objectsByName: new Map() };
model.traverse(object => {
  record.originals.set(object, { position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone() });
  if (object.name) record.objectsByName.set(object.name, [...(record.objectsByName.get(object.name) ?? []), object]);
});
const temporary = await mkdtemp(join(tmpdir(), 'kingdom-handling-cell-test-'));
let runtime;
try {
  const outfile = join(temporary, 'production.mjs');
  await build({ stdin: { contents: `export { TwinDriveRuntime } from ${JSON.stringify(join(root, 'apps/web/src/scene/twin-drive-runtime.ts'))};\nexport { businessApiExampleConfig } from ${JSON.stringify(join(root, 'apps/web/src/twin/business-api-example.ts'))};`,
    resolveDir: root, sourcefile: 'actual-handling-cell-runtime.mjs' }, outfile, bundle: true, platform: 'node', format: 'esm',
    define: { 'import.meta.env': '{}' }, logLevel: 'warning' });
  const { TwinDriveRuntime, businessApiExampleConfig } = await import(pathToFileURL(outfile));
  const config = businessApiExampleConfig('rest'); assert.equal(config.connection.intervalMs, 200, 'Use the real example source interval');
  for (const binding of config.bindings) {
    assert.equal(binding.target.modelAssetId, asset.id); assert.equal(binding.useNodeRestPose, true);
    assert.equal(record.objectsByName.get(binding.target.nodeName)?.length, 1, `Actual config node ${binding.target.nodeName}`);
  }
  const values = frame => new Map([
    ['agv-position', frame.positionM], ['wheel-angle', frame.wheelAngleDeg], ['robot-yaw', frame.arm.yawDeg],
    ['robot-shoulder', frame.arm.shoulderDeg], ['robot-elbow', frame.arm.elbowDeg], ['robot-wrist', frame.arm.wristDeg],
    ['gripper-opening', frame.openingM], ['cargo-x', frame.cargo.x], ['cargo-y', frame.cargo.y], ['cargo-z', frame.cargo.z],
    ['cargo-yaw', frame.cargoYawDeg], ['business-phase', frame.phase.code],
  ]);
  const source = { getState: () => { throw new Error('Endpoint geometry checks must never fetch or generate source feedback'); } };
  runtime = new TwinDriveRuntime([record], { config, source });
  // Invoke the actual validated endpoint FK path; this checks real runtime matrices, not a copy of the formula.
  const report = await verifyHandlingCellGeometry(T, model, contract, { frames, applyFrame(frame) {
    const observed = values(frame), poses = runtime.calculatePose(observed); runtime.validatePose(poses); runtime.applyValues(observed, poses);
  } });
  runtime.dispose(); runtime = null;

  // Now exercise actual tick/transition/advance at 200 ms source intervals and 20 ms render frames.
  let state, sequence = 0, newest;
  runtime = new TwinDriveRuntime([record], { config, source: { getState: () => state } });
  const startedAt = Date.parse('2026-10-09T00:00:00.000Z');
  const snapshot = frame => ({ source: 'api', status: 'live', sequence: ++sequence, timestamp: new Date(startedAt + frame.elapsedMs).toISOString(),
    points: Object.fromEntries([...values(frame)].map(([id, value]) => [id, { value, quality: 'good', timestamp: new Date(startedAt + frame.elapsedMs).toISOString() }])) });
  const interpolation = { sourceIntervalMs: 200, renderStepMs: 20, frames: 0, heldFrames: 0,
    maxHeldTcpCargoOffsetM: 0, maxFingerPenetrationM: 0, maxFingerSeparationM: 0,
    maxCargoSupportErrorM: 0, maxWristVerticalError: 0, worstContact: null };
  const node = name => { const found = model.getObjectByName(name); assert.ok(found); return found; };
  const cargoMesh = node(contract.cargo.meshNode); cargoMesh.geometry.computeBoundingBox(); const cargoBounds = cargoMesh.geometry.boundingBox;
  for (const frame of frames) {
    if (frame.elapsedMs % 200 === 0) { newest = frame; state = { connected: true, snapshot: snapshot(frame) }; }
    runtime.tick(startedAt + frame.elapsedMs, false, frame.elapsedMs); assert.equal(runtime.diagnostics.status, 'live', runtime.diagnostics.message);
    model.updateMatrixWorld(true); interpolation.frames++;
    const down = new T.Vector3(0, 1, 0).transformDirection(node(contract.robot.nodes.wrist).matrixWorld);
    interpolation.maxWristVerticalError = Math.max(interpolation.maxWristVerticalError, down.distanceTo(new T.Vector3(0, -1, 0)));
    const cargoCenter = cargoMesh.getWorldPosition(new T.Vector3());
    const phase = newest.phase.code;
    // Phase ownership is discrete source state. During entry packets, a 200 ms delayed geometry may
    // still be completing the prior open/close transition. Measure contact only after both endpoints
    // hold the same closed clamp; transitions are also required to remain continuous.
    const held = newest.attachment === 'gripper' && runtime.displayValues.get('gripper-opening') <= contract.robot.closedGapM + 1e-9;
    if (held) {
      interpolation.heldFrames++;
      const tcp = node(contract.robot.nodes.tcp).getWorldPosition(new T.Vector3()), offset = tcp.distanceTo(cargoCenter);
      interpolation.maxHeldTcpCargoOffsetM = Math.max(interpolation.maxHeldTcpCargoOffsetM, offset);
      const inverse = node(contract.robot.nodes.wrist).matrixWorld.clone().invert(), corners = [];
      for (const x of [cargoBounds.min.x, cargoBounds.max.x]) for (const y of [cargoBounds.min.y, cargoBounds.max.y]) for (const z of [cargoBounds.min.z, cargoBounds.max.z]) corners.push(new T.Vector3(x, y, z).applyMatrix4(cargoMesh.matrixWorld).applyMatrix4(inverse));
      const local = new T.Box3().setFromPoints(corners), opening = runtime.displayValues.get('gripper-opening');
      const leftInner = node(contract.robot.nodes.fingerLeft).getWorldPosition(new T.Vector3()).applyMatrix4(inverse).x + contract.robot.fingerWidthM / 2;
      const rightInner = node(contract.robot.nodes.fingerRight).getWorldPosition(new T.Vector3()).applyMatrix4(inverse).x - contract.robot.fingerWidthM / 2;
      assert.ok(Math.abs(rightInner - leftInner - opening) < 1e-9, 'Actual matrix-driven fingers must follow their received opening');
      const penetration = Math.max(0, leftInner - local.min.x, local.max.x - rightInner);
      const separation = Math.max(0, local.min.x - leftInner, rightInner - local.max.x);
      if (penetration > interpolation.maxFingerPenetrationM) interpolation.worstContact = { elapsedMs: frame.elapsedMs, phase, sourceElapsedMs: newest.elapsedMs };
      interpolation.maxFingerPenetrationM = Math.max(interpolation.maxFingerPenetrationM, penetration);
      interpolation.maxFingerSeparationM = Math.max(interpolation.maxFingerSeparationM, separation);
    }
    if (newest.attachment === 'agv' && [0, 1, 3, 20, 21].includes(phase)) {
      const agvCenter = node(contract.agv.node).getWorldPosition(new T.Vector3());
      interpolation.maxCargoSupportErrorM = Math.max(interpolation.maxCargoSupportErrorM, Math.abs(cargoCenter.y - contract.cargo.size[1] / 2 - contract.agv.deckTopYM), Math.abs(cargoCenter.z - agvCenter.z));
    }
  }
  assert.ok(interpolation.heldFrames > 100, 'Actual runtime must show repeated closed gripper/cargo contact');
  assert.ok(interpolation.maxWristVerticalError < 1e-9, 'Compensated wrist must remain vertical throughout interpolation');
  assert.ok(interpolation.maxCargoSupportErrorM < 1e-9, 'Vehicle and cargo must interpolate on the same continuous path');
  // Explicit display tolerance: 200 ms linear angular/XYZ observations have a small measurable chord
  // error. This is recorded rather than falsely claiming exact rigidity or industrial collision safety.
  assert.ok(interpolation.maxHeldTcpCargoOffsetM < .005, `Visible interpolated cargo/TCP offset exceeds 5 mm: ${interpolation.maxHeldTcpCargoOffsetM}`);
  assert.ok(interpolation.maxFingerPenetrationM < .005, `Visible interpolated jaw penetration exceeds 5 mm: ${interpolation.maxFingerPenetrationM}`);
  assert.ok(interpolation.maxFingerSeparationM < .005, `Visible interpolated jaw separation exceeds 5 mm: ${interpolation.maxFingerSeparationM}`);
  const receipt = { status: 'PASS', modelId: asset.id, sha256, byteSize: bytes.length, animationCount: gltf.animations.length,
    backendFixtureSha256: createHash('sha256').update(fixtureBytes).digest('hex'),
    runtimeSourceSha256: createHash('sha256').update(await readFile(join(root, 'apps/web/src/scene/twin-drive-runtime.ts'))).digest('hex'),
    bindingSourceSha256: createHash('sha256').update(await readFile(join(root, 'apps/web/src/twin/business-api-example.ts'))).digest('hex'),
    exactBackendGeometry: report, displayedInterpolation: interpolation };
  const output = join(root, 'deploy/local/.local/business-api-example'); await mkdir(output, { recursive: true, mode: 0o700 });
  await writeFile(join(output, 'handling-cell-geometry-test.json'), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(receipt, null, 2));
} finally { runtime?.dispose(); await rm(temporary, { recursive: true, force: true }); }
