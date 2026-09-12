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

export function createAnimatedMockGltf({ interpolation = "LINEAR", start = 0, duplicateNames = false, path = "translation" } = {}) {
  const gltf = JSON.parse(createMockGltf([{ children: [1], extras: { newpowerObjectId: "moving-group" } }, { mesh: 0, name: "AnimatedPart" }]));
  gltf.scenes[0].nodes = [0];
  const previous = Buffer.from(gltf.buffers[0].uri.split(",")[1], "base64");
  const times = Buffer.from(new Float32Array([start, start + 1, start + 2]).buffer);
  const positions = path === "rotation" ? [[0,0,0,1],[0,Math.SQRT1_2,0,Math.SQRT1_2],[0,0,0,1]] : [[0,0,0],[0,2,0],[0,0,0]];
  const dimensions = positions[0].length;
  const output = interpolation === "CUBICSPLINE" ? positions.flatMap((position) => [...new Array(dimensions).fill(0),...position,...new Array(dimensions).fill(0)]) : positions.flat();
  const values = Buffer.from(new Float32Array(output).buffer);
  const binary = Buffer.concat([previous,times,values]);
  gltf.buffers[0] = { byteLength: binary.length, uri: `data:application/octet-stream;base64,${binary.toString("base64")}` };
  const timeView = gltf.bufferViews.length, valueView = timeView + 1;
  gltf.bufferViews.push({ buffer: 0, byteOffset: previous.length, byteLength: times.length }, { buffer: 0, byteOffset: previous.length + times.length, byteLength: values.length });
  const input = gltf.accessors.length, out = input + 1;
  gltf.accessors.push({ bufferView: timeView, componentType: 5126, count: 3, type: "SCALAR", min: [start], max: [start+2] }, { bufferView: valueView, componentType: 5126, count: output.length / dimensions, type: `VEC${dimensions}` });
  gltf.animations = [{ name: "Lift", extras: { newpowerAnimationId: "lift" }, channels: [{ sampler: 0, target: { node: 0, path } }], samplers: [{ input, output: out, interpolation }] }];
  if (duplicateNames) gltf.animations.push({ ...structuredClone(gltf.animations[0]), extras: { newpowerAnimationId: "lift-copy" } });
  return JSON.stringify(gltf);
}

export function createDeformedMockGltf(kind = "skin") {
  const gltf = JSON.parse(createAnimatedMockGltf());
  let binary = Buffer.from(gltf.buffers[0].uri.split(",")[1],"base64");
  const accessor = (array,type,componentType,extra = {}) => {
    const bytes = Buffer.from(array.buffer,array.byteOffset,array.byteLength),view = gltf.bufferViews.length;
    gltf.bufferViews.push({ buffer: 0,byteOffset: binary.length,byteLength: bytes.length }); binary = Buffer.concat([binary,bytes]);
    const dimensions = { SCALAR: 1,VEC3: 3,VEC4: 4 }[type];
    const index = gltf.accessors.length; gltf.accessors.push({ bufferView: view,componentType,count: array.length / dimensions,type,...extra }); return index;
  };
  const primitive = gltf.meshes[0].primitives[0];
  if (kind === "skin") {
    gltf.nodes[0].children.push(2); gltf.nodes.push({ name: "Joint",extras: { newpowerObjectId: "joint" } });
    gltf.nodes[1].skin = 0; gltf.skins = [{ joints: [2] }]; gltf.animations[0].channels[0].target.node = 2;
    primitive.attributes.JOINTS_0 = accessor(new Uint16Array(32),"VEC4",5123);
    primitive.attributes.WEIGHTS_0 = accessor(new Float32Array(Array.from({ length: 8 },() => [1,0,0,0]).flat()),"VEC4",5126);
  } else {
    gltf.meshes[0].weights = [0];
    primitive.targets = [{ POSITION: accessor(new Float32Array(Array.from({ length: 8 },() => [0,1,0]).flat()),"VEC3",5126,{ min: [0,1,0],max: [0,1,0] }) }];
    gltf.animations[0].channels[0].target = { node: 1,path: "weights" };
    gltf.animations[0].samplers[0].output = accessor(new Float32Array([0,1,0]),"SCALAR",5126);
  }
  gltf.buffers[0] = { byteLength: binary.length,uri: `data:application/octet-stream;base64,${binary.toString("base64")}` };
  return JSON.stringify(gltf);
}
