import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { STATIC_MAP_LIMITS as L, STATIC_MAP_EXAMPLE, parseStaticMap, importGeoJson, staticMapBudget } from '../../../shared/static-map';
import { StaticMapManager } from '../src/scene/static-map-manager';

const clone = value => structuredClone(value);
const options = { id: 'test-map', label: '虚构测试场区', coordinateSystem: 'local', width: 20, defaultHeight: 3, color: '#658fad', outlineColor: '#203445' };
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const polygon = (outer = rect(0, 0, 10, 5), holes = []) => ({ outer, holes });
const feature = (polygons = [polygon()], id = 'building-1', height = 3) => ({ id, label: id, height, color: '#658fad', polygons });
const mapOf = (features = [feature()], extra = {}) => ({ version: 1, id: 'test-map', label: '测试场区', visible: true, coordinateSystem: 'local', width: 20,
  outlineColor: '#203445', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, features, ...extra });
const geoFeature = (rings = [rect(0, 0, 10, 5)], extra = {}) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: rings }, ...extra });
const collection = (...features) => ({ type: 'FeatureCollection', features });
const accepted = input => { const parsed = parseStaticMap(input); assert.equal(parsed.ok, true, parsed.message); return parsed.value; };
const rejected = (input, pattern) => { const parsed = parseStaticMap(input); assert.equal(parsed.ok, false, 'invalid input was accepted'); if (pattern) assert.match(parsed.message, pattern); };
const imported = (input, opts = options) => { const parsed = importGeoJson(input, opts); assert.equal(parsed.ok, true, parsed.message); return parsed.value; };
const importRejected = (input, opts = options, pattern) => { const parsed = importGeoJson(input, opts); assert.equal(parsed.ok, false); if (pattern) assert.match(parsed.message, pattern); };
const near = (a, b, epsilon = 1e-5) => assert.ok(Math.abs(a - b) <= epsilon, `${a} differs from ${b}`);
const objects = root => { const found = []; root.traverse(object => found.push(object)); return found; };
const resources = root => ({
  geometries: new Set(objects(root).flatMap(object => object.geometry ? [object.geometry] : [])),
  materials: new Set(objects(root).flatMap(object => object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : [])),
});
function disposalWatch(root) {
  const owned = resources(root), calls = new Map();
  for (const value of [...owned.geometries, ...owned.materials]) {
    calls.set(value, 0); value.addEventListener('dispose', () => calls.set(value, calls.get(value) + 1));
  }
  return expected => { for (const count of calls.values()) assert.equal(count, expected); };
}
function capArea(mesh, height) {
  const p = mesh.geometry.getAttribute('position'), indices = mesh.geometry.index;
  let area = 0;
  for (let i = 0; i < (indices?.count ?? p.count); i += 3) {
    const ids = [0, 1, 2].map(j => indices ? indices.getX(i + j) : i + j);
    if (!ids.every(id => Math.abs(p.getY(id) - height) < 1e-6)) continue;
    const [a, b, c] = ids;
    area += Math.abs((p.getX(b) - p.getX(a)) * (p.getZ(c) - p.getZ(a)) - (p.getZ(b) - p.getZ(a)) * (p.getX(c) - p.getX(a))) / 2;
  }
  return area;
}

test('parse: explicit null removal, undefined rejection and canonical deep copies', () => {
  assert.deepEqual(parseStaticMap(null), { ok: true, value: null });
  assert.deepEqual(parseStaticMap('null'), { ok: true, value: null });
  for (const value of [undefined, false, 3, [], {}, 'undefined', '']) rejected(value);
  const input = mapOf([feature([polygon(rect(0, 0, 10, 10), [rect(2, 2, 4, 4)])])]);
  const parsed = accepted(input);
  assert.deepEqual(parsed, input); assert.notEqual(parsed, input);
  assert.notEqual(parsed.features[0].polygons[0].holes[0][0], input.features[0].polygons[0].holes[0][0]);
  parsed.transform.position[0] = 7; parsed.features[0].polygons[0].outer[0][0] = 99;
  assert.equal(input.transform.position[0], 0); assert.equal(input.features[0].polygons[0].outer[0][0], 0);
  assert.deepEqual(accepted(JSON.stringify(input)), input);
});

