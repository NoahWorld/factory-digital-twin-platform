import * as THREE from "three";

export type FluidPath = {
  length: number;
  samples: THREE.Vector3[];
  fractions: number[];
  normals: THREE.Vector3[];
  binormals: THREE.Vector3[];
};

/** Pipe runs are straight between authored points. Always retain every elbow,
 * including short branches that uniform arc-length sampling would skip. */
export function createStreamPath(points: THREE.Vector3[], budget: number): FluidPath {
  const lengths = points.slice(1).map((point, i) => point.distanceTo(points[i]));
  const length = lengths.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(length) || length <= 0 || lengths.some(value => value <= 0)) {
    throw new Error("路径数值长度必须是正的有限值");
  }
  const directions = points.slice(1).map((point, i) => point.clone().sub(points[i]).normalize());
  const samples = [points[0].clone()];
  const fractions = [0];
  const tangents = [directions[0].clone()];
  let distance = 0;
  lengths.forEach((runLength, run) => {
    const divisions = Math.max(1, Math.ceil(runLength / length * budget));
    for (let step = 1; step <= divisions; step++) {
      samples.push(step === divisions ? points[run + 1].clone() : new THREE.Vector3().lerpVectors(points[run], points[run + 1], step / divisions));
      fractions.push((distance + runLength * step / divisions) / length);
      const tangent = directions[run].clone();
      if (step === divisions && run + 1 < directions.length) {
        tangent.add(directions[run + 1]);
        // A return along the same run has a cusp, not an undefined frame.
        if (tangent.lengthSq() < 1e-12) tangent.copy(directions[run + 1]);
        else tangent.normalize();
      }
      tangents.push(tangent);
    }
    distance += runLength;
  });
  fractions[fractions.length - 1] = 1;

  const reference = Math.abs(tangents[0].y) < .9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const normals = [new THREE.Vector3().crossVectors(tangents[0], reference).normalize()];
  const binormals = [new THREE.Vector3().crossVectors(tangents[0], normals[0]).normalize()];
  const rotation = new THREE.Quaternion();
  for (let i = 1; i < samples.length; i++) {
    rotation.setFromUnitVectors(tangents[i - 1], tangents[i]);
    normals.push(normals[i - 1].clone().applyQuaternion(rotation).normalize());
    binormals.push(new THREE.Vector3().crossVectors(tangents[i], normals[i]).normalize());
  }
  return { length, samples, fractions, normals, binormals };
}

/** Rings share the exact path samples used by particles and picking. UV distance
 * is measured along the pipe so unequal runs keep the same visible flow speed. */
export function createFluidTube(path: FluidPath, radialSegments: number, radius: (fraction: number) => number): THREE.BufferGeometry {
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  const offset = new THREE.Vector3();
  for (let i = 0; i < path.samples.length; i++) {
    const width = radius(path.fractions[i]);
    for (let j = 0; j <= radialSegments; j++) {
      const angle = j / radialSegments * Math.PI * 2;
      offset.copy(path.normals[i]).multiplyScalar(-Math.cos(angle)).addScaledVector(path.binormals[i], Math.sin(angle)).normalize();
      normals.push(offset.x, offset.y, offset.z);
      offset.multiplyScalar(width).add(path.samples[i]);
      positions.push(offset.x, offset.y, offset.z);
      uvs.push(path.fractions[i], j / radialSegments);
      if (i > 0 && j > 0) {
        const a = (i - 1) * (radialSegments + 1) + j - 1, b = i * (radialSegments + 1) + j - 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}
