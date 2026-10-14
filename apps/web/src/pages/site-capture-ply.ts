import { Color, Quaternion, Vector3 } from "three";
import { ExtSplats } from "@sparkjsdev/spark";
import { ApiRequestError, apiUrl, UserFacingError } from "../api";

export const SITE_CAPTURE_VIEWER_MAX_BYTES = 200 * 1024 * 1024;
export const SITE_CAPTURE_VIEWER_MAX_GAUSSIANS = 1_000_000;
const CONTENT_IDLE_TIMEOUT_MS = 30_000;

/** Only the versioned reconstruction output, not an arbitrary PLY/mesh importer. */
export type SiteCaptureViewerResult = {
  byteSize: number;
  gaussianCount: number;
  bounds: { min: number[]; max: number[] };
  initialCamera: { position: number[]; target: number[]; up: number[] };
};

export function validateCaptureResult(result: SiteCaptureViewerResult): number {
  const vector = (value: number[]) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
  if (!Number.isSafeInteger(result.byteSize) || result.byteSize < 1 || result.byteSize > SITE_CAPTURE_VIEWER_MAX_BYTES
    || !Number.isSafeInteger(result.gaussianCount) || result.gaussianCount < 1 || result.gaussianCount > SITE_CAPTURE_VIEWER_MAX_GAUSSIANS
    || !result.bounds || !vector(result.bounds.min) || !vector(result.bounds.max)
    || result.bounds.min.some((value, index) => value > result.bounds.max[index])
    || !result.initialCamera || !vector(result.initialCamera.position) || !vector(result.initialCamera.target) || !vector(result.initialCamera.up)) {
    throw new UserFacingError("漫游结果的大小、数量或相机信息不完整，请联系管理员检查重建结果。");
  }
  const direction = new Vector3().fromArray(result.initialCamera.target).sub(new Vector3().fromArray(result.initialCamera.position));
  const up = new Vector3().fromArray(result.initialCamera.up);
  const extent = new Vector3().fromArray(result.bounds.max).distanceTo(new Vector3().fromArray(result.bounds.min));
  if (!Number.isFinite(extent) || extent <= 0 || direction.lengthSq() < 1e-12 || up.lengthSq() < 1e-12
    || direction.clone().normalize().cross(up.clone().normalize()).lengthSq() < 1e-8) {
    throw new UserFacingError("漫游结果的范围或初始视角无效，请联系管理员检查重建结果。");
  }
  return extent;
}

export async function fetchCapturePly(path: string, expectedBytes: number, signal: AbortSignal, onBytes: (bytes: number) => void): Promise<ArrayBuffer> {
  // An authenticated result must stay on the configured project API. Never send cookies to a supplied external URL.
  if (!/^\/api\/v1\/projects\/[^/?#]+\/site-captures\/[^/?#]+\/content$/.test(path)) {
    throw new UserFacingError("漫游结果地址不符合项目资源约定，请联系管理员。");
  }
  const controller = new AbortController();
  let timedOut = false, idleTimer = 0;
  const abort = () => controller.abort(signal.reason);
  const resetIdleTimer = () => {
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => { timedOut = true; controller.abort(); }, CONTENT_IDLE_TIMEOUT_MS);
  };
  if (signal.aborted) abort();
  signal.addEventListener("abort", abort, { once: true });
  resetIdleTimer();
  try {
    const response = await fetch(apiUrl(path), { credentials: "include", signal: controller.signal, redirect: "error" });
    if (!response.ok) {
      throw new ApiRequestError("request_failed", response.headers.get("x-request-id") ?? undefined,
        "Capture content HTTP failure", { method: "GET", path, status: response.status });
    }
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) !== expectedBytes)) {
      await response.body?.cancel();
      throw new UserFacingError("漫游文件长度与任务记录不一致，请联系管理员检查结果存储。");
    }
    if (!response.body) throw new UserFacingError("漫游文件响应为空，请重新加载。");
    const reader = response.body.getReader();
    const bytes = new Uint8Array(expectedBytes);
    let loaded = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        controller.signal.throwIfAborted();
        if (done) break;
        if (loaded + value.length > expectedBytes || loaded + value.length > SITE_CAPTURE_VIEWER_MAX_BYTES) {
          await reader.cancel();
          throw new UserFacingError("漫游文件超过任务记录或 200 MiB 读取上限，已停止加载。");
        }
        bytes.set(value, loaded);
        loaded += value.length;
        // A large but progressing file may take longer than 30 seconds overall.
        // Only a connection with no new bytes is considered stalled.
        if (value.length) resetIdleTimer();
        onBytes(loaded);
      }
    } finally { reader.releaseLock(); }
    if (loaded !== expectedBytes) throw new UserFacingError("漫游文件未完整下载，请重新加载。");
    return bytes.buffer;
  } catch (cause) {
    if (signal.aborted || cause instanceof UserFacingError || cause instanceof ApiRequestError) throw cause;
    throw new ApiRequestError("network_error", undefined, timedOut ? "Capture content stalled for 30 seconds." : "Capture content request or stream failed.", { method: "GET", path, cause });
  } finally {
    window.clearTimeout(idleTimer);
    controller.abort();
    signal.removeEventListener("abort", abort);
  }
}