test('parse: strict object fields, required fields and scalar types at every declaration level', () => {
  for (const mutate of [
    m => { m.extra = 1; }, m => { delete m.visible; }, m => { m.version = 2; }, m => { m.visible = 'true'; },
    m => { m.coordinateSystem = 'epsg:4326'; }, m => { m.features[0].extra = true; }, m => { delete m.features[0].height; },
    m => { m.features[0].polygons[0].extra = 1; }, m => { delete m.features[0].polygons[0].holes; },
    m => { m.transform.quaternion = [0, 0, 0, 1]; }, m => { m.transform.position = [0, 0]; },
    m => { m.features[0].polygons[0].outer[0] = [0, 0, 0]; }, m => { m.features[0].polygons[0].outer[0] = ['0', 0]; },
    m => { m.width = '20'; }, m => { m.features[0].height = null; }, m => { m.features[0].color = false; },
  ]) { const input = mapOf(); mutate(input); rejected(input); }
});

test('parse: stable IDs, printable labels and exact six-digit HEX colors', () => {
  for (const value of ['', 'white space', 'bad\n', 'a'.repeat(121), 2]) rejected(mapOf(undefined, { id: value }));
  for (const value of ['', '  ', 'a\u0000b', 'a\u0085b', '汉'.repeat(81), null]) rejected(mapOf(undefined, { label: value }));
  for (const value of ['red', '#fff', '#000000\n', '#12345g', null]) rejected(mapOf(undefined, { outlineColor: value }));
  accepted(mapOf(undefined, { id: 'A._:-1', label: '汉'.repeat(80), outlineColor: '#aBcD09' }));
  rejected(mapOf([feature(), feature()]), /Duplicate/);
  const invalidFeatureId = mapOf(); invalidFeatureId.features[0].id = 'bad/id'; rejected(invalidFeatureId);
});

test('parse: exact numeric boundaries, finite transforms and exclusive minimum scale', () => {
  for (const width of [L.minimumWidth, L.maximumWidth]) accepted(mapOf(undefined, { width }));
  for (const width of [0, 0.09, 10000.1, NaN, Infinity]) rejected(mapOf(undefined, { width }));
  for (const height of [0, 1000]) accepted(mapOf([feature(undefined, 'valid-height', height)]));
  for (const height of [-1, 1000.1, NaN]) rejected(mapOf([feature(undefined, 'bad-height', height)]));
  const valid = mapOf(undefined, { transform: { position: [-10000, 0, 10000], rotation: [-3600, 0, 3600], scale: [0.001001, 1, 100] } });
  accepted(valid);
  for (const [key, value] of [['position', [10000.1, 0, 0]], ['rotation', [0, 3600.1, 0]], ['scale', [0.001, 1, 1]], ['scale', [0, 1, 1]], ['scale', [1, 101, 1]], ['scale', [-1, 1, 1]]]) {
    const bad = mapOf(); bad.transform[key] = value; rejected(bad);
  }
  rejected(mapOf([feature([polygon(rect(0, 0, 10001, 10))])]));
});

test('topology: Polygon, holes, concavity, winding reversal and disjoint MultiPolygon', () => {
  const concave = [[0, 0], [10, 0], [10, 10], [5, 5], [0, 10], [0, 0]];
  accepted(mapOf([feature([polygon(concave)])]));
  const outer = rect(0, 0, 10, 10), hole = rect(2, 2, 4, 4);
  for (const a of [outer, [...outer].reverse()]) for (const h of [hole, [...hole].reverse()]) accepted(mapOf([feature([polygon(a, [h])])]));
  accepted(mapOf([feature([polygon(), polygon(rect(20, 0, 24, 4))])]));
  // A repeated linearly intermediate vertex is not needed, but distinct collinear vertices are legal.
  accepted(mapOf([feature([polygon([[0, 0], [5, 0], [10, 0], [10, 5], [0, 5], [0, 0]])])]));
});

test('topology: rejects unclosed, degenerate, backtracking, duplicate and self-intersecting rings', () => {
  for (const ring of [
    [[0, 0], [10, 0], [10, 5], [0, 5]],
    [[0, 0], [10, 0], [10, 5], [0, 0.000000001]],
    [[0, 0], [1, 0], [2, 0], [0, 0]],
    [[0, 0], [10, 0], [10, 0], [10, 5], [0, 0]],
    [[0, 0], [10, 10], [0, 10], [10, 0], [0, 0]],
    [[0, 0], [10, 0], [5, 0], [10, 5], [0, 5], [0, 0]],
    [[0, 0], [4, 0], [4, 4], [2, 2], [0, 4], [2, 2], [0, 0]],
  ]) rejected(mapOf([feature([polygon(ring)])]));
  const tiny = rect(1, 1, 1 + 1e-8, 1 + 1e-8);
  rejected(mapOf([feature(), feature([polygon(tiny)], 'too-small')]), /tolerance|close|degenerate/);
});

