import { AppError, type AppEnv } from "./auth";

export type ModelFormat = "glb" | "gltf";

export type ModelInspection = {
  format: ModelFormat;
  gltfVersion: string;
  sceneCount: number;
  nodeCount: number;
  meshCount: number;
  materialCount: number;
  textureCount: number;
  imageCount: number;
  animationCount: number;
  namedNodeCount: number;
  duplicateNodeNames: string[];
  externalResourceCount: number;
};

export type ModelAsset = {
  id: string;
  projectId: string;
  originalFilename: string;
  format: ModelFormat;
  contentType: string;
  byteSize: number;
  sha256: string;
  inspection: ModelInspection;
  createdAt: string;
};

type ModelAssetRow = {
  id: string;
  project_id: string;
  original_filename: string;
  format: ModelFormat;
  content_type: string;
  byte_size: number;
  sha256: string;
  object_key: string;
  inspection_json: string;
  created_at: string;
};

type GltfDocument = {
  asset?: { version?: unknown };
  scenes?: unknown;
  nodes?: unknown;
  meshes?: unknown;
  materials?: unknown;
  textures?: unknown;
  images?: unknown;
  animations?: unknown;
  buffers?: unknown;
};

type NamedNode = { name?: unknown };
type ResourceReference = { uri?: unknown };

const MAX_MODEL_BYTES = 25 * 1024 * 1024;
const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const textDecoder = new TextDecoder();

const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

const validateFilename = (value: string | null): { filename: string; format: ModelFormat } => {
  if (!value) {
    throw new AppError(400, "missing_model_filename", "Model uploads require a filename query parameter.");
  }

  // URLSearchParams has already decoded the query value. Decoding it again
  // would incorrectly reject legitimate filenames that contain a percent sign.
  const filename = value.trim();

  if (filename.length < 1 || filename.length > 240 || filename.includes("/") || filename.includes("\\") || filename.includes("\0")) {
    throw new AppError(400, "invalid_model_filename", "The model filename must be a plain filename of at most 240 characters.");
  }

  const extension = filename.split(".").at(-1)?.toLowerCase();
  if (extension !== "glb" && extension !== "gltf") {
    throw new AppError(415, "unsupported_model_format", "Only .glb and .gltf model files are supported.");
  }

  return { filename, format: extension };
};

