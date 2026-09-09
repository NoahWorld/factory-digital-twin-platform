import { AppError, type AppEnv } from "./auth";
import {
  emptyResourceUsage,
  listProjectResourceUsage,
  requireResourceDeletionConfirmation,
  resourceUsageFor,
  type ResourceUsage,
} from "./resource-usage";

export type MediaType = "video" | "audio";
export type MediaFormat = "mp4" | "webm" | "mp3" | "wav" | "ogg" | "m4a" | "aac";

export type MediaAsset = {
  id: string;
  projectId: string;
  originalFilename: string;
  mediaType: MediaType;
  format: MediaFormat;
  contentType: string;
  byteSize: number;
  sha256: string;
  source: "upload";
  usage: ResourceUsage;
  createdAt: string;
};

export type MediaAssetDeletion = {
  deletedMediaAssetId: string;
  usage: ResourceUsage;
  warning: string | null;
};

type MediaAssetRow = {
  id: string;
  project_id: string;
  original_filename: string;
  media_type: MediaType;
  format: MediaFormat;
  content_type: string;
  byte_size: number;
  sha256: string;
  object_key: string;
  created_at: string;
};

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_AUDIO_BYTES = 30 * 1024 * 1024;

const formatConfiguration: Record<MediaFormat, { mediaType: MediaType; contentType: string }> = {
  mp4: { mediaType: "video", contentType: "video/mp4" },
  webm: { mediaType: "video", contentType: "video/webm" },
  mp3: { mediaType: "audio", contentType: "audio/mpeg" },
  wav: { mediaType: "audio", contentType: "audio/wav" },
  ogg: { mediaType: "audio", contentType: "audio/ogg" },
  m4a: { mediaType: "audio", contentType: "audio/mp4" },
  aac: { mediaType: "audio", contentType: "audio/aac" },
};

const requireMediaStorage = (env: AppEnv) => {
  if (!env.PROJECT_FILES) {
    throw new AppError(
      503,
      "media_storage_not_configured",
      "Project file storage is not configured for this deployment. Configure the PROJECT_FILES object-storage binding before uploading or loading video and audio resources.",
    );
  }
  return env.PROJECT_FILES;
};

const validateFilename = (
  value: string | null,
): { filename: string; format: MediaFormat; mediaType: MediaType; contentType: string } => {
  if (!value) {
    throw new AppError(400, "missing_media_filename", "Video and audio uploads require a filename query parameter.");
  }
  const filename = value.trim();
  if (
    filename.length < 1
    || filename.length > 240
    || filename.includes("/")
    || filename.includes("\\")
    || filename.includes("\0")
  ) {
    throw new AppError(400, "invalid_media_filename", "The media filename must be a plain filename of at most 240 characters.");
  }
  const extension = filename.split(".").at(-1)?.toLowerCase() as MediaFormat | undefined;
  const configuration = extension ? formatConfiguration[extension] : undefined;
  if (!extension || !configuration) {
    throw new AppError(
      415,
      "unsupported_media_format",
      "Videos support MP4 and WebM. Audio supports MP3, WAV, OGG, M4A and AAC.",
    );
  }
  return { filename, format: extension, ...configuration };
};

const matchesAscii = (bytes: Uint8Array, offset: number, value: string): boolean =>
  value.split("").every((character, index) => bytes[offset + index] === character.charCodeAt(0));

const validateSignature = (bytes: Uint8Array, format: MediaFormat) => {
  const isIsoMedia = bytes.byteLength >= 12 && matchesAscii(bytes, 4, "ftyp");
  const isWebm = bytes.byteLength >= 4
    && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  const isMp3 = bytes.byteLength >= 3 && (
    matchesAscii(bytes, 0, "ID3")
    || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  );
  const isWav = bytes.byteLength >= 12 && matchesAscii(bytes, 0, "RIFF") && matchesAscii(bytes, 8, "WAVE");
  const isOgg = bytes.byteLength >= 4 && matchesAscii(bytes, 0, "OggS");
  const isAac = bytes.byteLength >= 2 && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
  const valid = format === "mp4" || format === "m4a"
    ? isIsoMedia
    : format === "webm"
      ? isWebm
      : format === "mp3"
        ? isMp3
        : format === "wav"
          ? isWav
          : format === "ogg"
            ? isOgg
            : isAac;
  if (!valid) {
    throw new AppError(
      415,
      "media_extension_mismatch",
      `The file content does not match the .${format} filename extension.`,
    );
  }
};

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", source));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
};

const presentMediaAsset = (row: MediaAssetRow): MediaAsset => ({
  id: row.id,
  projectId: row.project_id,
  originalFilename: row.original_filename,
  mediaType: row.media_type,
  format: row.format,
  contentType: row.content_type,
  byteSize: row.byte_size,
  sha256: row.sha256,
  source: "upload",
  usage: emptyResourceUsage(),
  createdAt: row.created_at,
});