test('topology: holes must be strictly inside, non-touching, non-nested and pairwise disjoint', () => {
  const outer = rect(0, 0, 10, 10);
  for (const holes of [
    [rect(12, 2, 14, 4)], [rect(-1, 2, 2, 4)], [rect(0, 2, 2, 4)],
    [[[0, 0], [2, 1], [1, 2], [0, 0]]],
    [rect(1, 1, 4, 4), rect(3, 3, 6, 6)],
    [rect(1, 1, 7, 7), rect(2, 2, 3, 3)],
    [rect(1, 1, 3, 3), rect(3, 1, 5, 3)],
    [rect(1, 1, 3, 3), rect(3, 3, 5, 5)],
  ]) rejected(mapOf([feature([polygon(outer, holes)])]));
  const concaveOuter = [[0, 0], [10, 0], [10, 10], [7, 10], [7, 3], [3, 3], [3, 10], [0, 10], [0, 0]];
  rejected(mapOf([feature([polygon(concaveOuter, [rect(2, 6, 8, 8)])])]), /strictly inside/);
});

test('topology: MultiPolygon rejects overlap/containment but allows non-overlapping edge or vertex contact', () => {
  const outer = rect(0, 0, 10, 10);
  for (const other of [rect(5, 0, 15, 10), rect(2, 2, 4, 4), outer, [[5, -2], [12, 5], [5, 12], [-2, 5], [5, -2]]])
    rejected(mapOf([feature([polygon(outer), polygon(other)])]), /overlaps/);
  accepted(mapOf([feature([polygon(outer), polygon(rect(10, 0, 20, 10))])]));
  accepted(mapOf([feature([polygon(outer), polygon(rect(10, 10, 20, 20))])]));
  accepted(mapOf([feature([polygon(outer, [rect(2, 2, 8, 8)]), polygon(rect(3, 3, 7, 7))])]));
  // A polygon wholly in a hole may share that hole's boundary without overlapping filled material.
  accepted(mapOf([feature([polygon(outer, [rect(2, 2, 8, 8)]), polygon(rect(2, 2, 8, 8))])]));
});

test('topology: deterministic rectangle grid oracle checks overlap, containment and touching independently of winding', () => {
  const a = rect(0, 0, 2, 2);
  for (let x = -2; x <= 3; x++) for (let y = -2; y <= 3; y++) for (const reverse of [false, true]) {
    const b = rect(x, y, x + 2, y + 2);
    const overlaps = Math.min(2, x + 2) > Math.max(0, x) && Math.min(2, y + 2) > Math.max(0, y);
    const result = parseStaticMap(mapOf([feature([polygon(a), polygon(reverse ? [...b].reverse() : b)])]));
    assert.equal(result.ok, !overlaps, `rectangle overlap oracle failed at ${x},${y}, reverse=${reverse}: ${result.message}`);
  }
});

test('topology: rotated convex overlap agrees with an independent clipping-area oracle', () => {
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const area = points => Math.abs(points.reduce((sum, p, i) => { const next = points[(i + 1) % points.length]; return sum + p[0] * next[1] - next[0] * p[1]; }, 0)) / 2;
  const intersectionArea = (subject, clip) => {
    let result = subject.slice(0, -1);
    for (let i = 0; i < clip.length - 1 && result.length; i++) {
      const a = clip[i], b = clip[i + 1], current = result; result = [];
      for (let j = 0; j < current.length; j++) {
        const p = current[j], q = current[(j + 1) % current.length], dp = cross(a, b, p), dq = cross(a, b, q);
        if (dp >= 0) result.push(p);
        if ((dp < 0) !== (dq < 0)) { const t = dp / (dp - dq); result.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]); }
      }
    }
    return area(result);
  };
  const rotated = (cx, cy, angle) => {
    const points = [[-1, -0.7], [1, -0.7], [1, 0.7], [-1, 0.7]].map(([x, y]) => [cx + x * Math.cos(angle) - y * Math.sin(angle), cy + x * Math.sin(angle) + y * Math.cos(angle)]);
    return [...points, [...points[0]]];
  };
  const a = rect(-1, -1, 1, 1);
  for (let i = 0; i < 160; i++) {
    const b = rotated((i % 11) * 0.41 - 2, (i % 7) * 0.53 - 1.6, i * 0.137), overlap = intersectionArea(a, b);
    if (overlap > 0 && overlap < 1e-6) continue; // Below the deliberate topology tolerance is not an oracle disagreement.
    const actual = parseStaticMap(mapOf([feature([polygon(i % 2 ? [...a].reverse() : a), polygon(i % 3 ? b : [...b].reverse())])]));
    assert.equal(actual.ok, overlap < 1e-12, `clipping oracle case ${i}: area=${overlap}; ${actual.message}`);
  }
});