const fields = ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"];
const optionalFields = new Set(["nx", "ny", "nz"]);
const SH0 = 0.28209479177387814;

/** Yield between bounded batches so a large validated result never locks the dialog. */
function yieldToBrowser(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 0);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function decodeCapturePly(bytes: ArrayBuffer, result: SiteCaptureViewerResult, signal: AbortSignal, onDecoded: (count: number) => void): Promise<ExtSplats> {
  const head = new TextDecoder("ascii").decode(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 16_384)));
  const end = head.indexOf("end_header\n");
  const invalid = () => new UserFacingError("漫游结果不是支持的二进制 SH0 高斯 PLY，或文件结构已损坏。请联系管理员检查生成任务。");
  if (!head.startsWith("ply\n") || end < 0) throw invalid();
  const headerBytes = end + "end_header\n".length;
  const lines = head.slice(0, end).trim().split("\n");
  if (lines[1] !== "format binary_little_endian 1.0") throw invalid();
  const properties: string[] = [];
  let count: number | null = null;
  for (const line of lines.slice(2)) {
    if (line.startsWith("comment ") || line.startsWith("obj_info ")) continue;
    const element = /^element vertex (\d+)$/.exec(line);
    if (element) { if (count !== null) throw invalid(); count = Number(element[1]); continue; }
    const property = /^property float (\w+)$/.exec(line);
    if (!property || count === null || properties.includes(property[1]) || (!fields.includes(property[1]) && !optionalFields.has(property[1]))) throw invalid();
    properties.push(property[1]);
  }
  if (count !== result.gaussianCount || fields.some((name) => !properties.includes(name))
    || headerBytes + count * properties.length * 4 !== bytes.byteLength) throw invalid();
  const offsets = fields.map((name) => properties.indexOf(name) * 4);
  const rowSize = properties.length * 4;
  const data = new DataView(bytes);
  const center = new Vector3(), scale = new Vector3(), rotation = new Quaternion(), color = new Color();
  const values = new Array<number>(fields.length);
  const splats = new ExtSplats({ maxSplats: count });
  try {
    await splats.initialized;
    for (let row = 0; row < count; row++) {
      for (let column = 0; column < properties.length; column++) {
        if (!Number.isFinite(data.getFloat32(headerBytes + row * rowSize + column * 4, true))) throw invalid();
      }
      offsets.forEach((offset, index) => { values[index] = data.getFloat32(headerBytes + row * rowSize + offset, true); });
      if (values.slice(7, 10).some((value) => value < -12 || value > 9)) {
        throw new UserFacingError("高斯尺寸超出当前渲染精度范围，请联系管理员重新生成结果。");
      }
      center.set(values[0], values[1], values[2]);
      const tolerance = Math.max(1e-5, center.length() * 1e-6);
      if ([center.x, center.y, center.z].some((value, axis) => value < result.bounds.min[axis] - tolerance || value > result.bounds.max[axis] + tolerance)) throw invalid();
      scale.set(Math.exp(values[7]), Math.exp(values[8]), Math.exp(values[9]));
      rotation.set(values[11], values[12], values[13], values[10]);
      if (rotation.lengthSq() < 1e-12) throw invalid();
      rotation.normalize();
      // PLY SH0 encodes display RGB. Spark applies its own display-space conversion.
      color.setRGB(Math.max(0, Math.min(1, 0.5 + SH0 * values[3])), Math.max(0, Math.min(1, 0.5 + SH0 * values[4])), Math.max(0, Math.min(1, 0.5 + SH0 * values[5])));
      splats.pushSplat(center, scale, rotation, 1 / (1 + Math.exp(-values[6])), color);
      if ((row + 1) % 4096 === 0) { onDecoded(row + 1); await yieldToBrowser(signal); }
    }
    signal.throwIfAborted();
    // ExtSplats.pushSplat updates CPU arrays. Initialize those complete arrays once
    // to create the textures before handing them to the renderer.
    splats.reinitialize({ extArrays: splats.extArrays, numSplats: count });
    await splats.initialized;
    onDecoded(count);
    return splats;
  } catch (error) {
    splats.dispose();
    throw error;
  }
}
