export const createMockGltf = (nodes = [{ mesh: 0, name: "SmokeDeviceNode" }]) => {
  const positions = new Float32Array([
    -1, -1, -1,
    1, -1, -1,
    1, 1, -1,
    -1, 1, -1,
    -1, -1, 1,
    1, -1, 1,
    1, 1, 1,
    -1, 1, 1,
  ]);
  const indices = new Uint16Array([
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1,
    3, 2, 6, 3, 6, 7,
    1, 5, 6, 1, 6, 2,
    0, 3, 7, 0, 7, 4,
  ]);
  const positionBytes = Buffer.from(
    positions.buffer,
    positions.byteOffset,
    positions.byteLength,
  );
  const indexBytes = Buffer.from(
    indices.buffer,
    indices.byteOffset,
    indices.byteLength,
  );
  const binary = Buffer.concat([positionBytes, indexBytes]);
  return JSON.stringify({
    asset: { generator: "factory-runtime-smoke-test", version: "2.0" },
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 8,
        max: [1, 1, 1],
        min: [-1, -1, -1],
        type: "VEC3",
      },
      {
        bufferView: 1,
        componentType: 5123,
        count: 36,
        type: "SCALAR",
      },
    ],
    buffers: [{
      byteLength: binary.byteLength,
      uri: `data:application/octet-stream;base64,${binary.toString("base64")}`,
    }],
    bufferViews: [
      { buffer: 0, byteLength: positionBytes.byteLength, byteOffset: 0, target: 34962 },
      {
        buffer: 0,
        byteLength: indexBytes.byteLength,
        byteOffset: positionBytes.byteLength,
        target: 34963,
      },
    ],
    materials: [{
      name: "SmokeDeviceMaterial",
      pbrMetallicRoughness: {
        baseColorFactor: [0.16, 0.5, 0.68, 1],
        metallicFactor: 0.15,
        roughnessFactor: 0.58,
      },
    }],
    meshes: [{
      name: "SmokeDeviceMesh",
      primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }],
    }],
    nodes,
    scene: 0,
    scenes: [{ name: "RuntimeSmokeScene", nodes: nodes.map((_, index) => index) }],
  });
};

// Two independently addressable material primitives, with optional reordered export.
export const createMultiPrimitiveGltf = (reverse = false) => {
  const document = JSON.parse(createMockGltf([{ mesh: 0, name: "Assembly", extras: { newpowerObjectId: "assembly" } }]));
  const binary = Buffer.from(document.buffers[0].uri.split(",")[1], "base64");
  const positions = new Float32Array(binary.buffer.slice(binary.byteOffset, binary.byteOffset + 96));
  for (let index = 0; index < positions.length; index += 3) positions[index] += 4;
  const appended = Buffer.from(positions.buffer);
  document.buffers[0] = { byteLength: binary.length + appended.length, uri: `data:application/octet-stream;base64,${Buffer.concat([binary, appended]).toString("base64")}` };
  document.bufferViews.push({ buffer: 0, byteOffset: binary.length, byteLength: appended.length, target: 34962 });
  document.accessors.push({ bufferView: 2, componentType: 5126, count: 8, type: "VEC3", min: [3,-1,-1], max: [5,1,1] });
  document.materials[0].name = "LeftSurface";
  document.materials.push({ ...structuredClone(document.materials[0]), name: "RightSurface" });
  document.meshes[0].name = "MachineMesh";
  document.meshes[0].primitives[0].extras = { newpowerObjectId: "part-a" };
  document.meshes[0].primitives.push({ attributes: { POSITION: 2 }, indices: 1, material: 1, extras: { newpowerObjectId: "part-b" } });
  if (reverse) document.meshes[0].primitives.reverse();
  return JSON.stringify(document);
};

export function createAnimatedMockGltf({ interpolation = "LINEAR", start = 0, duplicateNames = false } = {}) {
  const gltf = JSON.parse(createMockGltf([{ children: [1], extras: { newpowerObjectId: "moving-group" } }, { mesh: 0, name: "AnimatedPart" }]));
  gltf.scenes[0].nodes = [0];
  const previous = Buffer.from(gltf.buffers[0].uri.split(",")[1], "base64");
  const times = Buffer.from(new Float32Array([start, start + 1, start + 2]).buffer);
  const positions = [[0,0,0],[0,2,0],[0,0,0]];
  const output = interpolation === "CUBICSPLINE" ? positions.flatMap((position) => [0,0,0,...position,0,0,0]) : positions.flat();
  const values = Buffer.from(new Float32Array(output).buffer);
  const binary = Buffer.concat([previous,times,values]);
  gltf.buffers[0] = { byteLength: binary.length, uri: `data:application/octet-stream;base64,${binary.toString("base64")}` };
  const timeView = gltf.bufferViews.length, valueView = timeView + 1;
  gltf.bufferViews.push({ buffer: 0, byteOffset: previous.length, byteLength: times.length }, { buffer: 0, byteOffset: previous.length + times.length, byteLength: values.length });
  const input = gltf.accessors.length, out = input + 1;
  gltf.accessors.push({ bufferView: timeView, componentType: 5126, count: 3, type: "SCALAR", min: [start], max: [start+2] }, { bufferView: valueView, componentType: 5126, count: output.length / 3, type: "VEC3" });
  gltf.animations = [{ name: "Lift", extras: { newpowerAnimationId: "lift" }, channels: [{ sampler: 0, target: { node: 0, path: "translation" } }], samplers: [{ input, output: out, interpolation }] }];
  if (duplicateNames) gltf.animations.push({ ...structuredClone(gltf.animations[0]), extras: { newpowerAnimationId: "lift-copy" } });
  return JSON.stringify(gltf);
}