test('budgets: feature/polygon/hole/ring limits and total point preflight before topology', () => {
  rejected(mapOf([]), /1\.\.64/);
  rejected(mapOf(Array.from({ length: 65 }, (_, i) => feature(undefined, `f-${i}`))), /1\.\.64/);
  rejected(mapOf([feature([])]));
  rejected(mapOf([feature(Array.from({ length: 17 }, () => polygon()))]), /1\.\.16/);
  rejected(mapOf([feature([polygon(rect(0, 0, 10, 10), Array.from({ length: 9 }, () => rect(1, 1, 2, 2)))])]), /0\.\.8/);
  rejected(mapOf([feature([polygon([[0, 0], [1, 1], [0, 0]])])]));
  const circle = (n, cx = 0) => { const p = Array.from({ length: n }, (_, i) => [cx + Math.cos(i * 2 * Math.PI / n), Math.sin(i * 2 * Math.PI / n)]); return [...p, [...p[0]]]; };
  accepted(mapOf([feature([polygon(circle(256))])]));
  rejected(mapOf([feature([polygon(circle(257))])]), /4\.\.257/);
  const exact = mapOf(Array.from({ length: 16 }, (_, i) => feature([polygon(circle(255, i * 3))], `f-${i}`)));
  accepted(exact); // 16 * 256 = 4096, including each ring's closing point.
  const over = clone(exact);
  over.features[0].polygons[0].outer[1] = [...over.features[0].polygons[0].outer[0]]; // Also bad topology.
  over.features.push(feature([polygon(rect(0, 0, 1, 1))], 'over-budget'));
  rejected(over, /total ring points/); // Budget wins before the duplicate edge/topology walk.
});

test('budgets: UTF-8 bytes, object serialization, depth, cycles and accessors are bounded without executing user code', () => {
  const source = collection(geoFeature());
  const json = JSON.stringify(source);
  imported(json + ' '.repeat(L.maximumJsonBytes - Buffer.byteLength(json)));
  importRejected(json + ' '.repeat(L.maximumJsonBytes - Buffer.byteLength(json) + 1), options, /bytes/);
  importRejected({ ...source, metadata: '汉'.repeat(175000) }, options, /bytes/);
  importRejected(JSON.stringify({ ...source, metadata: '汉'.repeat(175000) }), options, /bytes/);
  let deep = { value: 1 }; for (let i = 0; i < 40; i++) deep = { child: deep };
  importRejected({ ...source, metadata: deep }, options, /nesting/);
  const cycle = mapOf(); cycle.circular = cycle; rejected(cycle, /circular/);
  for (const metadata of [1n, undefined, new Date(), () => 1, NaN]) importRejected({ ...source, metadata });
  let accessed = 0;
  const accessor = mapOf(); Object.defineProperty(accessor, 'bad', { enumerable: true, get() { accessed++; return 1; } });
  rejected(accessor, /accessors/); assert.equal(accessed, 0);
  const custom = mapOf(); custom.toJSON = () => { accessed++; return {}; }; rejected(custom); assert.equal(accessed, 0);
  const sparse = mapOf(); sparse.features = new Array(1); rejected(sparse);
  const namedArray = mapOf(); namedArray.features.extra = 1; rejected(namedArray);
  const symbol = mapOf(); symbol[Symbol('hidden')] = 1; rejected(symbol);
  const reused = { message: 'ordinary repeated alias' }; imported({ ...source, first: reused, second: reused });
});

