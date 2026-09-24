import * as THREE from "three";
import { parseFluids, type FluidDefinition } from "../../../../shared/fluids";

const TAU = Math.PI * 2;
const MAX_PARTICLES = 256;
const surfaceVertex = /* glsl */ `
varying vec2 vFlowUv;
varying vec3 vViewNormal;
varying vec3 vViewPosition;
void main() {
  vFlowUv = uv;
  vViewNormal = normalize(normalMatrix * normal);
  vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPosition = viewPosition.xyz;
  gl_Position = projectionMatrix * viewPosition;
}`;
const surfaceFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uPhase;
uniform float uDirection;
uniform float uBands;
uniform float uMolten;
varying vec2 vFlowUv;
varying vec3 vViewNormal;
varying vec3 vViewPosition;
void main() {
  float flow = (vFlowUv.x - uDirection * uPhase) * uBands * 6.2831853;
  float around = vFlowUv.y * 6.2831853;
  float ripple = sin(flow + sin(around * 3.0) * 0.8);
  float narrow = pow(0.5 + 0.5 * ripple, 12.0);
  vec3 normal = normalize(vViewNormal);
  float facing = abs(dot(normal, normalize(-vViewPosition)));
  float rim = pow(1.0 - facing, 3.0);
  float light = 0.55 + 0.45 * abs(dot(normal, normalize(vec3(0.4, 0.8, 0.6))));
  vec3 liquid = uColor * (light + 0.25 * ripple) + vec3(0.65, 0.8, 0.9) * (narrow * 0.5 + rim * 0.4);
  float crust = smoothstep(-0.35, 0.65, sin(flow * 2.0 + sin(around * 5.0)) * sin(around * 4.0 + flow));
  vec3 molten = mix(uColor * 0.18, uColor * 1.9, crust) + mix(uColor, vec3(1.0), 0.45) * narrow * 0.85;
  gl_FragColor = vec4(mix(liquid, molten, uMolten), uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const particleVertex = /* glsl */ `
attribute vec3 aCenter;
attribute float aSize;
attribute float aFade;
attribute float aSeed;
varying vec2 vParticleUv;
varying float vFade;
varying float vSeed;
void main() {
  vParticleUv = uv;
  vFade = aFade;
  vSeed = aSeed;
  vec4 center = modelViewMatrix * vec4(aCenter, 1.0);
  // World-sized camera-facing quads, also respecting the shared scene scale.
  float scale = max(length(modelMatrix[0].xyz), max(length(modelMatrix[1].xyz), length(modelMatrix[2].xyz)));
  center.xy += position.xy * aSize * scale;
  gl_Position = projectionMatrix * center;
}`;
const particleFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uKind;
varying vec2 vParticleUv;
varying float vFade;
varying float vSeed;
void main() {
  vec2 p = vParticleUv * 2.0 - 1.0;
  float radius = length(p);
  if (radius >= 1.0 || vFade <= 0.0) discard;
  float alpha;
  vec3 color;
  if (uKind < 0.5) {
    float cloud = 0.78 + 0.22 * sin(p.x * 8.0 + vSeed * 18.0) * sin(p.y * 7.0 + vSeed * 23.0);
    alpha = pow(1.0 - radius * radius, 2.0) * cloud * 0.32;
    color = uColor * (0.8 + 0.25 * cloud);
  } else if (uKind < 1.5) {
    alpha = (1.0 - smoothstep(0.7, 1.0, radius)) * 0.75;
    float highlight = pow(max(0.0, 1.0 - length(p - vec2(-0.25, 0.25))), 8.0);
    color = uColor * (0.7 + 0.35 * (1.0 - radius)) + vec3(highlight * 0.85);
  } else {
    alpha = pow(1.0 - radius, 1.4);
    color = uColor * 1.8 + mix(uColor, vec3(1.0), 0.55) * pow(1.0 - radius, 5.0);
  }
  gl_FragColor = vec4(color, alpha * vFade * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

type FluidRecord = {
  definition: FluidDefinition;
  signature: string;
  group: THREE.Group;
  pathBounds: THREE.Box3;
  localBounds: THREE.Box3;
  curve: THREE.CatmullRomCurve3;
  length: number;
  samples: THREE.Vector3[];
  normals: THREE.Vector3[];
  binormals: THREE.Vector3[];
  surface: THREE.ShaderMaterial | null;
  particles: THREE.ShaderMaterial;
  particleGeometry: THREE.InstancedBufferGeometry;
  centers: THREE.InstancedBufferAttribute;
  sizes: THREE.InstancedBufferAttribute;
  fades: THREE.InstancedBufferAttribute;
  seeds: Float32Array;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  phase: number;
};

const shapeSignature = (fluid: FluidDefinition) => JSON.stringify([fluid.kind, fluid.mode, fluid.points, fluid.radius, fluid.spread, fluid.direction]);
const hashSeed = (index: number, salt: number) => {
  let value = Math.imul(index + 1, 374761393) ^ salt;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
};
const smoothstep = (minimum: number, maximum: number, value: number) => {
  const t = THREE.MathUtils.clamp((value - minimum) / (maximum - minimum), 0, 1);
  return t * t * (3 - 2 * t);
};
const envelopeRadius = (fluid: FluidDefinition, age: number) => fluid.radius * (1 + (fluid.mode === "diffuse" ? fluid.spread * age : 0));

function disposeRecord(record: FluidRecord) {
  record.group.removeFromParent();
  record.geometries.forEach((geometry) => geometry.dispose());
  record.materials.forEach((material) => material.dispose());
}

function createRecord(definition: FluidDefinition): FluidRecord {
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  try {
    // Keep curve arithmetic and Float32 GPU attributes close to their own origin.
    // A tiny path around a large scene coordinate otherwise loses its tangents
    // in subtraction, and separate tube rings collapse to the same GPU position.
    const origin = new THREE.Vector3(...definition.points[0]);
    const curve = new THREE.CatmullRomCurve3(definition.points.map((point) => new THREE.Vector3(...point).sub(origin)), false, "centripetal");
    const segments = THREE.MathUtils.clamp((definition.points.length - 1) * 24, 48, 768);
    curve.arcLengthDivisions = segments * 4;
    const length = curve.getLength();
    if (!Number.isFinite(length) || length <= 0) throw new Error("路径数值长度必须是正的有限值");
    const samples = curve.getSpacedPoints(segments);
    const frames = curve.computeFrenetFrames(segments, false);
    const group = new THREE.Group();
    group.position.copy(origin);
    group.userData.fluidId = definition.id;
    const pathBounds = new THREE.Box3().setFromPoints(samples);
    const localBounds = pathBounds.clone();
    // Includes lateral drift AND the full world-sized billboard diagonal at every age.
    localBounds.expandByScalar(envelopeRadius(definition, 1) * 2);
    let surface: THREE.ShaderMaterial | null = null;
    if (definition.kind !== "gas" && definition.mode === "stream") {
      const geometry = new THREE.TubeGeometry(curve, segments, definition.radius, 10, false);
      geometries.push(geometry);
      surface = new THREE.ShaderMaterial({
        vertexShader: surfaceVertex, fragmentShader: surfaceFragment,
        uniforms: {
          uColor: { value: new THREE.Color(definition.color) }, uOpacity: { value: definition.opacity },
          uPhase: { value: 0 }, uDirection: { value: definition.direction === "forward" ? 1 : -1 },
          uBands: { value: THREE.MathUtils.clamp(Math.round(length / definition.radius / 4), 4, 96) },
          uMolten: { value: definition.kind === "molten" ? 1 : 0 },
        },
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });
      materials.push(surface);
      const mesh = new THREE.Mesh(geometry, surface);
      mesh.name = "fluid-surface";
      group.add(mesh);
    }

    // Shader-moved quads cannot use Mesh.raycast. An undrawn tapering tube supplies
    // reliable world-space hits; the caller still sorts it against model occluders.
    const pickGeometry = new THREE.TubeGeometry(curve, segments, 1, 8, false);
    geometries.push(pickGeometry);
    const pickPositions = pickGeometry.getAttribute("position");
    const vertex = new THREE.Vector3();
    for (let i = 0; i <= segments; i++) {
      const age = definition.direction === "forward" ? i / segments : 1 - i / segments;
      const width = envelopeRadius(definition, age) * (definition.kind === "gas" ? 1.2 : 1);
      for (let ring = 0; ring <= 8; ring++) {
        const index = i * 9 + ring;
        vertex.fromBufferAttribute(pickPositions, index).sub(samples[i]).multiplyScalar(width).add(samples[i]);
        pickPositions.setXYZ(index, vertex.x, vertex.y, vertex.z);
      }
    }
    // Close only the invisible pick volume so vertical/axial views can select a
    // flow through its source or destination, while the visible stream stays open.
    const startCap = pickPositions.count;
    const cappedPositions = new Float32Array((startCap + 2) * 3);
    cappedPositions.set(pickPositions.array);
    samples[0].toArray(cappedPositions, startCap * 3);
    samples[segments].toArray(cappedPositions, (startCap + 1) * 3);
    pickGeometry.setAttribute("position", new THREE.BufferAttribute(cappedPositions, 3));
    for (const name of ["normal", "uv"]) {
      const attribute = pickGeometry.getAttribute(name);
      const array = new Float32Array((startCap + 2) * attribute.itemSize);
      array.set(attribute.array);
      pickGeometry.setAttribute(name, new THREE.BufferAttribute(array, attribute.itemSize));
    }
    const indices = Array.from(pickGeometry.getIndex()!.array);
    for (let ring = 0; ring < 8; ring++) {
      indices.push(startCap, ring + 1, ring, startCap + 1, segments * 9 + ring, segments * 9 + ring + 1);
    }
    pickGeometry.setIndex(indices);
    pickGeometry.computeBoundingBox();
    pickGeometry.computeBoundingSphere();
    const pickMaterial = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
    materials.push(pickMaterial);
    const pickMesh = new THREE.Mesh(pickGeometry, pickMaterial);
    pickMesh.name = "fluid-pick-volume";
    group.add(pickMesh);

    const count = THREE.MathUtils.clamp(Math.ceil(length / definition.radius * (definition.kind === "gas" ? 5 : 3)), 64, MAX_PARTICLES);
    const particleGeometry = new THREE.InstancedBufferGeometry();
    geometries.push(particleGeometry);
    particleGeometry.setAttribute("position", new THREE.Float32BufferAttribute([-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0], 3));
    particleGeometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    particleGeometry.setIndex([0, 1, 2, 0, 2, 3]);
    particleGeometry.instanceCount = count;
    const centers = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const sizes = new THREE.InstancedBufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage);
    const fades = new THREE.InstancedBufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage);
    const seeds = Float32Array.from({ length: count }, (_, index) => hashSeed(index, 6127));
    particleGeometry.setAttribute("aCenter", centers);
    particleGeometry.setAttribute("aSize", sizes);
    particleGeometry.setAttribute("aFade", fades);
    particleGeometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
    particleGeometry.boundingBox = localBounds.clone();
    particleGeometry.boundingSphere = localBounds.getBoundingSphere(new THREE.Sphere());
    const particles = new THREE.ShaderMaterial({
      vertexShader: particleVertex, fragmentShader: particleFragment,
      uniforms: {
        uColor: { value: new THREE.Color(definition.color) }, uOpacity: { value: definition.opacity },
        uKind: { value: definition.kind === "gas" ? 0 : definition.kind === "liquid" ? 1 : 2 },
      },
      transparent: true, depthWrite: false,
      blending: definition.kind === "molten" ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    materials.push(particles);
    const particleMesh = new THREE.Mesh(particleGeometry, particles);
    particleMesh.name = "fluid-particles";
    particleMesh.raycast = () => { /* Picking uses the path envelope above. */ };
    group.add(particleMesh);
    return {
      definition, signature: shapeSignature(definition), group, pathBounds, localBounds, curve, length,
      samples, normals: frames.normals, binormals: frames.binormals, surface, particles,
      particleGeometry, centers, sizes, fades, seeds, geometries, materials, phase: 0,
    };
  } catch (error) {
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    throw new Error(`流体“${definition.label}” (${definition.id}) 构建失败`, { cause: error });
  }
}

/** Scene-local procedural visuals; the existing SceneRuntime owns the clock and renderer. */
export class FluidManager {
  private records = new Map<string, FluidRecord>();
  private disposed = false;
  private readonly center = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly binormal = new THREE.Vector3();

  constructor(private readonly parent: THREE.Group) {}

  private assertActive() { if (this.disposed) throw new Error("流体管理器已释放"); }

  reconcile(fluids: readonly FluidDefinition[]): void {
    this.assertActive();
    const parsed = parseFluids(fluids);
    if (!parsed.ok) throw new Error(`流体配置无效：${parsed.message}`);
    const next = new Map<string, FluidRecord>();
    const additions: FluidRecord[] = [];
    try {
      for (const definition of parsed.value) {
        const previous = this.records.get(definition.id);
        if (previous?.signature === shapeSignature(definition)) next.set(definition.id, previous);
        else {
          const created = createRecord(definition);
          created.phase = previous?.phase ?? 0;
          additions.push(created);
          this.writeParticles(created);
          next.set(definition.id, created);
        }
      }
    } catch (error) {
      additions.forEach(disposeRecord);
      throw error; // Keep the last-good scene intact while the caller displays the failure.
    }
    for (const definition of parsed.value) {
      const record = next.get(definition.id)!;
      record.definition = definition;
      record.group.name = definition.label;
      record.group.visible = definition.visible;
      for (const material of [record.surface, record.particles]) {
        if (!material) continue;
        (material.uniforms.uColor.value as THREE.Color).set(definition.color);
        material.uniforms.uOpacity.value = definition.opacity;
      }
      if (record.surface) record.surface.uniforms.uPhase.value = record.phase;
    }
    this.records.forEach((record, id) => { if (next.get(id) !== record) disposeRecord(record); });
    additions.forEach((record) => this.parent.add(record.group));
    this.records = next;
  }

  private writeParticles(record: FluidRecord) {
    const { definition, samples, normals, binormals, seeds, centers, sizes, fades } = record;
    const last = samples.length - 1;
    for (let index = 0; index < seeds.length; index++) {
      const age = (index / seeds.length + record.phase) % 1;
      const pathT = definition.direction === "forward" ? age : 1 - age;
      const sample = pathT * last;
      const left = Math.min(Math.floor(sample), last - 1);
      const mix = sample - left;
      this.center.lerpVectors(samples[left], samples[left + 1], mix);
      this.normal.lerpVectors(normals[left], normals[left + 1], mix).normalize();
      this.binormal.lerpVectors(binormals[left], binormals[left + 1], mix).normalize();
      const width = envelopeRadius(definition, age);
      const angle = seeds[index] * TAU + Math.sin(age * TAU + seeds[index] * 12) * 0.35;
      const lateral = width * Math.sqrt(hashSeed(index, 19417)) * (definition.mode === "diffuse" || definition.kind === "gas" ? 0.7 : 0.88);
      this.center.addScaledVector(this.normal, Math.cos(angle) * lateral).addScaledVector(this.binormal, Math.sin(angle) * lateral);
      centers.setXYZ(index, this.center.x, this.center.y, this.center.z);
      // Steam has overlapping soft clouds; liquids have distinct droplets; molten
      // particles have additive hot cores. Shape choice remains independent of kind.
      const size = definition.kind === "gas" ? width * (0.95 + seeds[index] * 0.45)
        : definition.radius * (definition.mode === "diffuse" ? 0.45 : 0.24) * (0.65 + seeds[index] * 0.7);
      sizes.setX(index, size);
      // A particle dies at its destination and is re-emitted invisibly at its source.
      // Its wrap never draws a segment travelling backward across the path.
      fades.setX(index, smoothstep(0, 0.06, age) * (1 - smoothstep(0.84, 1, age)));
    }
    centers.needsUpdate = true;
    sizes.needsUpdate = true;
    fades.needsUpdate = true;
  }

  update(deltaSeconds: number, playing: boolean, speed: number): void {
    this.assertActive();
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0 || !Number.isFinite(speed) || speed < 0 || typeof playing !== "boolean") {
      throw new Error("流体时钟需要非负有限时间、非负有限速度及布尔播放状态");
    }
    if (!playing || deltaSeconds === 0 || speed === 0) return;
    for (const record of this.records.values()) {
      if (!record.definition.visible || !record.definition.playing) continue;
      const advance = deltaSeconds * speed * record.definition.speed / record.length;
      if (!Number.isFinite(advance)) throw new Error(`流体 ${record.definition.id} 的时钟增量溢出`);
      record.phase = (record.phase + advance % 1) % 1;
      if (record.surface) record.surface.uniforms.uPhase.value = record.phase;
      this.writeParticles(record);
    }
  }

  getObjects(): THREE.Object3D[] {
    this.assertActive();
    return [...this.records.values()].filter((record) => record.definition.visible).map((record) => record.group);
  }

  /** World-space conservative bounds include maximum diffusion, even while paused. */
  getBounds(): THREE.Box3 {
    this.assertActive();
    this.parent.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3();
    for (const record of this.records.values()) {
      if (!record.definition.visible) continue;
      // Billboards face the camera instead of inheriting the parent's rotation.
      // Expand after transforming the path so even nonuniform parent scale is safe.
      const margin = envelopeRadius(record.definition, 1) * 2 * record.group.matrixWorld.getMaxScaleOnAxis();
      bounds.union(record.pathBounds.clone().applyMatrix4(record.group.matrixWorld).expandByScalar(margin));
    }
    return bounds;
  }

  pickId(object: THREE.Object3D): string | null {
    this.assertActive();
    let current: THREE.Object3D | null = object;
    while (current && current !== this.parent) {
      const id: unknown = current.userData.fluidId;
      if (typeof id === "string") {
        const record = this.records.get(id);
        if (record?.group === current && record.definition.visible) return id;
      }
      current = current.parent;
    }
    return null;
  }

  diagnostics() {
    const records = [...this.records.values()];
    return {
      fluidCount: records.length, visibleFluidCount: records.filter((record) => record.definition.visible).length,
      particleCount: records.reduce((sum, record) => sum + record.seeds.length, 0),
      geometryCount: records.reduce((sum, record) => sum + record.geometries.length, 0),
      materialCount: records.reduce((sum, record) => sum + record.materials.length, 0),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.records.forEach(disposeRecord);
    this.records.clear();
  }
}
