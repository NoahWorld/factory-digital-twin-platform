import { ApiRequestError, request } from "../api";
import { formatFileSize } from "../canvas/model-assets";
import { SCENE_BACKGROUND_LIMITS, type SceneBackgroundFile, type SceneBackgroundValidation } from "./scene-background";

export type CaptureResult = {
  format: "ply"; byteSize: number; gaussianCount: number;
  bounds: { min: number[]; max: number[] };
  initialCamera: { position: number[]; target: number[]; up: number[] };
  quality: { inputImages: number; registeredImages: number; points3D: number; meanReprojectionError: number };
  warnings: string[];
};
export type CaptureJob = {
  id: string; name: string; inputKind: "images" | "video";
  status: "uploading" | "queued" | "running" | "succeeded" | "failed" | "canceled";
  stage: string; completed: number; total: number;
  files: { index: number; filename: string; byteSize: number; contentType: string; uploaded: boolean }[];
  createdAt: string; updatedAt: string; errorCode: string | null; errorMessage: string | null; result: CaptureResult | null;
};
export type CaptureCapabilities = {
  available: boolean; reason: string | null; minImages: number; maxImages: number;
  maxImageBytes: number; maxVideoBytes: number; maxTotalBytes: number; maxOutputBytes: number;
};
export const captureBase = (projectId: string) => `/api/v1/projects/${encodeURIComponent(projectId)}/site-captures`;
export const captureStatus: Record<CaptureJob["status"], string> = {
  uploading: "准备素材", queued: "等待重建", running: "正在重建", succeeded: "可进入漫游", failed: "重建未完成", canceled: "已取消",
};
export const captureStage: Record<string, string> = {
  uploading: "上传素材", queued: "等待 GPU 工作节点", downloading: "读取素材", validating: "检查画面",
  extracting: "提取视频帧", matching: "匹配多视角特征", reconstructing: "求解相机与空间",
  training: "优化写实场景", exporting: "导出漫游场景", succeeded: "生成完成", failed: "重建未完成", canceled: "已取消",
};
export const captureMime = (file: File) => {
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  const types: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4", webm: "video/webm" };
  if (!extension || !types[extension]) throw new ApiRequestError("invalid_input", undefined, "Unsupported capture source extension.");
  return types[extension];
};
export function validateCaptureFiles(files: readonly SceneBackgroundFile[], capabilities: CaptureCapabilities | null): SceneBackgroundValidation {
  // Published limits remain visible while capabilities load; upload stays disabled until the API is available.
  const limits = capabilities ?? {
    minImages: SCENE_BACKGROUND_LIMITS.minimumCaptureImages, maxImages: SCENE_BACKGROUND_LIMITS.maximumCaptureImages,
    maxImageBytes: SCENE_BACKGROUND_LIMITS.imageBytes, maxVideoBytes: SCENE_BACKGROUND_LIMITS.videoBytes,
    maxTotalBytes: SCENE_BACKGROUND_LIMITS.maximumCaptureTotalBytes,
  };
  const errors: string[] = [];
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (!files.length) return { errors: ["请先添加现场素材。"], inputKind: "none", totalBytes, warnings: [] };
  const names = new Set<string>();
  let images = 0, videos = 0;
  for (const file of files) {
    if (!file.name || file.name.length > 240 || /[/\\\0]/.test(file.name)) errors.push("文件名必须是长度不超过 240 个字符的普通文件名。");
    if (names.has(file.name.toLowerCase())) errors.push("素材中存在同名文件，请重命名后重新选择。");
    names.add(file.name.toLowerCase());
    if (!Number.isSafeInteger(file.size) || file.size <= 0) errors.push("不能使用空文件或大小无效的文件。");
    const extension = file.name.split(".").at(-1)?.toLowerCase();
    if (["jpg", "jpeg", "png", "webp"].includes(extension ?? "")) {
      images++;
      if (file.size > limits.maxImageBytes) errors.push(`单张图片不能超过 ${formatFileSize(limits.maxImageBytes)}。`);
    } else if (["mp4", "webm"].includes(extension ?? "")) {
      videos++;
      if (file.size > limits.maxVideoBytes) errors.push(`采集视频不能超过 ${formatFileSize(limits.maxVideoBytes)}。`);
    } else errors.push("写实漫游仅支持 MP4、WebM 视频或 PNG、JPEG、WebP 图片。");
  }
  if (videos && images) errors.push("一次任务不能混合视频和图片，请选择其中一种采集方式。");
  if (videos && (videos !== 1 || files.length !== 1)) errors.push("视频采集一次只能提交 1 个视频。");
  if (!videos && (images < limits.minImages || images > limits.maxImages)) errors.push(`照片导入需要 ${limits.minImages}–${limits.maxImages} 张图片；请按采集要求准备重叠视角。`);
  if (totalBytes > limits.maxTotalBytes) errors.push(`素材总大小不能超过 ${formatFileSize(limits.maxTotalBytes)}。`);
  return { errors: [...new Set(errors)], inputKind: videos ? "video" : "image-set", totalBytes, warnings: [] };
}
export async function captureRequest<T>(path: string, init: RequestInit = {}, timeoutMs = 20000): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try { return await request<T>(path, { ...init, signal: controller.signal }); }
  catch (reason) {
    if (timedOut) throw new ApiRequestError("network_error", undefined, "Capture request timed out.", { path, method: init.method ?? "GET", cause: reason });
    throw reason;
  } finally { window.clearTimeout(timer); init.signal?.removeEventListener("abort", abort); }
}
export function checkedCapabilities(value: CaptureCapabilities): CaptureCapabilities {
  if (!value || typeof value.available !== "boolean" || ![value.minImages, value.maxImages, value.maxImageBytes, value.maxVideoBytes, value.maxTotalBytes, value.maxOutputBytes].every(n => Number.isSafeInteger(n) && n > 0)
    || value.minImages > value.maxImages || value.maxImageBytes > value.maxTotalBytes || value.maxVideoBytes > value.maxTotalBytes
    || !(value.reason === null || typeof value.reason === "string")) {
    throw new ApiRequestError("invalid_response", undefined, "Invalid capture capabilities.");
  }
  return value;
}
export function checkedJob(value: CaptureJob): CaptureJob {
  const vector = (v: unknown): v is number[] => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  const count = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
  const result = value?.result;
  const quality = result?.quality;
  const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
  if (!value || typeof value.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.id) || typeof value.name !== "string" || !value.name.trim() || !Object.hasOwn(captureStatus, value.status) || !Array.isArray(value.files) || !value.files.length
    || !["images", "video"].includes(value.inputKind) || typeof value.stage !== "string" || !value.stage || !count(value.completed) || !count(value.total) || value.completed > value.total
    || !date(value.createdAt) || !date(value.updatedAt) || !(value.errorCode === null || typeof value.errorCode === "string" && /^[a-z][a-z0-9_]{0,119}$/.test(value.errorCode)) || !(value.errorMessage === null || typeof value.errorMessage === "string")
    || !value.files.every((f, i) => f && f.index === i && typeof f.filename === "string" && f.filename.length > 0 && f.filename.length <= 240 && !/[/\\\0]/.test(f.filename) && count(f.byteSize) && f.byteSize > 0 && (value.inputKind === "video" ? ["video/mp4", "video/webm"] : ["image/jpeg", "image/png", "image/webp"]).includes(f.contentType) && typeof f.uploaded === "boolean")
    || new Set(value.files.map(f => f.filename.toLowerCase())).size !== value.files.length || (value.inputKind === "video" && value.files.length !== 1)
    || (value.status === "succeeded" && (!result || result.format !== "ply" || !count(result.byteSize) || !result.byteSize || result.byteSize > 200 * 1024 * 1024 || !count(result.gaussianCount) || !result.gaussianCount || result.gaussianCount > 1_000_000
      || !vector(result.bounds?.min) || !vector(result.bounds?.max) || !vector(result.initialCamera?.position) || !vector(result.initialCamera?.target) || !vector(result.initialCamera?.up)
      || !quality || !count(quality.inputImages) || !quality.inputImages || !count(quality.registeredImages) || !quality.registeredImages || quality.registeredImages > quality.inputImages || !count(quality.points3D) || !quality.points3D || !Number.isFinite(quality.meanReprojectionError) || quality.meanReprojectionError < 0
      || !Array.isArray(result.warnings) || !result.warnings.every(w => typeof w === "string")))) {
    throw new ApiRequestError("invalid_response", undefined, "Invalid capture job response.");
  }
  if (value.status === "succeeded" && result) {
    const delta = (a: number[], b: number[]) => a.map((n, i) => n - b[i]);
    const span = delta(result.bounds.max, result.bounds.min), direction = delta(result.initialCamera.target, result.initialCamera.position), up = result.initialCamera.up;
    const cross = [direction[1] * up[2] - direction[2] * up[1], direction[2] * up[0] - direction[0] * up[2], direction[0] * up[1] - direction[1] * up[0]];
    if (span.some(n => n < 0) || ![Math.hypot(...span), Math.hypot(...direction), Math.hypot(...up), Math.hypot(...cross)].every(n => Number.isFinite(n) && n > 1e-12)) {
      throw new ApiRequestError("invalid_response", undefined, "Invalid capture result geometry or camera.");
    }
  }
  return value;
}
