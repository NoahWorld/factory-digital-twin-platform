// Conservative mesh AABB checks sampled over every complete animation period.
// This is an offline layout check, not a replacement for a physics engine.
export function checkWorkshopMotion(THREE, instances, sources) {
  const records = instances.map(instance => {
    const slug = instance.modelAssetId.replace('builtin:workshop-', '').replace(/-v\d+$/, '');
    const source = sources.get(slug);
    if (!source) throw new Error(`No motion-check source for ${instance.modelAssetId}`);
    const root = source.scene.clone(true), wrapper = new THREE.Group();
    wrapper.add(root); wrapper.position.set(...instance.transform.position);
    wrapper.rotation.set(...instance.transform.rotation.map(THREE.MathUtils.degToRad));
    wrapper.scale.set(...instance.transform.scale); wrapper.updateMatrixWorld(true);
    return { instance, root, wrapper, source, slug };
  });
  function meshBounds(record) {
    const boxes = [];
    record.root.traverse(mesh => {
      if (!mesh.isMesh) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      boxes.push({ name: mesh.name, box: mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld).expandByScalar(-.001) });
    });
    return boxes;
  }
  const staticRecords = records.filter(r => !r.source.animations.length && r.slug !== 'floor')
    .map(record => ({ ...record, bounds: new THREE.Box3().setFromObject(record.root), meshes: meshBounds(record) }));
  const checked = [];
  const sweptPaths = [];
  for (const record of records.filter(r => r.source.animations.length)) {
    const mixer = new THREE.AnimationMixer(record.root);
    const duration = Math.max(...record.source.animations.map(clip => clip.duration));
    for (const clip of record.source.animations) mixer.clipAction(clip).play();
    const samples = Math.ceil(duration * 60) + 1;
    let minimumMachineGap = Infinity;
    const swept = new THREE.Box3();
    for (let frame = 0; frame < samples; frame++) {
      const time = frame / 60;
      mixer.setTime(time); record.wrapper.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(record.root);
      swept.union(bounds);
      let movingMeshes;
      for (const obstacle of staticRecords) {
        if (obstacle.slug === 'production-machine') {
          const gap = Math.max(obstacle.bounds.min.x - bounds.max.x, bounds.min.x - obstacle.bounds.max.x,
            obstacle.bounds.min.z - bounds.max.z, bounds.min.z - obstacle.bounds.max.z, 0);
          minimumMachineGap = Math.min(minimumMachineGap, gap);
        }
        if (!bounds.intersectsBox(obstacle.bounds)) continue;
        movingMeshes ??= meshBounds(record);
        for (const moving of movingMeshes) for (const fixed of obstacle.meshes) {
          if (moving.box.intersectsBox(fixed.box)) throw new Error(
            `Motion clearance failed at ${time.toFixed(3)}s: ${record.instance.label}/${moving.name} intersects ${obstacle.instance.label}/${fixed.name}`);
        }
      }
    }
    mixer.stopAllAction(); mixer.uncacheRoot(record.root);
    sweptPaths.push({ label: record.instance.label, bounds: swept });
    checked.push({ id: record.instance.id, label: record.instance.label, duration, samples, minimumMachineGapMeters: Number.isFinite(minimumMachineGap) ? Number(minimumMachineGap.toFixed(3)) : null });
  }
  // Disjoint swept volumes are conservative even when animation phases differ.
  for (let i = 0; i < sweptPaths.length; i++) for (let j = i + 1; j < sweptPaths.length; j++) {
    if (sweptPaths[i].bounds.intersectsBox(sweptPaths[j].bounds)) {
      throw new Error(`Moving swept paths overlap: ${sweptPaths[i].label} / ${sweptPaths[j].label}`);
    }
  }
  return { method: '60 Hz full-period per-mesh AABB sampling, excluding supporting floor; disjoint swept volumes for all moving instances', checked };
}
