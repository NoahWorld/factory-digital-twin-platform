import { captureCoverSurface } from "./render-surfaces";

export const COVER_WIDTH = 960;
export const COVER_HEIGHT = 540;
export const MAX_COVER_BYTES = 2 * 1024 * 1024;

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function waitForCoverContent(root: HTMLElement, signal: AbortSignal): Promise<void> {
  await abortable(document.fonts.ready, signal);
  await abortable(frame(), signal);
  for (;;) {
    signal.throwIfAborted();
    const failed = root.querySelector<HTMLElement>('[data-cover-state="error"], [role="alert"]');
    if (failed) throw new Error(failed.textContent?.trim() || "项目内容加载失败，无法截图。");
    const loading = root.querySelector('[data-cover-state="loading"]');
    const images = [...root.querySelectorAll("img")];
    const broken = images.find((img) => img.complete && img.naturalWidth === 0);
    if (broken) throw new Error(`项目图片加载失败：${broken.getAttribute("src")}`);
    if (!loading && images.every((img) => img.complete)) {
      await abortable(Promise.all(images.map((img) => img.decode())), signal);
      await abortable(frame(), signal);
      signal.throwIfAborted();
      return;
    }
    await abortable(new Promise((resolve) => setTimeout(resolve, 100)), signal);
  }
}

/** Only the disposable cover stage is frozen, never the user's editor or its live canvas. */
export async function captureProjectContent(root: HTMLElement, type: "2d" | "3d", signal: AbortSignal): Promise<Blob> {
  await waitForCoverContent(root, signal);
  const restores: Array<() => void> = [];
  try {
    for (const canvas of root.querySelectorAll("canvas")) {
      const image = new Image();
      image.src = captureCoverSurface(canvas);
      image.style.cssText = canvas.style.cssText;
      image.style.width = `${canvas.clientWidth}px`;
      image.style.height = `${canvas.clientHeight}px`;
      image.style.display = "block";
      await abortable(image.decode(), signal);
      signal.throwIfAborted();
      canvas.replaceWith(image);
      restores.push(() => image.replaceWith(canvas));
    }
    const surface = type === "2d" ? root.querySelector<HTMLElement>(".canvas-surface") : root;
    if (!surface) throw new Error("项目截图区域不存在。");
    const width = type === "2d" ? surface.offsetWidth : COVER_WIDTH;
    const height = type === "2d" ? surface.offsetHeight : COVER_HEIGHT;
    if (width / height !== COVER_WIDTH / COVER_HEIGHT) throw new Error("项目截图区域比例不是 16:9。");
    const { domToBlob } = await import("modern-screenshot");
    const resourceErrors: string[] = [];
    const blob = await abortable(domToBlob(surface, {
      width, height, scale: COVER_WIDTH / width, type: "image/png", font: false,
      style: { transform: "none", margin: "0" },
      fetch: {
        requestInit: { credentials: "include", signal },
        placeholderImage: (image) => {
          const message = `截图资源读取失败：${image.getAttribute("src") ?? image.getAttribute("href")}`;
          resourceErrors.push(message);
          throw new Error(message);
        },
      },
    }), signal);
    signal.throwIfAborted();
    if (resourceErrors.length) throw new Error(resourceErrors.join("；"));
    if (!blob || blob.type !== "image/png" || blob.size === 0 || blob.size > MAX_COVER_BYTES) {
      throw new Error("项目截图生成失败或超过 2 MiB 上限。");
    }
    return blob;
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
}
