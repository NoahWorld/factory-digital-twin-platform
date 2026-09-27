import * as THREE from 'three';
import { parseStaticMap, staticMapBudget, type MapPoint, type StaticMapDefinition, type StaticMapPolygon } from '../../../../shared/static-map';

type MapRecord = {
  root: THREE.Group; signature: string; features: THREE.Group[];
  geometries: Set<THREE.BufferGeometry>; materials: Set<THREE.Material>;
  meshCount: number; triangleCount: number;
};

function release(record: MapRecord): void {
  record.root.removeFromParent();
  record.geometries.forEach(geometry => geometry.dispose());
  record.materials.forEach(material => material.dispose());
  record.geometries.clear(); record.materials.clear();
}

/** Same centered equirectangular plane and aspect normalization used by the shared topology validator. */
function plane(map: StaticMapDefinition): (point: MapPoint) => MapPoint {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const feature of map.features) for (const polygon of feature.polygons) for (const ring of [polygon.outer, ...polygon.holes]) for (const p of ring) {
    minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]);
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const longitudeScale = map.coordinateSystem === 'wgs84' ? Math.cos(cy * Math.PI / 180) : 1;
  const extent = Math.max((maxX - minX) * longitudeScale, maxY - minY);
  if (!(extent > 0) || !Number.isFinite(extent)) throw new Error('Static map has an invalid planar extent.');
  return point => [(point[0] - cx) * longitudeScale / extent * map.width, (point[1] - cy) / extent * map.width];
}

function shapeOf(polygon: StaticMapPolygon, project: (point: MapPoint) => MapPoint): THREE.Shape {
  const draw = (path: THREE.Path, ring: MapPoint[]) => {
    ring.slice(0, -1).forEach((point, i) => {
      const [x, z] = project(point);
      // Shape XY -> scene XZ via a fixed -PI/2 basis rotation; extrusion Z becomes scene +Y.
      if (i === 0) path.moveTo(x, -z); else path.lineTo(x, -z);
    });
    path.closePath();
  };
  const shape = new THREE.Shape();
  draw(shape, polygon.outer);
  for (const ring of polygon.holes) { const hole = new THREE.Path(); draw(hole, ring); shape.holes.push(hole); }
  return shape;
}

