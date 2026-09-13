import { AppError } from "./auth";

/** Enforce the limit while streaming, including requests without Content-Length. */
export async function readUploadBytes(request: Request, limit: number, code: string): Promise<Uint8Array> {
  const message = `${code === "request_body_too_large" ? "请求体" : "文件"}不能超过 ${limit} 字节。`;
  if (Number(request.headers.get("content-length")) > limit) throw new AppError(413, code, message);
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const result = await reader.read(); if (result.done) break;
      size += result.value.byteLength;
      if (size > limit) { await reader.cancel("Upload size limit exceeded"); throw new AppError(413, code, message); }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
