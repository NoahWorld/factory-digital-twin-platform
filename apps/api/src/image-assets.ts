import { AppError, type AppEnv } from "./auth";

export type ImageFormat = "png" | "jpeg" | "webp";

export type ImageAsset = {
  id: string;
  projectId: string;
  originalFilename: string;
  format: ImageFormat;
  contentType: string;
  byteSize: number;
  sha256: string;
  createdAt: string;
};

type ImageAssetRow = {
  id: string;
  project_id: string;
  original_filename: string;
  format: ImageFormat;
  content_type: string;
  byte_size: number;
  sha256: string;
  object_key: string;
  created_at: string;
};

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const requireImageStorage = (env: AppEnv) => {
  if (!env.PROJECT_FILES) {
    throw new AppError(
      503,
      "image_storage_not_configured",
      "Project file storage is not configured for this deployment. Configure the PROJECT_FILES object-storage binding before uploading or loading images.",
    );
  }

  return env.PROJECT_FILES;
};

const validateFilename = (value: string | null): string => {
  if (!value) {
    throw new AppError(400, "missing_image_filename", "Image uploads require a filename query parameter.");
  }

  const filename = value.trim();
  if (
    filename.length < 1
    || filename.length > 240
    || filename.includes("/")
    || filename.includes("\\")
    || filename.includes("\0")
  ) {
    throw new AppError(400, "invalid_image_filename", "The image filename must be a plain filename of at most 240 characters.");
  }

  const extension = filename.split(".").at(-1)?.toLowerCase();
  if (extension !== "png" && extension !== "jpg" && extension !== "jpeg" && extension !== "webp") {
    throw new AppError(415, "unsupported_image_format", "Only PNG, JPEG and WebP image files are supported.");
  }
  return filename;
};

const detectFormat = (bytes: Uint8Array): ImageFormat => {
  const png = bytes.byteLength >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a;
  if (png) return "png";

  const jpeg = bytes.byteLength >= 3
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff;
  if (jpeg) return "jpeg";

  const webp = bytes.byteLength >= 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50;
  if (webp) return "webp";

  throw new AppError(
    415,
    "invalid_image_content",
    "The uploaded file signature is not a supported PNG, JPEG or WebP image.",
  );
};

const validateExtensionMatchesFormat = (filename: string, format: ImageFormat) => {
  const extension = filename.split(".").at(-1)?.toLowerCase();
  const expectedFormat = extension === "jpg" ? "jpeg" : extension;
  if (expectedFormat !== format) {
    throw new AppError(
      415,
      "image_extension_mismatch",
      `The filename extension does not match the detected ${format.toUpperCase()} image content.`,
    );
  }
};

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", source));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
};

const presentImageAsset = (row: ImageAssetRow): ImageAsset => ({
  id: row.id,
  projectId: row.project_id,
  originalFilename: row.original_filename,
  format: row.format,
  contentType: row.content_type,
  byteSize: row.byte_size,
  sha256: row.sha256,
  createdAt: row.created_at,
});

const selectColumns =
  "id, project_id, original_filename, format, content_type, byte_size, sha256, object_key, created_at";

export const listImageAssets = async (env: AppEnv, projectId: string): Promise<ImageAsset[]> => {
  const result = await env.DB.prepare(
    `SELECT ${selectColumns} FROM image_assets WHERE project_id = ? ORDER BY created_at DESC, id DESC`,
  ).bind(projectId).all<ImageAssetRow>();
  return result.results.map(presentImageAsset);
};

const getImageAssetRow = async (
  env: AppEnv,
  projectId: string,
  assetId: string,
): Promise<ImageAssetRow> => {
  const row = await env.DB.prepare(
    `SELECT ${selectColumns} FROM image_assets WHERE project_id = ? AND id = ?`,
  ).bind(projectId, assetId).first<ImageAssetRow>();
  if (!row) {
    throw new AppError(404, "image_asset_not_found", "The requested image asset was not found in this project.");
  }
  return row;
};

export const uploadImageAsset = async (
  request: Request,
  env: AppEnv,
  projectId: string,
  userId: string,
  rawFilename: string | null,
): Promise<ImageAsset> => {
  const imageStorage = requireImageStorage(env);
  const filename = validateFilename(rawFilename);
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
    throw new AppError(413, "image_file_too_large", `Image files cannot exceed ${MAX_IMAGE_BYTES} bytes.`);
  }

  const buffer = await request.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new AppError(400, "empty_image_file", "The uploaded image file is empty.");
  }
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new AppError(413, "image_file_too_large", `Image files cannot exceed ${MAX_IMAGE_BYTES} bytes.`);
  }

  const bytes = new Uint8Array(buffer);
  const format = detectFormat(bytes);
  validateExtensionMatchesFormat(filename, format);
  const contentType = format === "png" ? "image/png" : format === "jpeg" ? "image/jpeg" : "image/webp";
  const sha256 = await sha256Hex(bytes);
  const assetId = crypto.randomUUID();
  const objectKey = `images/${projectId}/${assetId}/original.${format === "jpeg" ? "jpg" : format}`;
  const now = new Date().toISOString();

  await imageStorage.put(objectKey, buffer, {
    httpMetadata: { contentType },
    customMetadata: { assetId, projectId, sha256, originalFilename: filename },
  });

  try {
    await env.DB.prepare(
      `INSERT INTO image_assets
       (id, project_id, original_filename, format, content_type, byte_size, sha256, object_key, created_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      assetId,
      projectId,
      filename,
      format,
      contentType,
      buffer.byteLength,
      sha256,
      objectKey,
      userId,
      now,
    ).run();
  } catch (error) {
    await imageStorage.delete(objectKey);
    throw new AppError(
      500,
      "image_asset_metadata_write_failed",
      `The image was validated but its metadata could not be saved: ${error instanceof Error ? error.message : String(error)}`,
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
    createdAt: now,
  };
};

export const imageAssetContentResponse = async (
  request: Request,
  env: AppEnv,
  projectId: string,
  assetId: string,
): Promise<Response> => {
  const imageStorage = requireImageStorage(env);
  const row = await getImageAssetRow(env, projectId, assetId);
  const object = await imageStorage.get(row.object_key);
  if (!object) {
    throw new AppError(
      500,
      "image_asset_object_missing",
      `Image asset ${assetId} exists in D1 but its object is missing from storage.`,
    );
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
