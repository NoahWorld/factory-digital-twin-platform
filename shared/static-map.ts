/** Bounded, offline geometry declarations. No Three.js, I/O, scripts or source-object aliases. */
export type MapPoint = [number, number];
export type StaticMapPolygon = { outer: MapPoint[]; holes: MapPoint[][] };
export type StaticMapFeature = { id: string; label: string; height: number; color: string; polygons: StaticMapPolygon[] };
export type StaticMapDefinition = {
  version: 1; id: string; label: string; visible: boolean;
  coordinateSystem: 'local' | 'wgs84'; width: number; outlineColor: string;
  transform: { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] };
  features: StaticMapFeature[];
};
type ParseResult = { ok: true; value: StaticMapDefinition | null } | { ok: false; message: string };
type ImportOptions = {
  id: string; label: string; coordinateSystem: 'local' | 'wgs84'; width: number;
  defaultHeight: number; color: string; outlineColor: string;
};

export const STATIC_MAP_LIMITS = {
  maximumFeatures: 64, maximumPolygonsPerFeature: 16, maximumHolesPerPolygon: 8,
  minimumRingPoints: 4, maximumRingPoints: 257, maximumTotalPoints: 4096,
  maximumJsonBytes: 512 * 1024, maximumJsonDepth: 32, maximumJsonValues: 65_536,
  maximumIdLength: 120, maximumLabelLength: 80,
  maximumCoordinate: 10_000, maximumRotation: 3600, minimumScale: 0.001, maximumScale: 100,
  minimumWidth: 0.1, maximumWidth: 10_000, maximumHeight: 1000,
  maximumLongitude: 180, maximumLatitude: 85, maximumLongitudeSpan: 180,
  // A distance tolerance in the projected plane with longest extent = 1; shared by all topology checks.
  // This also avoids admitting features smaller than Float32 rendering precision at map scale.
  geometryEpsilon: 1e-7,
} as const;
const L = STATIC_MAP_LIMITS;
const EPS = L.geometryEpsilon;
const encoder = new TextEncoder();
function fail(message: string): never { throw new Error(message); }
const messageOf = (error: unknown): string => error instanceof Error ? error.message : 'Invalid static map input.';

/** Count JSON bytes iteratively, without invoking getters/toJSON or recursively walking arbitrary input. */
function checkJsonBudget(input: unknown): void {
  type Frame = { kind: 'value'; value: unknown; depth: number } | { kind: 'leave'; value: object };
  const stack: Frame[] = [{ kind: 'value', value: input, depth: 0 }];
  const ancestors = new Set<object>();
  let bytes = 0, values = 0;
  const add = (size: number) => {
    bytes += size;
    if (bytes > L.maximumJsonBytes) fail(`JSON exceeds ${L.maximumJsonBytes} UTF-8 bytes.`);
  };
  const stringBytes = (value: string) => {
    if (value.length > L.maximumJsonBytes) fail('JSON string exceeds the byte budget.');
    return encoder.encode(JSON.stringify(value)).byteLength;
  };
  while (stack.length) {
    const frame = stack.pop()!;
    if (frame.kind === 'leave') { ancestors.delete(frame.value); continue; }
    if (++values > L.maximumJsonValues) fail(`JSON exceeds ${L.maximumJsonValues} values.`);
    if (frame.depth > L.maximumJsonDepth) fail(`JSON nesting exceeds ${L.maximumJsonDepth}.`);
    const value = frame.value;
    if (value === null) { add(4); continue; }
    if (typeof value === 'string') { add(stringBytes(value)); continue; }
    if (typeof value === 'boolean') { add(value ? 4 : 5); continue; }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) fail('JSON numbers must be finite.');
      add(String(value).length); continue;
    }
    if (typeof value !== 'object') fail('JSON contains an undefined or non-serializable value.');
    const object = value as object;
    const array = Array.isArray(object);
    const prototype = Object.getPrototypeOf(object);
    if (!array && prototype !== Object.prototype && prototype !== null) fail('JSON requires plain objects.');
    if (ancestors.has(object)) fail('JSON contains a circular reference.');
    if (array && object.length > L.maximumJsonValues) fail('JSON array exceeds the value budget.');
    const keys = Reflect.ownKeys(object);
    if (keys.some(key => typeof key !== 'string')) fail('JSON symbol keys are not supported.');
    if (keys.length > L.maximumJsonValues + 1) fail('JSON object exceeds the value budget.');
    const count = array ? object.length : keys.length;
    if (array && keys.length !== count + 1) fail('JSON arrays must be dense and have no named properties.');
    add(2 + Math.max(0, count - 1)); // Brackets/braces and commas.
    ancestors.add(object);
    stack.push({ kind: 'leave', value: object });
    for (let i = count - 1; i >= 0; i--) {
      const key = array ? String(i) : keys[i] as string;
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
        fail('JSON properties must be enumerable data values, not accessors or sparse entries.');
      if (!array) add(stringBytes(key) + 1);
      stack.push({ kind: 'value', value: descriptor.value, depth: frame.depth + 1 });
    }
  }
}

