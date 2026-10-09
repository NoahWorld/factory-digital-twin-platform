import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const threeRoot = dirname(dirname(require.resolve('three')));
const { OBB } = await import(pathToFileURL(`${threeRoot}/examples/jsm/math/OBB.js`));
const deg = value => value * Math.PI / 180;
const array = value => Array.isArray(value) ? value : [value.x, value.y, value.z];
const near = (actual, expected, tolerance, context) => assert.ok(Math.abs(actual - expected) <= tolerance,
  `${context}: ${actual} != ${expected} (tolerance ${tolerance})`);

/** Independent inverse geometry for preparation poses; final acceptance also uses exported backend frames. */
export function solvePreparationPose(contract, tcp) {
  const { robot } = contract;
  const r = Math.hypot(tcp[0] - robot.shoulderPosition[0], tcp[2] - robot.shoulderPosition[2]);
  const h = tcp[1] + robot.wristToTcpM - robot.shoulderPosition[1];
  const distance = Math.hypot(r, h), upper = robot.upperLengthM, fore = robot.foreLengthM;
  assert.ok(distance < upper + fore && distance > Math.abs(upper - fore), `Preparation TCP is unreachable: ${tcp}`);
  const elbow = Math.acos((distance * distance - upper * upper - fore * fore) / (2 * upper * fore));
  const shoulder = Math.atan2(r, h) - Math.atan2(fore * Math.sin(elbow), upper + fore * Math.cos(elbow));
  return { yawDeg: Math.atan2(tcp[2] - robot.shoulderPosition[2], robot.shoulderPosition[0] - tcp[0]) * 180 / Math.PI,
    shoulderDeg: shoulder * 180 / Math.PI, elbowDeg: elbow * 180 / Math.PI, wristDeg: -(shoulder + elbow) * 180 / Math.PI };
}

export function applyNativeFrame(scene, contract, frame) {
  const node = name => { const found = scene.getObjectByName(name); assert.ok(found, `Missing motion node ${name}`); return found; };
  const { agv, robot, cargo } = contract, names = robot.nodes;
  node(agv.node).position.z = agv.startZM + frame.positionM;
  for (const wheel of agv.wheelNodes) node(wheel).rotation.x = deg(frame.wheelAngleDeg);
  node(names.turret).rotation.y = deg(frame.arm.yawDeg);
  node(names.shoulder).rotation.z = deg(frame.arm.shoulderDeg);
  node(names.elbow).rotation.z = deg(frame.arm.elbowDeg);
  node(names.wrist).rotation.z = Math.PI + deg(frame.arm.wristDeg);
  node(names.fingerLeft).position.x = -(frame.openingM + robot.fingerWidthM) / 2;
  node(names.fingerRight).position.x = (frame.openingM + robot.fingerWidthM) / 2;
  const position = array(frame.cargo);
  node(cargo.nodeX).position.x = position[0]; node(cargo.nodeY).position.y = position[1]; node(cargo.nodeZ).position.z = position[2];
  node(cargo.nodeYaw).rotation.y = deg(frame.cargoYawDeg);
  scene.updateMatrixWorld(true);
}