const selectColumns =
  "id, project_id, original_filename, media_type, format, content_type, byte_size, sha256, object_key, created_at";

export const listMediaAssets = async (env: AppEnv, projectId: string): Promise<MediaAsset[]> => {
  const [result, usageByResourceId] = await Promise.all([
    env.DB.prepare(
      `SELECT ${selectColumns} FROM media_assets WHERE project_id = ? ORDER BY created_at DESC, id DESC`,
    ).bind(projectId).all<MediaAssetRow>(),
    listProjectResourceUsage(env, projectId),
  ]);
  return result.results.map((row) => ({
    ...presentMediaAsset(row),
    usage: resourceUsageFor(usageByResourceId, row.id),
  }));
};

const getMediaAssetRow = async (env: AppEnv, projectId: string, assetId: string): Promise<MediaAssetRow> => {
  const row = await env.DB.prepare(
    `SELECT ${selectColumns} FROM media_assets WHERE project_id = ? AND id = ?`,
  ).bind(projectId, assetId).first<MediaAssetRow>();
  if (!row) {
    throw new AppError(404, "media_asset_not_found", "The requested video or audio resource was not found in this project.");
  }
  return row;
};

export const uploadMediaAsset = async (
  request: Request,
  env: AppEnv,
  projectId: string,
  userId: string,
  rawFilename: string | null,
): Promise<MediaAsset> => {
  const storage = requireMediaStorage(env);
  const { filename, format, mediaType, contentType } = validateFilename(rawFilename);
  const maximumBytes = mediaType === "video" ? MAX_VIDEO_BYTES : MAX_AUDIO_BYTES;
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new AppError(413, "media_file_too_large", `${mediaType === "video" ? "Video" : "Audio"} files cannot exceed ${maximumBytes} bytes.`);
  }

  const buffer = await request.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new AppError(400, "empty_media_file", "The uploaded media file is empty.");
  }
  if (buffer.byteLength > maximumBytes) {
    throw new AppError(413, "media_file_too_large", `${mediaType === "video" ? "Video" : "Audio"} files cannot exceed ${maximumBytes} bytes.`);
  }
  const bytes = new Uint8Array(buffer);
  validateSignature(bytes, format);
  const sha256 = await sha256Hex(bytes);
  const assetId = crypto.randomUUID();
  const objectKey = `media/${projectId}/${assetId}/original.${format}`;
  const now = new Date().toISOString();

  await storage.put(objectKey, buffer, {
    httpMetadata: { contentType },
    customMetadata: { assetId, projectId, sha256, originalFilename: filename, mediaType },
  });
  try {
    await env.DB.prepare(
      `INSERT INTO media_assets
       (id, project_id, original_filename, media_type, format, content_type, byte_size, sha256, object_key, created_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(assetId, projectId, filename, mediaType, format, contentType, buffer.byteLength, sha256, objectKey, userId, now).run();
  } catch (error) {
    await storage.delete(objectKey);
    throw new AppError(
      500,
      "media_asset_metadata_write_failed",
      `The media file was validated but its metadata could not be saved: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return {
    id: assetId,
    projectId,
    originalFilename: filename,
    mediaType,
    format,
    contentType,
    byteSize: buffer.byteLength,
    sha256,
    source: "upload",
    usage: emptyResourceUsage(),
    createdAt: now,
  };
};

export const mediaAssetContentResponse = async (
  request: Request,
  env: AppEnv,
  projectId: string,
  assetId: string,
): Promise<Response> => {
  const storage = requireMediaStorage(env);
  const row = await getMediaAssetRow(env, projectId, assetId);
  const object = await storage.get(row.object_key);
  if (!object) {
    throw new AppError(500, "media_asset_object_missing", `Media resource ${assetId} exists in D1 but its object is missing from storage.`);
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

export const deleteMediaAsset = async (
  env: AppEnv,
  projectId: string,
  assetId: string,
  confirmedReferencedDeletion: boolean,
): Promise<MediaAssetDeletion> => {
  const row = await getMediaAssetRow(env, projectId, assetId);
  const usage = resourceUsageFor(await listProjectResourceUsage(env, projectId), assetId);
  requireResourceDeletionConfirmation(row.original_filename, usage, confirmedReferencedDeletion);

  const result = await env.DB.prepare(
    "DELETE FROM media_assets WHERE project_id = ? AND id = ?",
  ).bind(projectId, assetId).run();
  if (result.meta?.changes !== 1) {
    throw new AppError(409, "media_asset_delete_conflict", "The media resource could not be deleted because it changed or was already deleted.");
  }

  let warning: string | null = null;
  if (!env.PROJECT_FILES) {
    warning = "The media metadata was deleted, but its object could not be removed because PROJECT_FILES storage is not configured.";
  } else {
    try {
      await env.PROJECT_FILES.delete(row.object_key);
    } catch (error) {
      warning = `The media metadata was deleted, but object-storage cleanup failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  return { deletedMediaAssetId: assetId, usage, warning };
};
