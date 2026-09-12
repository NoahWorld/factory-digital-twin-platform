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
