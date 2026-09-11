export type SupportedBackgroundImageFormat = "png" | "jpeg" | "webp";

export type ImageDimensions = {
  height: number;
  width: number;
};

export type TexturedBackgroundPlaneOptions = {
  imageBytes: Uint8Array;
  imageFormat: SupportedBackgroundImageFormat;
  planeWidthMeters: number;
};

export type TexturedBackgroundPlane = {
  bytes: Uint8Array;
  imageHeight: number;
  imageWidth: number;
  planeHeightMeters: number;
  planeWidthMeters: number;
};

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BINARY_CHUNK = 0x004e4942;
const encoder = new TextEncoder();

const align4 = (value: number): number => (value + 3) & ~3;

const readUint24LittleEndian = (bytes: Uint8Array, offset: number): number =>
  bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);

const readPngDimensions = (bytes: Uint8Array): ImageDimensions => {
  if (bytes.byteLength < 24) throw new Error("PNG 图片缺少完整的 IHDR 尺寸信息。");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (width < 1 || height < 1) throw new Error("PNG 图片尺寸必须大于 0。");
  return { width, height };
};

const jpegStartOfFrameMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
]);

const readJpegDimensions = (bytes: Uint8Array): ImageDimensions => {
  let offset = 2;
  while (offset + 8 < bytes.byteLength) {
    while (offset < bytes.byteLength && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.byteLength) break;

    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) continue;
    if (marker === 0xda) break;
    if (offset + 1 >= bytes.byteLength) break;

    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) {
      throw new Error("JPEG 图片包含损坏的段长度。");
    }
    if (jpegStartOfFrameMarkers.has(marker)) {
      if (segmentLength < 7) throw new Error("JPEG 图片的尺寸段不完整。");
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      if (width < 1 || height < 1) throw new Error("JPEG 图片尺寸必须大于 0。");
      return { width, height };
    }
    offset += segmentLength;
  }
  throw new Error("JPEG 图片中没有可读取的尺寸信息。");
};

const readWebpDimensions = (bytes: Uint8Array): ImageDimensions => {
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const chunkName = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    const chunkSize = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4).getUint32(0, true);
    const dataOffset = offset + 8;
    if (dataOffset + chunkSize > bytes.byteLength) throw new Error("WebP 图片包含损坏的块长度。");

    if (chunkName === "VP8X") {
      if (chunkSize < 10) throw new Error("WebP VP8X 尺寸块不完整。");
      return {
        width: readUint24LittleEndian(bytes, dataOffset + 4) + 1,
        height: readUint24LittleEndian(bytes, dataOffset + 7) + 1,
      };
    }
    if (chunkName === "VP8 ") {
      if (
        chunkSize < 10
        || bytes[dataOffset + 3] !== 0x9d
        || bytes[dataOffset + 4] !== 0x01
        || bytes[dataOffset + 5] !== 0x2a
      ) {
        throw new Error("WebP VP8 帧头不完整。");
      }
      const width = (bytes[dataOffset + 6] | (bytes[dataOffset + 7] << 8)) & 0x3fff;
      const height = (bytes[dataOffset + 8] | (bytes[dataOffset + 9] << 8)) & 0x3fff;
      if (width < 1 || height < 1) throw new Error("WebP 图片尺寸必须大于 0。");
      return { width, height };
    }
    if (chunkName === "VP8L") {
      if (chunkSize < 5 || bytes[dataOffset] !== 0x2f) throw new Error("WebP VP8L 帧头不完整。");
      const byte1 = bytes[dataOffset + 1];
      const byte2 = bytes[dataOffset + 2];
      const byte3 = bytes[dataOffset + 3];
      const byte4 = bytes[dataOffset + 4];
      return {
        width: 1 + byte1 + ((byte2 & 0x3f) << 8),
        height: 1 + ((byte2 & 0xc0) >> 6) + (byte3 << 2) + ((byte4 & 0x0f) << 10),
      };
    }
    offset = align4(dataOffset + chunkSize);
  }
  throw new Error("WebP 图片中没有可读取的尺寸信息。");
};

export const readImageDimensions = (
  bytes: Uint8Array,
  format: SupportedBackgroundImageFormat,
): ImageDimensions => {
  if (format === "png") return readPngDimensions(bytes);
  if (format === "jpeg") return readJpegDimensions(bytes);
  return readWebpDimensions(bytes);
};

const writeFloat32Array = (target: Uint8Array, offset: number, values: readonly number[]) => {
  const view = new DataView(target.buffer, target.byteOffset + offset, values.length * 4);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
};

const writeUint16Array = (target: Uint8Array, offset: number, values: readonly number[]) => {
  const view = new DataView(target.buffer, target.byteOffset + offset, values.length * 2);
  values.forEach((value, index) => view.setUint16(index * 2, value, true));
};