function build(map: StaticMapDefinition, signature: string): MapRecord {
  const record: MapRecord = { root: new THREE.Group(), signature, features: [], geometries: new Set(), materials: new Set(), meshCount: 0, triangleCount: 0 };
  const ownGeometry = <T extends THREE.BufferGeometry>(geometry: T): T => { record.geometries.add(geometry); return geometry; };
  const ownMaterial = <T extends THREE.Material>(material: T): T => { record.materials.add(material); return material; };
  try {
    const project = plane(map);
    record.root.name = map.label; record.root.userData.staticMapId = map.id; record.root.visible = map.visible;
    const outline = ownMaterial(new THREE.LineBasicMaterial({ color: map.outlineColor, linewidth: 1 }));
    for (const feature of map.features) {
      const group = new THREE.Group(); group.name = feature.label;
      group.userData.staticMapId = map.id; group.userData.staticMapFeatureId = feature.id;
      record.root.add(group); record.features.push(group);
      const material = ownMaterial(new THREE.MeshStandardMaterial({ color: feature.color, roughness: 0.82, metalness: 0.02, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
      for (let index = 0; index < feature.polygons.length; index++) {
        const polygon = feature.polygons[index], shape = shapeOf(polygon, project);
        const geometry = ownGeometry(feature.height > 0
          ? new THREE.ExtrudeGeometry(shape, { depth: feature.height, steps: 1, bevelEnabled: false, curveSegments: 1 })
          : new THREE.ShapeGeometry(shape, 1));
        // Exact axis permutation, rather than a trigonometric rotation or snapping small heights to zero.
        geometry.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1));
        const position = geometry.getAttribute('position');
        for (let v = 0; v < position.count; v++) {
          if (![position.getX(v), position.getY(v), position.getZ(v)].every(Number.isFinite)) throw new Error('Generated map geometry is non-finite.');
        }
        position.needsUpdate = true;
        geometry.computeBoundingBox(); geometry.computeBoundingSphere();
        const triangleCount = (geometry.index?.count ?? position.count) / 3;
        if (!Number.isInteger(triangleCount) || triangleCount === 0) throw new Error('Map polygon could not be triangulated.');
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `${feature.id}:polygon-${index + 1}`;
        mesh.userData.staticMapId = map.id; mesh.userData.staticMapFeatureId = feature.id;
        mesh.castShadow = feature.height > 0; mesh.receiveShadow = true;
        group.add(mesh); record.meshCount++; record.triangleCount += triangleCount;

        // Explicit boundary segments include every hole, but never cap triangulation diagonals.
        const segments: number[] = [];
        for (const ring of [polygon.outer, ...polygon.holes]) for (let p = 0; p < ring.length - 1; p++) {
          const a = project(ring[p]), b = project(ring[p + 1]);
          segments.push(a[0], feature.height, a[1], b[0], feature.height, b[1]);
          if (feature.height > 0) {
            segments.push(a[0], 0, a[1], b[0], 0, b[1]);
            segments.push(a[0], 0, a[1], a[0], feature.height, a[1]);
          }
        }
        const edgeGeometry = ownGeometry(new THREE.BufferGeometry());
        edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
        edgeGeometry.computeBoundingBox(); edgeGeometry.computeBoundingSphere();
        const edges = new THREE.LineSegments(edgeGeometry, outline);
        edges.name = `${feature.id}:boundary-${index + 1}`;
        edges.userData.staticMapId = map.id; edges.userData.staticMapFeatureId = feature.id;
        group.add(edges); record.meshCount++;
      }
    }
    const budget = staticMapBudget(map);
    if (record.meshCount > budget.meshes || record.triangleCount > budget.triangles) throw new Error('Generated map exceeds its shared geometry budget.');
    record.root.position.set(...map.transform.position);
    record.root.rotation.set(...map.transform.rotation.map(THREE.MathUtils.degToRad) as [number, number, number], 'XYZ');
    record.root.scale.set(...map.transform.scale);
    record.root.updateMatrixWorld(true);
    return record;
  } catch (error) {
    release(record);
    throw new Error(`Static map ${map.id} construction failed.`, { cause: error });
  }
}

/** Owns only its map root and resources. Does not create a renderer, animation loop, timer, light or texture. */
export class StaticMapManager {
  private current: MapRecord | null = null;
  private disposed = false;
  constructor(private readonly parent: THREE.Group) {}

  private active(): void { if (this.disposed) throw new Error('Static map manager is disposed.'); }

  reconcile(map: StaticMapDefinition | null): void {
    this.active();
    const parsed = parseStaticMap(map);
    if (!parsed.ok) throw new Error(`Invalid static map: ${parsed.message}`);
    if (parsed.value === null) { const previous = this.current; this.current = null; if (previous) release(previous); return; }
    const signature = JSON.stringify(parsed.value);
    if (this.current?.signature === signature) return;
    const candidate = build(parsed.value, signature);
    try { this.parent.add(candidate.root); }
    catch (error) { release(candidate); throw new Error('Cannot attach static map candidate.', { cause: error }); }
    const previous = this.current;
    this.current = candidate;
    if (previous) release(previous);
  }

  /** World-space bounds for the visible map only; parent siblings never contribute. */
  getBounds(): THREE.Box3 {
    this.active();
    if (!this.current?.root.visible) return new THREE.Box3();
    this.current.root.updateWorldMatrix(true, true);
    return new THREE.Box3().setFromObject(this.current.root);
  }

  diagnostics(): { featureCount: number; meshCount: number; triangleCount: number } {
    this.active();
    return { featureCount: this.current?.features.length ?? 0, meshCount: this.current?.meshCount ?? 0, triangleCount: this.current?.triangleCount ?? 0 };
  }

  getPickObjects(): THREE.Object3D[] {
    this.active();
    return this.current?.root.visible ? [...this.current.features] : [];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const previous = this.current; this.current = null;
    if (previous) release(previous);
  }
}