test('GeoJSON: example, stable identity, property overrides, fallback order and independent normalized objects', () => {
  const example = imported(STATIC_MAP_EXAMPLE);
  assert.equal(example.features.length, 3); assert.equal(example.features[2].polygons[0].holes.length, 1);
  const source = collection(
    geoFeature(undefined, { id: 'explicit', properties: { id: 'lower-priority', name: '建筑', height: 0, color: '#Ab3456' } }),
    geoFeature(undefined, { properties: { id: 'property-id' } }), geoFeature(undefined, { properties: null }),
  );
  const result = imported(source);
  assert.deepEqual(result.features.map(f => f.id), ['explicit', 'property-id', 'geo-3']);
  assert.equal(result.features[0].label, '建筑'); assert.equal(result.features[0].height, 0); assert.equal(result.features[0].color, '#Ab3456');
  assert.deepEqual(result.transform, { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
  result.features[0].polygons[0].outer[0][0] = 999;
  assert.equal(source.features[0].geometry.coordinates[0][0][0], 0);
  const multi = collection(geoFeature(undefined, { geometry: { type: 'MultiPolygon', coordinates: [[rect(0, 0, 10, 10), rect(2, 2, 4, 4)], [rect(20, 0, 24, 4)]] } }));
  assert.equal(imported(multi).features[0].polygons.length, 2);
  const longId = imported(collection(geoFeature(undefined, { id: 'a'.repeat(120) })));
  assert.equal(longId.features[0].id.length, 120);
  assert.equal(longId.features[0].label, '区域 1', 'a valid long ID must not overflow the fallback label budget');
});

test('parse/import: frozen input remains untouched and every returned mutable tuple is independently owned', () => {
  const source = collection(geoFeature([rect(0, 0, 10, 10), rect(2, 2, 4, 4)]));
  const freeze = value => { const stack = [value]; while (stack.length) { const item = stack.pop(); if (item && typeof item === 'object' && !Object.isFrozen(item)) { stack.push(...Object.values(item)); Object.freeze(item); } } return value; };
  freeze(source);
  const first = imported(source), second = accepted(freeze(first));
  assert.notEqual(first.features[0].polygons[0].outer[0], second.features[0].polygons[0].outer[0]);
  assert.notEqual(second.features[0].polygons[0].outer[0], second.features[0].polygons[0].outer.at(-1));
  second.features[0].polygons[0].holes[0][0][0] = 9;
  assert.equal(source.features[0].geometry.coordinates[1][0][0], 2);
});

test('GeoJSON: rejects unknown geometry, bad consumed fields and invalid defaults instead of dropping features', () => {
  for (const type of ['Point', 'LineString', 'GeometryCollection', 'RemotePolygon', null]) importRejected(collection(geoFeature(undefined, { geometry: { type, coordinates: [rect(0, 0, 1, 1)], href: 'https://invalid.example/map' } })));
  importRejected({ type: 'Feature', features: [] });
  importRejected(collection({ ...geoFeature(), type: 'Polygon' }));
  importRejected(collection({ ...geoFeature(), geometry: null }));
  for (const props of [{ height: '3' }, { height: null }, { color: '#fff' }, { name: 4 }, { id: 3 }]) importRejected(collection(geoFeature(undefined, { properties: props })));
  importRejected(collection(geoFeature(undefined, { id: 1 })));
  importRejected(collection(geoFeature(), geoFeature(undefined, { id: 'geo-1' })), options, /Duplicate/);
  for (const bad of [{ ...options, width: '20' }, { ...options, defaultHeight: -1 }, { ...options, color: false }, { ...options, coordinateSystem: 'projected' }, { ...options, extra: true }]) importRejected(collection(geoFeature()), bad);
  importRejected(collection(geoFeature([[[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 0, 1]]])));
});

test('GeoJSON: ignored ordinary metadata, CRS and URI members cannot trigger requests or survive normalization', () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => { calls++; throw new Error('Network is forbidden in static-map import.'); };
  try {
    const source = { ...collection({ ...geoFeature(), links: [{ href: 'https://invalid.example/f' }], crs: { href: 'https://invalid.example/crs' },
      properties: { ignored: { url: 'https://invalid.example/x' } },
      geometry: { ...geoFeature().geometry, href: 'https://invalid.example/g', crs: { type: 'link' } } }), crs: { type: 'name', properties: { name: 'unsupported' } } };
    const normalized = imported(source);
    assert.equal(calls, 0); assert.equal(normalized.coordinateSystem, 'local');
    assert.doesNotMatch(JSON.stringify(normalized), /https:|ignored|"crs"|"links"/);
  } finally { globalThis.fetch = originalFetch; }
});

test('wgs84: range checks and whole-map date-line rejection, including independent features', () => {
  const opts = { ...options, coordinateSystem: 'wgs84' };
  imported(collection(geoFeature([rect(119.999, 59.999, 120.001, 60.001)])), opts);
  imported(collection(geoFeature([rect(179.9, 84.9, 180, 85)])), opts);
  for (const ring of [rect(179, 0, 180.1, 1), rect(0, 84, 1, 85.1), rect(-179, 0, 179, 1)]) importRejected(collection(geoFeature([ring])), opts);
  importRejected(collection(geoFeature([rect(-179, 0, -178, 1)]), geoFeature([rect(178, 0, 179, 1)])), opts, /date-line/);
  imported(collection(geoFeature([rect(-90, -1, 90, 1)])), opts);
});

test('manager: local XZ bounds, real extrusion height, feature metadata and conservative geometry budget', () => {
  const parent = new THREE.Group(), manager = new StaticMapManager(parent), map = mapOf();
  try {
    manager.reconcile(map);
    const bounds = manager.getBounds(); near(bounds.min.x, -10); near(bounds.max.x, 10); near(bounds.min.z, -5); near(bounds.max.z, 5);
    near(bounds.min.y, 0); near(bounds.max.y, 3);
    assert.equal(parent.children[0].userData.staticMapId, map.id);
    assert.deepEqual(manager.getPickObjects().map(o => o.userData.staticMapFeatureId), ['building-1']);
    const stats = manager.diagnostics(), budget = staticMapBudget(map), all = objects(parent.children[0]);
    assert.equal(stats.featureCount, budget.instances);
    assert.equal(stats.meshCount, all.filter(o => o.isMesh || o.isLineSegments).length);
    assert.ok(stats.meshCount <= budget.meshes); assert.ok(stats.triangleCount <= budget.triangles); assert.equal(stats.triangleCount, 12);
    assert.equal(budget.animatedInstances, 0); assert.ok(all.every(o => !o.isLight && !o.isCamera));
    assert.ok(all.filter(o => o.isMesh).every(o => o.material.isMeshStandardMaterial && o.material.map === null));
    const first = manager.getPickObjects()[0]; const picks = manager.getPickObjects(); picks.length = 0; assert.equal(manager.getPickObjects()[0], first);
    bounds.makeEmpty(); assert.equal(manager.getBounds().isEmpty(), false);
  } finally { manager.dispose(); }
});

test('manager: holes are empty in triangulation and downward raycasts, for flat and extruded regions', () => {
  for (const height of [0, 3]) {
    const manager = new StaticMapManager(new THREE.Group());
    try {
      const map = mapOf([feature([polygon(rect(-5, -5, 5, 5), [rect(-2, -2, 2, 2)])], 'courtyard', height)], { width: 10 });
      manager.reconcile(map);
      const mesh = objects(manager.getPickObjects()[0]).find(o => o.isMesh);
      near(capArea(mesh, height), 84);
      const holeRay = new THREE.Raycaster(new THREE.Vector3(0, 20, 0), new THREE.Vector3(0, -1, 0));
      assert.equal(holeRay.intersectObject(mesh, false).length, 0, 'the courtyard must not have a hidden cap');
      const solidRay = new THREE.Raycaster(new THREE.Vector3(4, 20, 0), new THREE.Vector3(0, -1, 0));
      assert.ok(solidRay.intersectObject(mesh, false).length > 0);
      assert.ok(manager.diagnostics().triangleCount <= staticMapBudget(map).triangles);
    } finally { manager.dispose(); }
  }
});

test('manager: multiple holes, MultiPolygon and reversed winding stay within vertex-derived budgets', () => {
  const holes = Array.from({ length: 8 }, (_, i) => rect(1 + (i % 4) * 2, 1 + Math.floor(i / 4) * 4, 2 + (i % 4) * 2, 2 + Math.floor(i / 4) * 4));
  const map = mapOf([feature([polygon([...rect(0, 0, 10, 10)].reverse(), holes), polygon(rect(20, 0, 24, 4))])]);
  const manager = new StaticMapManager(new THREE.Group());
  try {
    manager.reconcile(map); const stats = manager.diagnostics(), budget = staticMapBudget(map);
    assert.equal(stats.meshCount, 4); assert.ok(stats.triangleCount <= budget.triangles);
    assert.equal(manager.getPickObjects().length, 1);
  } finally { manager.dispose(); }
});

test('manager: maximum feature count and a 4096-point map remain inside declared mesh/triangle budgets', () => {
  const manager = new StaticMapManager(new THREE.Group());
  try {
    const maximumFeatures = mapOf(Array.from({ length: 64 }, (_, i) => feature([polygon(rect((i % 8) * 3, Math.floor(i / 8) * 3, (i % 8) * 3 + 1, Math.floor(i / 8) * 3 + 1))], `f-${i}`)));
    manager.reconcile(maximumFeatures); assert.equal(manager.diagnostics().featureCount, 64);
    const dense = mapOf(Array.from({ length: 16 }, (_, i) => {
      const points = Array.from({ length: 255 }, (_, j) => [i * 3 + Math.cos(j * Math.PI * 2 / 255), Math.sin(j * Math.PI * 2 / 255)]);
      return feature([polygon([...points, [...points[0]]])], `dense-${i}`);
    }));
    manager.reconcile(dense);
    const budget = staticMapBudget(dense), stats = manager.diagnostics();
    assert.equal(stats.featureCount, 16); assert.equal(stats.meshCount, 32); assert.ok(stats.triangleCount <= budget.triangles);
    const size = manager.getBounds().getSize(new THREE.Vector3()); near(Math.max(size.x, size.z), dense.width);
  } finally { manager.dispose(); }
});

test('manager: centered wgs84 plane preserves projected aspect ratio and width, without geographic services', () => {
  const map = imported(collection(geoFeature([rect(119.999, 59.999, 120.001, 60.001)])), { ...options, coordinateSystem: 'wgs84' });
  const manager = new StaticMapManager(new THREE.Group());
  try {
    manager.reconcile(map); const size = manager.getBounds().getSize(new THREE.Vector3());
    near(size.z, 20); near(size.x, 10); near(size.y, 3);
  } finally { manager.dispose(); }
});

test('manager: world bounds honor parent + map transform and do not include or modify siblings', () => {
  const parent = new THREE.Group(); parent.position.set(7, 8, 9);
  const sibling = new THREE.Mesh(new THREE.BoxGeometry(1000, 1000, 1000), new THREE.MeshBasicMaterial()); parent.add(sibling);
  const siblingWatch = disposalWatch(sibling), manager = new StaticMapManager(parent);
  try {
    manager.reconcile(mapOf([feature(undefined, 'building', 2)], { width: 12, transform: { position: [3, 4, 5], rotation: [0, 90, 0], scale: [2, 3, 1] } }));
    const box = manager.getBounds(); near(box.min.x, 7); near(box.max.x, 13); near(box.min.y, 12); near(box.max.y, 18); near(box.min.z, 2); near(box.max.z, 26);
    assert.equal(sibling.parent, parent); assert.deepEqual(sibling.position.toArray(), [0, 0, 0]);
    manager.reconcile(null); assert.deepEqual(parent.children, [sibling]); siblingWatch(0);
  } finally { manager.dispose(); sibling.geometry.dispose(); sibling.material.dispose(); }
});

test('manager: unchanged canonical configuration retains geometry; input mutation does not alias live state', () => {
  const parent = new THREE.Group(), manager = new StaticMapManager(parent), input = mapOf();
  try {
    manager.reconcile(input); const root = parent.children[0], old = disposalWatch(root);
    manager.reconcile(clone(input)); assert.equal(parent.children[0], root); old(0);
    manager.reconcile(Object.fromEntries(Object.entries(input).reverse())); assert.equal(parent.children[0], root);
    input.features[0].height = 7; near(manager.getBounds().max.y, 3);
    manager.reconcile(input); assert.notEqual(parent.children[0], root); near(manager.getBounds().max.y, 7); old(1);
  } finally { manager.dispose(); }
});

test('manager: independent managers never share mutable geometry/materials, even under one parent', () => {
  const parent = new THREE.Group(), a = new StaticMapManager(parent), b = new StaticMapManager(parent);
  try {
    const map = mapOf(); a.reconcile(map); b.reconcile(map);
    const ar = parent.children[0], br = parent.children[1], am = objects(ar).find(o => o.isMesh), bm = objects(br).find(o => o.isMesh);
    assert.notEqual(am.geometry, bm.geometry); assert.notEqual(am.material, bm.material);
    const before = bm.material.color.getHexString(); am.material.color.set('#ff0000'); assert.equal(bm.material.color.getHexString(), before);
    const bWatch = disposalWatch(br); a.dispose(); assert.deepEqual(parent.children, [br]); bWatch(0); near(b.getBounds().max.y, 3);
  } finally { a.dispose(); b.dispose(); }
});

test('manager: invisible maps, null deletion, fresh recovery and idempotent disposal', () => {
  const parent = new THREE.Group(), manager = new StaticMapManager(parent), map = mapOf();
  assert.deepEqual(staticMapBudget(null), { instances: 0, meshes: 0, triangles: 0, animatedInstances: 0 });
  manager.reconcile({ ...map, visible: false }); assert.equal(manager.getBounds().isEmpty(), true); assert.deepEqual(manager.getPickObjects(), []);
  assert.equal(manager.diagnostics().featureCount, 1);
  const watch = disposalWatch(parent.children[0]); manager.reconcile(null); manager.reconcile(null); watch(1);
  assert.equal(parent.children.length, 0); assert.deepEqual(manager.diagnostics(), { featureCount: 0, meshCount: 0, triangleCount: 0 });
  manager.reconcile(map); const nextWatch = disposalWatch(parent.children[0]); manager.dispose(); manager.dispose(); nextWatch(1);
  assert.equal(parent.children.length, 0); assert.throws(() => manager.reconcile(map), /disposed/);
});

test('manager: invalid input fails before replacing or releasing the last valid map', () => {
  const parent = new THREE.Group(), manager = new StaticMapManager(parent);
  try {
    manager.reconcile(mapOf()); const old = parent.children[0], watch = disposalWatch(old), stats = manager.diagnostics();
    assert.throws(() => manager.reconcile(mapOf(undefined, { width: -1 })), /Invalid static map/);
    assert.equal(parent.children[0], old); watch(0); assert.deepEqual(manager.diagnostics(), stats);
    assert.throws(() => manager.reconcile(undefined), /Invalid static map/); assert.equal(parent.children[0], old);
  } finally { manager.dispose(); }
});

test('manager: injected mid-build failure releases all candidate resources and retains old map', () => {
  const parent = new THREE.Group(), manager = new StaticMapManager(parent);
  manager.reconcile(mapOf()); const old = parent.children[0], watch = disposalWatch(old), bounds = manager.getBounds();
  const sphere = THREE.BufferGeometry.prototype.computeBoundingSphere, gd = THREE.BufferGeometry.prototype.dispose, md = THREE.Material.prototype.dispose;
  const disposedGeometry = new Set(), disposedMaterial = new Set(); let calls = 0;
  THREE.BufferGeometry.prototype.computeBoundingSphere = function () { if (++calls === 3) throw new Error('injected geometry failure'); return sphere.call(this); };
  THREE.BufferGeometry.prototype.dispose = function () { disposedGeometry.add(this); return gd.call(this); };
  THREE.Material.prototype.dispose = function () { disposedMaterial.add(this); return md.call(this); };
  try {
    assert.throws(() => manager.reconcile(mapOf([feature(), feature([polygon(rect(20, 0, 24, 4))], 'new-building')])), /construction failed/);
    assert.deepEqual(parent.children, [old]); watch(0); assert.deepEqual(manager.getBounds(), bounds);
    assert.equal(disposedGeometry.size, 3); assert.equal(disposedMaterial.size, 3);
  } finally {
    THREE.BufferGeometry.prototype.computeBoundingSphere = sphere; THREE.BufferGeometry.prototype.dispose = gd; THREE.Material.prototype.dispose = md;
    manager.dispose();
  }
});

test('manager: failed parent attachment is rolled back even after the candidate was partially attached', () => {
  const parent = new THREE.Group(), manager = new StaticMapManager(parent);
  manager.reconcile(mapOf()); const old = parent.children[0], watch = disposalWatch(old), originalAdd = parent.add;
  let candidateWatch;
  parent.add = function (candidate) { candidateWatch = disposalWatch(candidate); originalAdd.call(this, candidate); throw new Error('injected attachment failure'); };
  try {
    assert.throws(() => manager.reconcile(mapOf(undefined, { label: 'changed' })), /Cannot attach/);
    assert.deepEqual(parent.children, [old]); watch(0); candidateWatch(1);
  } finally { parent.add = originalAdd; manager.dispose(); }
});

test('manager: small positive heights are not silently snapped to zero', () => {
  const manager = new StaticMapManager(new THREE.Group());
  try { manager.reconcile(mapOf([feature(undefined, 'tiny-height', 1e-8)])); assert.ok(manager.getBounds().max.y > 0); }
  finally { manager.dispose(); }
});