export const buildTexturedBackgroundPlaneGlb = (
  options: TexturedBackgroundPlaneOptions,
): TexturedBackgroundPlane => {
  if (options.imageBytes.byteLength === 0) throw new Error("背景图片不能为空。");
  if (!Number.isFinite(options.planeWidthMeters) || options.planeWidthMeters <= 0) {
    throw new Error("背景平面宽度必须是大于 0 的有限数字。");
  }

  const dimensions = readImageDimensions(options.imageBytes, options.imageFormat);
  const planeWidthMeters = options.planeWidthMeters;
  const planeHeightMeters = planeWidthMeters * dimensions.height / dimensions.width;
  const halfWidth = planeWidthMeters / 2;
  const halfHeight = planeHeightMeters / 2;
  const positionByteLength = 4 * 3 * 4;
  const uvByteOffset = positionByteLength;
  const uvByteLength = 4 * 2 * 4;
  const indexByteOffset = uvByteOffset + uvByteLength;
  const indexByteLength = 6 * 2;
  const imageByteOffset = align4(indexByteOffset + indexByteLength);
  const binaryByteLength = align4(imageByteOffset + options.imageBytes.byteLength);
  const binary = new Uint8Array(binaryByteLength);

  writeFloat32Array(binary, 0, [
    -halfWidth, -halfHeight, 0,
    halfWidth, -halfHeight, 0,
    halfWidth, halfHeight, 0,
    -halfWidth, halfHeight, 0,
  ]);
  writeFloat32Array(binary, uvByteOffset, [0, 1, 1, 1, 1, 0, 0, 0]);
  writeUint16Array(binary, indexByteOffset, [0, 1, 2, 0, 2, 3]);
  binary.set(options.imageBytes, imageByteOffset);

  const mimeType = options.imageFormat === "png"
    ? "image/png"
    : options.imageFormat === "jpeg" ? "image/jpeg" : "image/webp";
  const document = {
    asset: { version: "2.0", generator: "Factory Digital Twin textured-plane-v1" },
    extensionsUsed: ["KHR_materials_unlit"],
    extensionsRequired: ["KHR_materials_unlit"],
    scene: 0,
    scenes: [{ name: "Background_Scene", nodes: [0] }],
    nodes: [{ name: "Background_Surface", mesh: 0 }],
    meshes: [{
      name: "Background_Mesh",
      primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0 }],
    }],
    materials: [{
      name: "Background_Material",
      doubleSided: true,
      extensions: { KHR_materials_unlit: {} },
      pbrMetallicRoughness: {
        baseColorTexture: { index: 0 },
        metallicFactor: 0,
        roughnessFactor: 1,
      },
    }],
    textures: [{ sampler: 0, source: 0 }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    images: [{ name: "Background_Image", bufferView: 3, mimeType }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 4,
        max: [halfWidth, halfHeight, 0],
        min: [-halfWidth, -halfHeight, 0],
        type: "VEC3",
      },
      { bufferView: 1, componentType: 5126, count: 4, type: "VEC2" },
      { bufferView: 2, componentType: 5123, count: 6, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteLength: positionByteLength, byteOffset: 0, target: 34962 },
      { buffer: 0, byteLength: uvByteLength, byteOffset: uvByteOffset, target: 34962 },
      { buffer: 0, byteLength: indexByteLength, byteOffset: indexByteOffset, target: 34963 },
      { buffer: 0, byteLength: options.imageBytes.byteLength, byteOffset: imageByteOffset },
    ],
    buffers: [{ byteLength: binaryByteLength }],
  };

  const rawJson = encoder.encode(JSON.stringify(document));
  const jsonByteLength = align4(rawJson.byteLength);
  const totalLength = 12 + 8 + jsonByteLength + 8 + binaryByteLength;
  const glb = new Uint8Array(totalLength);
  const glbView = new DataView(glb.buffer);
  glbView.setUint32(0, GLB_MAGIC, true);
  glbView.setUint32(4, 2, true);
  glbView.setUint32(8, totalLength, true);
  glbView.setUint32(12, jsonByteLength, true);
  glbView.setUint32(16, GLB_JSON_CHUNK, true);
  glb.fill(0x20, 20, 20 + jsonByteLength);
  glb.set(rawJson, 20);
  const binaryChunkOffset = 20 + jsonByteLength;
  glbView.setUint32(binaryChunkOffset, binaryByteLength, true);
  glbView.setUint32(binaryChunkOffset + 4, GLB_BINARY_CHUNK, true);
  glb.set(binary, binaryChunkOffset + 8);

  return {
    bytes: glb,
    imageHeight: dimensions.height,
    imageWidth: dimensions.width,
    planeHeightMeters,
    planeWidthMeters,
  };
};
