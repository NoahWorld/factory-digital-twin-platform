const surfaces = new WeakMap<HTMLCanvasElement, () => string>();

/** A renderer owns capture while its canvas is mounted; disposal must unregister it. */
export function registerCoverSurface(canvas: HTMLCanvasElement, capture: () => string): () => void {
  if (surfaces.has(canvas)) throw new Error("封面渲染表面已注册，不能重复绑定同一画布");
  surfaces.set(canvas, capture);
  return () => {
    if (surfaces.get(canvas) === capture) surfaces.delete(canvas);
  };
}

/** Capture must render and read pixels synchronously before WebGL clears its buffer. */
export function captureCoverSurface(canvas: HTMLCanvasElement): string {
  const capture = surfaces.get(canvas);
  if (!capture) throw new Error("封面渲染表面未注册或已释放，不能读取过期的 WebGL 画布");
  const dataUrl = capture();
  if (!dataUrl.startsWith("data:image/png;base64,") || dataUrl.length === "data:image/png;base64,".length) {
    throw new Error("封面渲染表面没有返回有效的 PNG 图像");
  }
  return dataUrl;
}