function readInput(input: unknown): unknown {
  let value = input;
  if (typeof input === 'string') {
    if (input.length > L.maximumJsonBytes || encoder.encode(input).byteLength > L.maximumJsonBytes)
      fail(`JSON exceeds ${L.maximumJsonBytes} UTF-8 bytes before parsing.`);
    try { value = JSON.parse(input) as unknown; }
    catch { fail('Input is not valid JSON.'); }
  }
  checkJsonBudget(value);
  return value;
}

function object(value: unknown, at: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${at} must be an object.`);
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: readonly string[], at: string): void {
  if (Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key)))
    fail(`${at} has missing or unknown fields; expected ${keys.join(', ')}.`);
}
function number(value: unknown, low: number, high: number, at: string, exclusiveLow = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value > high || (exclusiveLow ? value <= low : value < low))
    fail(`${at} must be a finite number ${exclusiveLow ? '>' : '>='} ${low} and <= ${high}.`);
  return value as number;
}
function id(value: unknown, at: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}(?![\s\S])/.test(value))
    fail(`${at} must be a stable 1..${L.maximumIdLength} character identifier.`);
  return value as string;
}
function label(value: unknown, at: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > L.maximumLabelLength || /[\u0000-\u001f\u007f-\u009f]/.test(value))
    fail(`${at} must contain 1..${L.maximumLabelLength} printable characters.`);
  return value as string;
}
function color(value: unknown, at: string): string {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}(?![\s\S])/.test(value)) fail(`${at} requires a six-digit HEX color.`);
  return value as string;
}
function coordinates(value: unknown): 'local' | 'wgs84' {
  if (value !== 'local' && value !== 'wgs84') fail('coordinateSystem must be local or wgs84.');
  return value as 'local' | 'wgs84';
}
function vector(value: unknown, low: number, high: number, at: string, exclusiveLow = false): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) fail(`${at} requires exactly three numbers.`);
  const entries = value as unknown[];
  return [0, 1, 2].map(i => number(entries[i], low, high, `${at}[${i}]`, exclusiveLow)) as [number, number, number];
}
function array(value: unknown, min: number, max: number, at: string): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(`${at} requires ${min}..${max} entries.`);
  return value as unknown[];
}
function ringSize(value: unknown, count: { points: number }, at: string): unknown[] {
  const ring = array(value, L.minimumRingPoints, L.maximumRingPoints, at);
  count.points += ring.length;
  if (count.points > L.maximumTotalPoints) fail(`Map exceeds ${L.maximumTotalPoints} total ring points (including closure).`);
  return ring;
}

type Ring = { points: MapPoint[]; area: number; hole: boolean; bounds: [number, number, number, number] };
type Polygon = { outer: Ring; holes: Ring[] };
const same = (a: MapPoint, b: MapPoint) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= EPS;
const cross = (a: MapPoint, b: MapPoint, c: MapPoint) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function side(a: MapPoint, b: MapPoint, c: MapPoint): number {
  const distance = cross(a, b, c) / Math.hypot(b[0] - a[0], b[1] - a[1]);
  return distance > EPS ? 1 : distance < -EPS ? -1 : 0;
}
function onSegment(p: MapPoint, a: MapPoint, b: MapPoint): boolean {
  return side(a, b, p) === 0 && p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS
    && p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS;
}
function properCross(a: MapPoint, b: MapPoint, c: MapPoint, d: MapPoint): boolean {
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}
function segmentsMeet(a: MapPoint, b: MapPoint, c: MapPoint, d: MapPoint): boolean {
  if (Math.max(a[0], b[0]) + EPS < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) + EPS < Math.min(a[0], b[0])
    || Math.max(a[1], b[1]) + EPS < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) + EPS < Math.min(a[1], b[1])) return false;
  return properCross(a, b, c, d) || onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b);
}
function boundsMeet(a: Ring, b: Ring): boolean {
  return a.bounds[0] <= b.bounds[2] + EPS && b.bounds[0] <= a.bounds[2] + EPS
    && a.bounds[1] <= b.bounds[3] + EPS && b.bounds[1] <= a.bounds[3] + EPS;
}
function ringsMeet(a: Ring, b: Ring): boolean {
  if (!boundsMeet(a, b)) return false;
  for (let i = 0; i < a.points.length; i++) for (let j = 0; j < b.points.length; j++)
    if (segmentsMeet(a.points[i], a.points[(i + 1) % a.points.length], b.points[j], b.points[(j + 1) % b.points.length])) return true;
  return false;
}
/** -1 outside, 0 boundary, 1 inside. Winding-independent. */
function inRing(p: MapPoint, ring: Ring): number {
  let inside = false;
  for (let i = 0; i < ring.points.length; i++) {
    const a = ring.points[i], b = ring.points[(i + 1) % ring.points.length];
    if (onSegment(p, a, b)) return 0;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) inside = !inside;
  }
  return inside ? 1 : -1;
}
function inPolygon(p: MapPoint, polygon: Polygon): number {
  const outer = inRing(p, polygon.outer);
  if (outer !== 1) return outer;
  for (const hole of polygon.holes) { const inside = inRing(p, hole); if (inside === 0) return 0; if (inside === 1) return -1; }
  return 1;
}
function validRing(points: MapPoint[], hole: boolean, at: string): Ring {
  let area = 0, perimeter = 0;
  const bounds: Ring['bounds'] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], previous = points[(i + points.length - 1) % points.length];
    if (same(a, b)) fail(`${at} has duplicate/too-close adjacent points.`);
    if (side(previous, a, b) === 0 && (previous[0] - a[0]) * (b[0] - a[0]) + (previous[1] - a[1]) * (b[1] - a[1]) > 0)
      fail(`${at} backtracks along an adjacent edge.`);
    area += cross(points[0], a, b) / 2;
    perimeter += Math.hypot(b[0] - a[0], b[1] - a[1]);
    bounds[0] = Math.min(bounds[0], a[0]); bounds[1] = Math.min(bounds[1], a[1]);
    bounds[2] = Math.max(bounds[2], a[0]); bounds[3] = Math.max(bounds[3], a[1]);
  }
  if (Math.abs(area) <= EPS * perimeter) fail(`${at} is degenerate at the map geometry tolerance.`);
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
    if (segmentsMeet(points[i], points[(i + 1) % points.length], points[j], points[(j + 1) % points.length]))
      fail(`${at} self-intersects or touches itself.`);
  }
  return { points, area, hole, bounds };
}

const TAU = Math.PI * 2;
const positiveAngle = (angle: number) => ((angle % TAU) + TAU) % TAU;
/** Local filled angular sector at a boundary contact, including concave vertices and hole boundaries. */
function filledArc(ring: Ring, edge: number, p: MapPoint): [number, number] {
  const n = ring.points.length, a = ring.points[edge], b = ring.points[(edge + 1) % n];
  let previous = a, next = b;
  if (same(p, a)) { previous = ring.points[(edge + n - 1) % n]; next = b; }
  else if (same(p, b)) { previous = a; next = ring.points[(edge + 2) % n]; }
  const prevAngle = Math.atan2(previous[1] - p[1], previous[0] - p[0]);
  const nextAngle = Math.atan2(next[1] - p[1], next[0] - p[0]);
  const filledLeft = (ring.area > 0) !== ring.hole;
  const start = positiveAngle(filledLeft ? nextAngle : prevAngle);
  return [start, start + positiveAngle((filledLeft ? prevAngle : nextAngle) - start)];
}
function arcsOverlap(a: [number, number], b: [number, number]): boolean {
  for (const offset of [-TAU, 0, TAU])
    if (Math.min(a[1], b[1] + offset) - Math.max(a[0], b[0] + offset) > EPS) return true;
  return false;
}
/** Touching polygons are allowed when their filled interiors are disjoint; nesting inside a hole is allowed. */
function polygonsOverlap(a: Polygon, b: Polygon): boolean {
  if (!boundsMeet(a.outer, b.outer)) return false;
  for (const ar of [a.outer, ...a.holes]) for (const br of [b.outer, ...b.holes]) {
    if (!boundsMeet(ar, br)) continue;
    for (let i = 0; i < ar.points.length; i++) for (let j = 0; j < br.points.length; j++) {
      const a0 = ar.points[i], a1 = ar.points[(i + 1) % ar.points.length];
      const b0 = br.points[j], b1 = br.points[(j + 1) % br.points.length];
      if (!segmentsMeet(a0, a1, b0, b1)) continue;
      if (properCross(a0, a1, b0, b1)) return true;
      for (const p of [a0, a1, b0, b1]) if (onSegment(p, a0, a1) && onSegment(p, b0, b1)
        && arcsOverlap(filledArc(ar, i, p), filledArc(br, j, p))) return true;
    }
  }
  return inPolygon(a.outer.points[0], b) === 1 || inPolygon(b.outer.points[0], a) === 1;
}

function validateGeometry(map: StaticMapDefinition): void {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const feature of map.features) for (const polygon of feature.polygons) for (const ring of [polygon.outer, ...polygon.holes]) for (const p of ring) {
    minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]);
  }
  if (map.coordinateSystem === 'wgs84' && maxX - minX > L.maximumLongitudeSpan) fail('wgs84 longitude span exceeds 180 degrees (date-line crossing is unsupported).');
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  // Centered equirectangular plane. The common metres-per-degree factor cancels when normalizing to width.
  const longitudeScale = map.coordinateSystem === 'wgs84' ? Math.cos(cy * Math.PI / 180) : 1;
  const extent = Math.max((maxX - minX) * longitudeScale, maxY - minY);
  if (!(extent > 0)) fail('Map has zero planar extent.');
  for (let f = 0; f < map.features.length; f++) {
    const normalized: Polygon[] = [];
    for (let p = 0; p < map.features[f].polygons.length; p++) {
      const source = map.features[f].polygons[p], at = `features[${f}].polygons[${p}]`;
      const normalize = (ring: MapPoint[], hole: boolean, path: string) => validRing(
        ring.slice(0, -1).map(point => [(point[0] - cx) * longitudeScale / extent, (point[1] - cy) / extent] as MapPoint), hole, path);
      const outer = normalize(source.outer, false, `${at}.outer`);
      const holes = source.holes.map((ring, i) => normalize(ring, true, `${at}.holes[${i}]`));
      for (let h = 0; h < holes.length; h++) {
        if (ringsMeet(outer, holes[h]) || inRing(holes[h].points[0], outer) !== 1) fail(`${at}.holes[${h}] must lie strictly inside outer without touching.`);
        for (let j = 0; j < h; j++) if (ringsMeet(holes[h], holes[j]) || inRing(holes[h].points[0], holes[j]) !== -1 || inRing(holes[j].points[0], holes[h]) !== -1)
          fail(`${at}.holes overlap, nest or touch.`);
      }
      const polygon = { outer, holes };
      if (normalized.some(other => polygonsOverlap(polygon, other))) fail(`${at} overlaps another polygon in the same feature.`);
      normalized.push(polygon);
    }
  }
}

function parseDefinition(input: unknown): StaticMapDefinition | null {
  if (input === null) return null;
  const raw = object(input, 'staticMap');
  exact(raw, ['version', 'id', 'label', 'visible', 'coordinateSystem', 'width', 'outlineColor', 'transform', 'features'], 'staticMap');
  if (raw.version !== 1 || typeof raw.visible !== 'boolean') fail('staticMap.version must be 1 and visible must be boolean.');
  const system = coordinates(raw.coordinateSystem), transform = object(raw.transform, 'transform');
  exact(transform, ['position', 'rotation', 'scale'], 'transform');
  const map: StaticMapDefinition = {
    version: 1, id: id(raw.id, 'id'), label: label(raw.label, 'label'), visible: raw.visible as boolean,
    coordinateSystem: system, width: number(raw.width, L.minimumWidth, L.maximumWidth, 'width'), outlineColor: color(raw.outlineColor, 'outlineColor'),
    transform: {
      position: vector(transform.position, -L.maximumCoordinate, L.maximumCoordinate, 'transform.position'),
      rotation: vector(transform.rotation, -L.maximumRotation, L.maximumRotation, 'transform.rotation'),
      scale: vector(transform.scale, L.minimumScale, L.maximumScale, 'transform.scale', true),
    }, features: [],
  };
  const features = array(raw.features, 1, L.maximumFeatures, 'features'), seen = new Set<string>(), count = { points: 0 };
  const readRing = (inputRing: unknown, at: string): MapPoint[] => {
    const entries = ringSize(inputRing, count, at);
    const points = entries.map((point, i): MapPoint => {
      const tuple = array(point, 2, 2, `${at}[${i}]`);
      return [number(tuple[0], system === 'local' ? -L.maximumCoordinate : -L.maximumLongitude, system === 'local' ? L.maximumCoordinate : L.maximumLongitude, `${at}[${i}][0]`),
        number(tuple[1], system === 'local' ? -L.maximumCoordinate : -L.maximumLatitude, system === 'local' ? L.maximumCoordinate : L.maximumLatitude, `${at}[${i}][1]`)];
    });
    const first = points[0], last = points[points.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) fail(`${at} must be explicitly and exactly closed.`);
    return points;
  };
  // All structure/count/coordinate checks complete before any quadratic topology operations.
  for (let i = 0; i < features.length; i++) {
    const rawFeature = object(features[i], `features[${i}]`);
    exact(rawFeature, ['id', 'label', 'height', 'color', 'polygons'], `features[${i}]`);
    const featureId = id(rawFeature.id, `features[${i}].id`);
    if (seen.has(featureId)) fail(`Duplicate feature id: ${featureId}.`);
    seen.add(featureId);
    const feature: StaticMapFeature = { id: featureId, label: label(rawFeature.label, `features[${i}].label`),
      height: number(rawFeature.height, 0, L.maximumHeight, `features[${i}].height`), color: color(rawFeature.color, `features[${i}].color`), polygons: [] };
    const polygons = array(rawFeature.polygons, 1, L.maximumPolygonsPerFeature, `features[${i}].polygons`);
    for (let p = 0; p < polygons.length; p++) {
      const at = `features[${i}].polygons[${p}]`, polygon = object(polygons[p], at);
      exact(polygon, ['outer', 'holes'], at);
      const holes = array(polygon.holes, 0, L.maximumHolesPerPolygon, `${at}.holes`);
      feature.polygons.push({ outer: readRing(polygon.outer, `${at}.outer`), holes: holes.map((ring, h) => readRing(ring, `${at}.holes[${h}]`)) });
    }
    map.features.push(feature);
  }
  validateGeometry(map);
  return map;
}

export function parseStaticMap(input: unknown): ParseResult {
  try { return { ok: true, value: parseDefinition(readInput(input)) }; }
  catch (error) { return { ok: false, message: messageOf(error) }; }
}

export function importGeoJson(input: unknown, options: ImportOptions): ParseResult {
  try {
    const source = object(readInput(input), 'GeoJSON');
    checkJsonBudget(options);
    const opt = object(options, 'options');
    exact(opt, ['id', 'label', 'coordinateSystem', 'width', 'defaultHeight', 'color', 'outlineColor'], 'options');
    const mapId = id(opt.id, 'options.id'), mapLabel = label(opt.label, 'options.label');
    const system = coordinates(opt.coordinateSystem), width = number(opt.width, L.minimumWidth, L.maximumWidth, 'options.width');
    const height = number(opt.defaultHeight, 0, L.maximumHeight, 'options.defaultHeight');
    const fill = color(opt.color, 'options.color'), outline = color(opt.outlineColor, 'options.outlineColor');
    if (source.type !== 'FeatureCollection') fail('GeoJSON.type must be FeatureCollection.');
    const entries = array(source.features, 1, L.maximumFeatures, 'GeoJSON.features'), count = { points: 0 };
    const features = entries.map((entry, index) => {
      const at = `GeoJSON.features[${index}]`, feature = object(entry, at);
      if (feature.type !== 'Feature') fail(`${at}.type must be Feature.`);
      const properties = feature.properties === null || !Object.hasOwn(feature, 'properties') ? {} : object(feature.properties, `${at}.properties`);
      const featureId = Object.hasOwn(feature, 'id') ? id(feature.id, `${at}.id`)
        : Object.hasOwn(properties, 'id') ? id(properties.id, `${at}.properties.id`) : `geo-${index + 1}`;
      const geometry = object(feature.geometry, `${at}.geometry`);
      if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') fail(`${at}.geometry.type must be Polygon or MultiPolygon; unsupported geometries are not discarded.`);
      const polygonInputs = geometry.type === 'Polygon' ? [geometry.coordinates]
        : array(geometry.coordinates, 1, L.maximumPolygonsPerFeature, `${at}.geometry.coordinates`);
      const polygons = polygonInputs.map((inputPolygon, p) => {
        const rings = array(inputPolygon, 1, L.maximumHolesPerPolygon + 1, `${at}.polygons[${p}]`);
        rings.forEach((ring, r) => ringSize(ring, count, `${at}.polygons[${p}].rings[${r}]`));
        return { outer: rings[0], holes: rings.slice(1) };
      });
      return { id: featureId, label: Object.hasOwn(properties, 'name') ? label(properties.name, `${at}.properties.name`) : `区域 ${index + 1}`,
        height: Object.hasOwn(properties, 'height') ? number(properties.height, 0, L.maximumHeight, `${at}.properties.height`) : height,
        color: Object.hasOwn(properties, 'color') ? color(properties.color, `${at}.properties.color`) : fill, polygons };
    });
    // Only the explicit allowlist is copied. bbox/CRS/links/URLs and all other source metadata are inert and not retained.
    return parseStaticMap({ version: 1, id: mapId, label: mapLabel, visible: true, coordinateSystem: system, width, outlineColor: outline,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, features });
  } catch (error) { return { ok: false, message: messageOf(error) }; }
}

/** Upper bounds for steps=1, bevel=false extrusion plus one LineSegments object per polygon. */
export function staticMapBudget(map: StaticMapDefinition | null): { instances: number; meshes: number; triangles: number; animatedInstances: number } {
  if (map === null) return { instances: 0, meshes: 0, triangles: 0, animatedInstances: 0 };
  let meshes = 0, triangles = 0;
  for (const feature of map.features) for (const polygon of feature.polygons) {
    const vertices = polygon.outer.length - 1 + polygon.holes.reduce((n, ring) => n + ring.length - 1, 0);
    const cap = vertices + 2 * polygon.holes.length - 2;
    meshes += 2;
    triangles += feature.height > 0 ? cap * 2 + vertices * 2 : cap;
  }
  return { instances: map.features.length, meshes, triangles, animatedInstances: 0 };
}

/** Entirely fictional local site: two buildings and a courtyard with a genuine opening. */
export const STATIC_MAP_EXAMPLE = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', id: 'demo-building-a', properties: { name: '虚构场区 A 楼', height: 6, color: '#658fad' },
      geometry: { type: 'Polygon', coordinates: [[[-12, -3], [-4, -3], [-4, 4], [-12, 4], [-12, -3]]] } },
    { type: 'Feature', id: 'demo-building-b', properties: { name: '虚构场区 B 楼', height: 9, color: '#b18c68' },
      geometry: { type: 'Polygon', coordinates: [[[3, 0], [11, 0], [11, 6], [3, 6], [3, 0]]] } },
    { type: 'Feature', id: 'demo-courtyard', properties: { name: '虚构环形展馆', height: 3, color: '#6c9a83' },
      geometry: { type: 'Polygon', coordinates: [[[-3, -11], [6, -11], [6, -5], [-3, -5], [-3, -11]], [[-1, -9], [-1, -7], [4, -7], [4, -9], [-1, -9]]] } },
  ],
} as const;