/** Checks real authored/loaded geometry. Bounding OBBs conservatively include rounded corners. */
export async function verifyHandlingCellGeometry(T, scene, contract, options = {}) {
  const tolerance = contract.clearance.contactToleranceM, tcpTolerance = contract.clearance.tcpToleranceM;
  const nodes = new Map(), originals = new Map(), meshes = [];
  scene.traverse(object => {
    assert.ok(object.visible, `Hidden object would conceal geometry: ${object.name}`);
    if (object.name) { assert.ok(!nodes.has(object.name), `Duplicate node ${object.name}`); nodes.set(object.name, object); }
    originals.set(object, { position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone(),
      matrix: object.matrix.clone(), matrixAutoUpdate: object.matrixAutoUpdate });
    if (object.isMesh) { assert.ok(!object.isSkinnedMesh && !object.morphTargetInfluences, `Unexpected deformable geometry ${object.name}`); meshes.push(object); }
  });
  const node = name => { assert.ok(nodes.has(name), `Missing prepared node ${name}`); return nodes.get(name); };
  const world = name => node(name).getWorldPosition(new T.Vector3());
  const expectVector = (actual, expected, context, allowed = tcpTolerance) => array(actual).forEach((value, index) => near(value, expected[index], allowed, `${context}[${index}]`));
  const descends = (object, ancestor) => { for (let p = object; p; p = p.parent) if (p === ancestor) return true; return false; };
  const bounds = object => { object.geometry.computeBoundingBox(); return object.geometry.boundingBox; };
  const obb = object => {
    const local = bounds(object), half = local.getSize(new T.Vector3()).multiplyScalar(.5);
    // Contact is allowed; remove only the explicitly documented 1 mm numerical/contact tolerance.
    half.set(Math.max(0, half.x - tolerance / 2), Math.max(0, half.y - tolerance / 2), Math.max(0, half.z - tolerance / 2));
    return new OBB(local.getCenter(new T.Vector3()), half).applyMatrix4(object.matrixWorld);
  };
  const armRoot = node(contract.robot.nodes.turret), agvRoot = node(contract.agv.node), cargoRoot = node(contract.cargo.nodeX);
  const armMeshes = meshes.filter(object => descends(object, armRoot) && object.name !== 'robot_shoulder_axle');
  const agvMeshes = meshes.filter(object => descends(object, agvRoot));
  const cargoMeshes = meshes.filter(object => descends(object, cargoRoot));
  const obstacles = meshes.filter(object => descends(object, node('inspection_table')) || descends(object, node('robot_base')));
  const collisions = (left, right, context) => {
    const a = left.map(object => [object, obb(object)]), b = right.map(object => [object, obb(object)]);
    for (const [objectA, boxA] of a) for (const [objectB, boxB] of b) assert.ok(!boxA.intersectsOBB(boxB, 1e-10),
      `${context}: conservative geometry penetration ${objectA.name} / ${objectB.name}`);
  };
  const assertHierarchy = (child, parent) => assert.equal(node(child).parent, node(parent), `Actual hierarchy ${child} → ${parent}`);
  const { robot, cargo, agv } = contract, names = robot.nodes;
  try {
    scene.updateMatrixWorld(true);
    assert.equal(meshes.filter(mesh => mesh.name === cargo.meshNode).length, 1, 'There must be exactly one physical cargo body');
    assertHierarchy(names.shoulder, names.turret); assertHierarchy(names.elbow, names.shoulder);
    assertHierarchy(names.wrist, names.elbow); assertHierarchy(names.fingerLeft, names.wrist); assertHierarchy(names.fingerRight, names.wrist);
    assertHierarchy(names.tcp, names.wrist); assertHierarchy(cargo.nodeY, cargo.nodeX); assertHierarchy(cargo.nodeZ, cargo.nodeY); assertHierarchy(cargo.nodeYaw, cargo.nodeZ);
    for (const key of ['turret', 'shoulder', 'elbow', 'wrist']) expectVector(world(names[key]), robot.restPivots[key], `Root-space rest pivot ${key}`);
    expectVector(world(names.fingerLeft), robot.fingerRestPivots.left, 'Left root-space finger rest');
    expectVector(world(names.fingerRight), robot.fingerRestPivots.right, 'Right root-space finger rest');
    expectVector(world(cargo.meshNode), cargo.restPosition, 'Cargo authored rest position');
    expectVector(bounds(node(cargo.meshNode)).getSize(new T.Vector3()), cargo.size, 'Actual box dimensions');
    near(new T.Box3().setFromObject(node('agv_deck')).max.y, agv.deckTopYM, tcpTolerance, 'Actual AGV deck height');
    near(new T.Box3().setFromObject(node('inspection_tabletop')).max.y, contract.inspectionTable.topYM, tcpTolerance, 'Actual table support height');
    for (const [i, wheelName] of agv.wheelNodes.entries()) {
      const wheel = node(wheelName), tire = node(`${wheelName}_tire`);
      assertHierarchy(wheelName, agv.node); expectVector(world(wheelName), agv.wheelCenters[i], `Wheel ${wheelName} rest center`);
      const tireSize = bounds(tire).getSize(new T.Vector3()); near(tireSize.x / 2, agv.wheelRadiusM, tcpTolerance, 'Physical wheel radius');
      const physicalAxle = new T.Vector3(0, 1, 0).transformDirection(tire.matrixWorld);
      near(Math.abs(physicalAxle.dot(new T.Vector3(...agv.wheelAxis))), 1, tcpTolerance, 'Wheel cylinder axis equals rotation axis');
      near(new T.Box3().setFromObject(tire).min.y, 0, tcpTolerance, 'Wheel touches prepared supporting floor');
    }
    const floorMax = new T.Box3().setFromObject(node('supporting_floor')).max.y;
    near(floorMax, 0, tcpTolerance, 'Supporting floor elevation');
    assert.equal(contract.clearance.liftTcpYM, contract.motion.clearanceTcpY, 'There must be one clearance height');
    assert.equal(contract.phases.reduce((sum, phase) => sum + phase.durationMs, 0), 64000, 'Closed-loop period');
    assert.equal(scene.userData.visibleLabels?.join('|') ?? node('handling_cell').userData.visibleLabels.join('|'), contract.clearance.captionTexts.join('|'));
    for (const caption of ['origin_caption', 'dock_caption', 'inspection_caption']) assert.ok(node(caption).geometry.attributes.position.count > 0, `Visible authored Chinese label ${caption}`);

    const preparationFrames = [
      ['safe-home', contract.motion.homeTcp, cargo.pickupPosition, 'agv', 0],
      ['pickup-open', cargo.pickupPosition, cargo.pickupPosition, 'agv', 0],
      ['pickup-closed', cargo.pickupPosition, cargo.pickupPosition, 'gripper', 0],
      ['raised-pickup', [0, contract.clearance.liftTcpYM, 0], [0, contract.clearance.liftTcpYM, 0], 'gripper', 0],
      ['raised-inspection', [cargo.inspectionPosition[0], contract.clearance.liftTcpYM, cargo.inspectionPosition[2]], [cargo.inspectionPosition[0], contract.clearance.liftTcpYM, cargo.inspectionPosition[2]], 'gripper', 90],
      ['inspection-closed', cargo.inspectionPosition, cargo.inspectionPosition, 'gripper', 90],
      ['inspection-open', cargo.inspectionPosition, cargo.inspectionPosition, 'inspection', 90],
    ].map(([label, tcp, box, attachment, yaw]) => ({ label, tcp, cargo: box, attachment, cargoYawDeg: yaw, arm: solvePreparationPose(contract, tcp),
      positionM: agv.dockZM - agv.startZM, velocityMps: 0, wheelAngleDeg: (agv.dockZM - agv.startZM) / agv.wheelRadiusM * 180 / Math.PI,
      openingM: attachment === 'gripper' ? robot.closedGapM : robot.openGapM }));
    const frames = options.frames ?? preparationFrames;
    assert.ok(frames.length > 0, 'No trajectory frames provided');
    const report = { frameSource: options.frames ? 'actual backend TestBusiness.frameAt fixture' : 'explicit model-preparation poses',
      frames: frames.length, conservativeCollisionToleranceM: tolerance, maxTcpErrorM: 0, maxHeldCargoCenterErrorM: 0,
      maxHeldFingerContactErrorM: 0, minFingerCargoVerticalContactM: Infinity, maxWheelNoSlipErrorMps: 0,
      maxCargoStepM: 0, minTransferCargoAboveSupportM: Infinity, cargoCount: 1, phases: [], rootSpaceRestPivots: robot.restPivots,
      supportingFloorAndPaint: 'Support surface and thin lane/parking paint excluded from obstacle pairs; actual wheel floor contact verified.',
      collisionPairs: 'All moving arm meshes except the mechanically attached shoulder axle against AGV and fixed base/table; cargo against AGV, fixed base/table and all arm meshes including both fingers. Adjacent joint geometry intentionally shares axes, so arm self-joint pairs are not obstacles.' };
    const seenPhases = new Set(); let previousCargo;
    for (const [index, frame] of frames.entries()) {
      const context = `frame ${index} elapsed=${frame.elapsedMs ?? 'preparation'} phase=${frame.phase?.code ?? frame.label}`;
      await (options.applyFrame ?? (value => applyNativeFrame(scene, contract, value)))(frame, index);
      scene.updateMatrixWorld(true);
      const actualTcp = world(names.tcp), expectedTcp = new T.Vector3(...array(frame.tcp));
      const error = actualTcp.distanceTo(expectedTcp); report.maxTcpErrorM = Math.max(report.maxTcpErrorM, error);
      assert.ok(error <= tcpTolerance, `${context}: actual FK TCP error ${error}m`);
      const down = new T.Vector3(0, 1, 0).transformDirection(node(names.wrist).matrixWorld);
      expectVector(down, [0, -1, 0], `${context} wrist remains vertical`);
      const actualCargo = world(cargo.meshNode), expectedCargo = new T.Vector3(...array(frame.cargo));
      assert.ok(actualCargo.distanceTo(expectedCargo) <= tcpTolerance, `${context}: cargo world coordinates disagree`);
      if (previousCargo) report.maxCargoStepM = Math.max(report.maxCargoStepM, previousCargo.distanceTo(actualCargo));
      previousCargo = actualCargo.clone();
      if (frame.phase) seenPhases.add(frame.phase.code);
      near(world(agv.node).z, agv.startZM + frame.positionM, tcpTolerance, `${context} AGV actual +Z direction`);
      const omega = (frame.velocityMps ?? 0) / agv.wheelRadiusM;
      const slip = new T.Vector3(...agv.travelAxis).multiplyScalar(frame.velocityMps ?? 0).add(new T.Vector3(...agv.wheelAxis).multiplyScalar(omega).cross(new T.Vector3(0, -agv.wheelRadiusM, 0))).length();
      report.maxWheelNoSlipErrorMps = Math.max(report.maxWheelNoSlipErrorMps, slip);
      assert.ok(slip < 1e-9, `${context}: wheel roll sign disagrees with vehicle direction`);
      near(frame.wheelAngleDeg * Math.PI / 180 * agv.wheelRadiusM, frame.positionM, tcpTolerance, `${context} real wheel rotation matches displacement`);
      for (const [wheelIndex, wheelName] of agv.wheelNodes.entries()) {
        const center = new T.Vector3(...agv.wheelCenters[wheelIndex]).add(new T.Vector3(0, 0, agv.startZM + frame.positionM));
        const expected = new T.Matrix4().compose(center, new T.Quaternion().setFromAxisAngle(new T.Vector3(...agv.wheelAxis), deg(frame.wheelAngleDeg)), new T.Vector3(1, 1, 1));
        node(wheelName).matrixWorld.elements.forEach((value, i) => near(value, expected.elements[i], tcpTolerance, `${context} actual wheel matrix ${wheelName}[${i}]`));
      }
      for (const object of [...armMeshes, ...cargoMeshes]) assert.ok(new T.Box3().setFromObject(object).min.y >= -tolerance, `${context}: ${object.name} passes below supporting floor`);
      if ([5, 16].includes(frame.phase?.code)) {
        const clearance = new T.Box3().setFromObject(node(cargo.meshNode)).min.y - Math.max(agv.deckTopYM, contract.inspectionTable.topYM);
        report.minTransferCargoAboveSupportM = Math.min(report.minTransferCargoAboveSupportM, clearance);
        assert.ok(clearance > .4, `${context}: transferred cargo lacks raised clearance ${clearance}m`);
      }
      if (frame.attachment === 'gripper') {
        const heldError = actualCargo.distanceTo(actualTcp); report.maxHeldCargoCenterErrorM = Math.max(report.maxHeldCargoCenterErrorM, heldError);
        assert.ok(heldError <= tcpTolerance, `${context}: held cargo detached from real TCP`);
        const inverse = node(names.wrist).matrixWorld.clone().invert(), cargoBounds = bounds(node(cargo.meshNode)), corners = [];
        for (const x of [cargoBounds.min.x, cargoBounds.max.x]) for (const y of [cargoBounds.min.y, cargoBounds.max.y]) for (const z of [cargoBounds.min.z, cargoBounds.max.z]) corners.push(new T.Vector3(x, y, z).applyMatrix4(node(cargo.meshNode).matrixWorld).applyMatrix4(inverse));
        const localCargo = new T.Box3().setFromPoints(corners);
        const leftInner = world(names.fingerLeft).applyMatrix4(inverse).x + robot.fingerWidthM / 2;
        const rightInner = world(names.fingerRight).applyMatrix4(inverse).x - robot.fingerWidthM / 2;
        const contact = Math.max(Math.abs(localCargo.min.x - leftInner), Math.abs(localCargo.max.x - rightInner));
        report.maxHeldFingerContactErrorM = Math.max(report.maxHeldFingerContactErrorM, contact);
        assert.ok(contact <= tolerance, `${context}: actual jaw contact error ${contact}m`);
        const verticalContact = Math.min(localCargo.max.y, robot.fingerCenterYM + robot.fingerHeightM / 2) - Math.max(localCargo.min.y, robot.fingerCenterYM - robot.fingerHeightM / 2);
        report.minFingerCargoVerticalContactM = Math.min(report.minFingerCargoVerticalContactM, verticalContact);
        assert.ok(verticalContact > .25, `${context}: insufficient physical finger contact ${verticalContact}m`);
      }
      collisions(armMeshes, [...agvMeshes, ...obstacles], context);
      collisions(cargoMeshes, [...agvMeshes, ...obstacles, ...armMeshes], context);
      collisions(agvMeshes, obstacles, context);
      if (frame.attachment === 'agv') {
        near(actualCargo.x, world(agv.node).x, tcpTolerance, `${context} cargo supported by vehicle center`);
        near(actualCargo.z, world(agv.node).z, tcpTolerance, `${context} cargo travels on same vehicle`);
        near(actualCargo.y - cargo.size[1] / 2, agv.deckTopYM, tcpTolerance, `${context} cargo vehicle support`);
      } else if (frame.attachment === 'inspection') {
        expectVector(actualCargo, cargo.inspectionPosition, `${context} inspection support`);
        near(actualCargo.y - cargo.size[1] / 2, contract.inspectionTable.topYM, tcpTolerance, `${context} cargo table support`);
      }
    }
    report.phases = [...seenPhases].sort((a, b) => a - b);
    if (!Number.isFinite(report.minTransferCargoAboveSupportM)) report.minTransferCargoAboveSupportM = null;
    if (options.frames) {
      assert.deepEqual(report.phases, contract.phases.map(phase => phase.code), 'Actual fixture must cover every business phase');
      assert.ok(report.maxCargoStepM < .05, `Cargo teleports between 20 ms backend frames: ${report.maxCargoStepM}m`);
      assert.ok(array(frames.at(-1).cargo).every((value, i) => Math.abs(value - array(frames[0].cargo)[i]) < tcpTolerance), 'Same cargo must return to the origin for a continuous cycle');
    }
    return report;
  } finally {
    for (const [object, original] of originals) {
      object.position.copy(original.position); object.quaternion.copy(original.quaternion); object.scale.copy(original.scale);
      object.matrix.copy(original.matrix); object.matrixAutoUpdate = original.matrixAutoUpdate;
    }
    scene.updateMatrixWorld(true);
  }
}