const parseJsonDocument = (text: string, code: string): GltfDocument => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new AppError(400, code, `The model JSON is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError(400, code, "The model JSON root must be an object.");
  }
  return parsed as GltfDocument;
};

const inspectDocument = (document: GltfDocument, format: ModelFormat): ModelInspection => {
  const gltfVersion = document.asset?.version;
  if (typeof gltfVersion !== "string" || !gltfVersion.startsWith("2.")) {
    throw new AppError(400, "unsupported_gltf_version", "Only glTF 2.x models are supported.");
  }

  const nodes = asArray(document.nodes) as NamedNode[];
  const nodeNames = nodes
    .map((node) => typeof node?.name === "string" ? node.name.trim() : "")
    .filter((name) => name.length > 0);
  const seenNames = new Set<string>();
  const duplicateNodeNames = [...new Set(nodeNames.filter((name) => {
    if (seenNames.has(name)) return true;
    seenNames.add(name);
    return false;
  }))].slice(0, 100);

  const resourceReferences = [
    ...asArray(document.buffers),
    ...asArray(document.images),
  ] as ResourceReference[];
  const externalUris = resourceReferences
    .map((entry) => typeof entry?.uri === "string" ? entry.uri.trim() : "")
    .filter((uri) => uri.length > 0 && !uri.startsWith("data:"));

  if (externalUris.length > 0) {
    throw new AppError(
      400,
      "external_gltf_resources_not_supported",
      `This standalone upload references ${externalUris.length} external file(s). Embed the resources or export the model as .glb.`,
    );
  }

  return {
    format,
    gltfVersion,
    sceneCount: asArray(document.scenes).length,
    nodeCount: nodes.length,
    meshCount: asArray(document.meshes).length,
    materialCount: asArray(document.materials).length,
    textureCount: asArray(document.textures).length,
    imageCount: asArray(document.images).length,
    animationCount: asArray(document.animations).length,
    namedNodeCount: nodeNames.length,
    duplicateNodeNames,
    externalResourceCount: externalUris.length,
  };
};

const inspectGlb = (bytes: Uint8Array): ModelInspection => {
  if (bytes.byteLength < 20) {
    throw new AppError(400, "invalid_glb", "The GLB file is too small to contain a valid header and JSON chunk.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    throw new AppError(400, "invalid_glb_magic", "The uploaded .glb file does not contain the GLB magic header.");
  }
  if (view.getUint32(4, true) !== 2) {
    throw new AppError(400, "unsupported_glb_version", "Only GLB container version 2 is supported.");
  }
  if (view.getUint32(8, true) !== bytes.byteLength) {
    throw new AppError(400, "invalid_glb_length", "The GLB declared length does not match the uploaded file size.");
  }

  let offset = 12;
  let document: GltfDocument | null = null;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) {
      throw new AppError(400, "invalid_glb_chunk", "The GLB contains a truncated chunk header.");
    }
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    if (chunkEnd > bytes.byteLength) {
      throw new AppError(400, "invalid_glb_chunk", "The GLB contains a chunk that exceeds the uploaded file size.");
    }
    if (chunkType === GLB_JSON_CHUNK) {
      if (document) {
        throw new AppError(400, "invalid_glb_json_chunks", "The GLB must contain exactly one JSON chunk.");
      }
      const text = textDecoder.decode(bytes.subarray(chunkStart, chunkEnd)).replace(/\0+$/u, "").trim();
      document = parseJsonDocument(text, "invalid_glb_json");
    }
    offset = chunkEnd;
  }

  if (!document) {
    throw new AppError(400, "missing_glb_json", "The GLB does not contain a JSON chunk.");
  }
  return inspectDocument(document, "glb");
};

const inspectGltf = (bytes: Uint8Array): ModelInspection =>
  inspectDocument(parseJsonDocument(textDecoder.decode(bytes), "invalid_gltf_json"), "gltf");

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", source));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
};

const parseStoredInspection = (row: ModelAssetRow): ModelInspection => {
  try {
    const value: unknown = JSON.parse(row.inspection_json);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value as ModelInspection;
  } catch (error) {
    throw new AppError(
      500,
      "invalid_model_asset_storage",
      `Model asset ${row.id} has invalid inspection JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

export const presentModelAsset = (row: ModelAssetRow): ModelAsset => ({
  id: row.id,
  projectId: row.project_id,
  originalFilename: row.original_filename,
  format: row.format,
  contentType: row.content_type,
  byteSize: row.byte_size,
  sha256: row.sha256,
  inspection: parseStoredInspection(row),
  createdAt: row.created_at,
});

const selectColumns =
  "id, project_id, original_filename, format, content_type, byte_size, sha256, object_key, inspection_json, created_at";

export const listModelAssets = async (env: AppEnv, projectId: string): Promise<ModelAsset[]> => {
  const result = await env.DB.prepare(
    `SELECT ${selectColumns} FROM model_assets WHERE project_id = ? ORDER BY created_at DESC, id DESC`,
  ).bind(projectId).all<ModelAssetRow>();
  return result.results.map(presentModelAsset);
};

export const getModelAssetRow = async (env: AppEnv, projectId: string, assetId: string): Promise<ModelAssetRow> => {
  const row = await env.DB.prepare(
    `SELECT ${selectColumns} FROM model_assets WHERE project_id = ? AND id = ?`,
  ).bind(projectId, assetId).first<ModelAssetRow>();
  if (!row) {
    throw new AppError(404, "model_asset_not_found", "The requested model asset was not found in this project.");
  }
  return row;
};

export const uploadModelAsset = async (
  request: Request,
  env: AppEnv,
  projectId: string,
  userId: string,
  rawFilename: string | null,
): Promise<ModelAsset> => {
  const { filename, format } = validateFilename(rawFilename);
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_MODEL_BYTES) {
    throw new AppError(413, "model_file_too_large", `Model files cannot exceed ${MAX_MODEL_BYTES} bytes.`);
  }

  const buffer = await request.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new AppError(400, "empty_model_file", "The uploaded model file is empty.");
  }
  if (buffer.byteLength > MAX_MODEL_BYTES) {
    throw new AppError(413, "model_file_too_large", `Model files cannot exceed ${MAX_MODEL_BYTES} bytes.`);
  }

  const bytes = new Uint8Array(buffer);
  const inspection = format === "glb" ? inspectGlb(bytes) : inspectGltf(bytes);
  const sha256 = await sha256Hex(bytes);
  const assetId = crypto.randomUUID();
  const objectKey = `${projectId}/${assetId}/original.${format}`;
  const contentType = format === "glb" ? "model/gltf-binary" : "model/gltf+json";
  const now = new Date().toISOString();

  await env.MODEL_ASSETS.put(objectKey, buffer, {
    httpMetadata: { contentType },
    customMetadata: { assetId, projectId, sha256, originalFilename: filename },
  });

  try {
    await env.DB.prepare(
      `INSERT INTO model_assets
       (id, project_id, original_filename, format, content_type, byte_size, sha256, object_key, inspection_json, created_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      assetId,
      projectId,
      filename,
      format,
      contentType,
      buffer.byteLength,
      sha256,
      objectKey,
      JSON.stringify(inspection),
      userId,
      now,
    ).run();
  } catch (error) {
    await env.MODEL_ASSETS.delete(objectKey);
    throw new AppError(
      500,
      "model_asset_metadata_write_failed",
      `The model file was validated but its metadata could not be saved: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return {
    id: assetId,
    projectId,
    originalFilename: filename,
    format,
    contentType,
    byteSize: buffer.byteLength,
    sha256,
    inspection,
    createdAt: now,
  };
};

export const modelAssetContentResponse = async (
  request: Request,
  env: AppEnv,
  projectId: string,
  assetId: string,
): Promise<Response> => {
  const row = await getModelAssetRow(env, projectId, assetId);
  const object = await env.MODEL_ASSETS.get(row.object_key);
  if (!object) {
    throw new AppError(500, "model_asset_object_missing", `Model asset ${assetId} exists in D1 but its object is missing from storage.`);
  }

  const headers = new Headers({
    "cache-control": "private, max-age=31536000, immutable",
    "content-length": String(object.size),
    "content-type": row.content_type,
    etag: object.httpEtag,
    "x-content-type-options": "nosniff",
  });
  object.writeHttpMetadata(headers);
  if (request.headers.get("if-none-match") === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(object.body, { headers });
};
