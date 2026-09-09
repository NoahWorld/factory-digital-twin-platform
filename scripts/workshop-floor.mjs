// Paint regions share one surface topology. No stacked paint slabs or coplanar faces.
export function createWorkshopFloor(THREE, materials) {
  const patches = [];
  const paint = (x, z, width, depth, material) => patches.push({
    x0: x - width / 2, x1: x + width / 2, z0: z - depth / 2, z1: z + depth / 2, material,
  });
  for (let x = -13; x < 14; x += 2) paint(x, 0, .012, 20, 'steel');
  for (let z = -9; z < 10; z += 2) paint(0, z, 28, .012, 'steel');
  paint(0, -7.8, 26, 3.8, 'blue');
  for (const x of [-1.25, 1.25, 10, 12]) paint(x, 1, .07, 13.4, 'yellow');
  for (let z = -5; z < 8; z += 1.4) for (const x of [0, 11]) paint(x, z, .07, .65, 'white');
  for (const x of [0, 11]) for (const z of [-5.3, 7.6]) paint(x, z, 1.6, .12, 'yellow');
  const sorted = values => [...new Set(values.map(n => Number(n.toFixed(6))))].sort((a, b) => a - b);
  const xs = sorted([-14, 14, ...patches.flatMap(p => [p.x0, p.x1])]);
  const zs = sorted([-10, 10, ...patches.flatMap(p => [p.z0, p.z1])]);
  const names = ['floor', 'steel', 'blue', 'yellow', 'white'];
  const batches = names.map(() => ({ position: [], normal: [], uv: [] }));
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
    const x0 = xs[i], x1 = xs[i + 1], z0 = zs[j], z1 = zs[j + 1];
    const x = (x0 + x1) / 2, z = (z0 + z1) / 2;
    const material = patches.findLast(p => x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1)?.material ?? 'floor';
    const batch = batches[names.indexOf(material)];
    for (const [vx, vz] of [[x0,z0],[x0,z1],[x1,z1],[x0,z0],[x1,z1],[x1,z0]]) {
      batch.position.push(vx, 0, vz); batch.normal.push(0, 1, 0); batch.uv.push((vx + 14) / 28, (10 - vz) / 20);
    }
  }
  // Retain the slab sides and underside, but never its overlapping top face.
  const shell = new THREE.BoxGeometry(28, .18, 20).toNonIndexed();
  shell.translate(0, -.09, 0);
  for (const group of shell.groups) {
    if (group.materialIndex === 2) continue;
    for (let v = group.start; v < group.start + group.count; v++) {
      for (const [name, width] of [['position', 3], ['normal', 3], ['uv', 2]]) {
        batches[0][name].push(...shell.attributes[name].array.slice(v * width, (v + 1) * width));
      }
    }
  }
  shell.dispose();
  const geometry = new THREE.BufferGeometry();
  for (const [name, width] of [['position', 3], ['normal', 3], ['uv', 2]]) {
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(batches.flatMap(b => b[name]), width));
  }
  let start = 0;
  batches.forEach((batch, index) => { geometry.addGroup(start, batch.position.length / 3, index); start += batch.position.length / 3; });
  const mesh = new THREE.Mesh(geometry, names.map(name => materials[name]));
  mesh.name = 'floor_partitioned_surface';
  mesh.userData = { surfaceTopology: 'single-layer', topElevation: 0 };
  return mesh;
}
