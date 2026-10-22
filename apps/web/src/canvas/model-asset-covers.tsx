import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { findBuiltinModel } from "../../../../shared/builtin-models";
import { captureCoverSurface } from "../covers/render-surfaces";
import { IOT_SESSION_EVENT, IOT_TOKEN_KEY, readIotToken } from "../iot/session";
import { ApiRequestError, reportError } from "../errors";
import { createModelAssetCoverQueue, ModelAssetCoverError } from "./model-asset-cover-queue";
import type { ModelAsset } from "./model-assets";
import { createCanvasNode } from "./types";
import { Model3DNode } from "./Model3DNode";

export type { ModelAssetCoverState } from "./model-asset-cover-queue";
export type ModelAssetCoverInput = { asset: ModelAsset; projectId: string };
const WIDTH = 480;
const HEIGHT = 270;
const RENDER_VERSION = 1;
const ignoreSelection = () => undefined;

function waitForModel(host: HTMLElement, signal: AbortSignal): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const finish = (reason?: unknown, canvas?: HTMLCanvasElement) => {
      observer.disconnect();
      signal.removeEventListener("abort", abort);
      host.removeEventListener("model-cover-render-error", renderError);
      if (reason) reject(reason);
      else resolve(canvas!);
    };
    const abort = () => finish(signal.reason);
    const renderError = () => finish(new ModelAssetCoverError("model_cover_component_failed", "模型封面渲染组件异常，请重试。"));
    const inspect = () => {
      if (signal.aborted) { abort(); return; }
      const state = host.querySelector<HTMLElement>("[data-cover-state]");
      if (state?.dataset.coverState === "error") {
        // The renderer already reports the detailed, scrubbed underlying error.
        finish(new ModelAssetCoverError("model_cover_model_unavailable", "模型无法加载，封面生成失败；请打开预览检查模型。"));
      } else if (state?.dataset.coverState === "ready") {
        const canvas = state.querySelector("canvas");
        if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
          finish(new ModelAssetCoverError("model_cover_surface_missing", "模型已加载，但封面画布不可用。"));
        } else finish(undefined, canvas);
      }
    };
    const observer = new MutationObserver(inspect);
    observer.observe(host, { attributes: true, childList: true, subtree: true, attributeFilter: ["data-cover-state"] });
    signal.addEventListener("abort", abort, { once: true });
    host.addEventListener("model-cover-render-error", renderError, { once: true });
    inspect();
  });
}

function makeCoverImage(source: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener("abort", abort);
    };
    const abort = () => { cleanup(); image.src = ""; reject(signal.reason); };
    image.onerror = () => { cleanup(); reject(new ModelAssetCoverError("model_cover_image_invalid", "模型封面图像解码失败。")); };
    image.onload = () => {
      cleanup();
      try {
        signal.throwIfAborted();
        const canvas = document.createElement("canvas");
        canvas.width = WIDTH;
        canvas.height = HEIGHT;
        const context = canvas.getContext("2d");
        if (!context) throw new ModelAssetCoverError("model_cover_canvas_unavailable", "当前浏览器无法生成模型封面。");
        context.drawImage(image, 0, 0, WIDTH, HEIGHT);
        const pixels = context.getImageData(0, 0, WIDTH, HEIGHT).data;
        let visiblePixels = 0;
        for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) visiblePixels++;
        if (!visiblePixels) throw new ModelAssetCoverError("model_cover_empty", "模型未渲染出可见内容，无法生成封面。");
        resolve(canvas.toDataURL("image/png"));
      } catch (reason) { reject(reason); }
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else image.src = source;
  });
}

async function renderCover({ asset, projectId }: ModelAssetCoverInput, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const host = document.createElement("div");
  host.dataset.modelCoverCapture = asset.id;
  host.setAttribute("aria-hidden", "true");
  host.inert = true;
  Object.assign(host.style, {
    position: "fixed", top: "0", left: "0", width: `${WIDTH}px`, height: `${HEIGHT}px`,
    opacity: "0", pointerEvents: "none", overflow: "hidden", zIndex: "-1",
  });
  let root: Root | null = null;
  let screenshot: string;
  try {
    document.body.append(host);
    root = createRoot(host, {
      onUncaughtError: (reason) => {
        reportError(reason, { operation: "model.cover.component", projectId, assetId: asset.id });
        host.dispatchEvent(new Event("model-cover-render-error"));
      },
    });
    const base = createCanvasNode("model-3d", 0, 0, 1);
    const node = {
      ...base, width: WIDTH, height: HEIGHT, resourceRefs: [asset.id],
      props: {
        ...base.props, ...findBuiltinModel(asset.id)?.defaults,
        ...(asset.source === "scene-background" ? { cameraView: "front", modelScale: 2.2 } : {}),
        backgroundOpacity: 0, autoRotate: false, playAnimations: false, showGrid: false,
      },
    };
    root.render(createElement(Model3DNode, {
      node, projectId, editable: false, cameraControlsEnabled: false, runtimeControlsEnabled: false,
      selectedSceneNodePath: null, onSceneNodeSelect: ignoreSelection, selectionStyle: "none",
    }));
    const canvas = await waitForModel(host, signal);
    signal.throwIfAborted();
    screenshot = captureCoverSurface(canvas);
  } finally {
    // Unmount aborts resource requests and releases the shared renderer's model, textures and WebGL context.
    try { root?.unmount(); }
    finally { host.remove(); }
  }
  signal.throwIfAborted();
  return makeCoverImage(screenshot, signal);
}

const queue = createModelAssetCoverQueue<ModelAssetCoverInput>({
  key: ({ asset, projectId }) => JSON.stringify([projectId, asset.id, asset.sha256, asset.source, RENDER_VERSION]),
  session: readIotToken,
  render: renderCover,
  report: ({ asset, projectId }, error, cause) => {
    const context = { operation: "model.cover", projectId, assetId: asset.id };
    if (cause !== error) reportError(cause, context);
    reportError(new ApiRequestError(error.code, undefined, error.message), context);
  },
});
let listening = false;
function ensureSessionListeners() {
  if (listening) return;
  listening = true;
  window.addEventListener(IOT_SESSION_EVENT, queue.invalidateSession);
  window.addEventListener("storage", (event) => {
    if (event.key === IOT_TOKEN_KEY || event.key === null) queue.syncSession();
  });
  window.addEventListener("focus", queue.syncSession);
}

export const subscribeModelAssetCover: typeof queue.subscribe = (input, callback) => {
  ensureSessionListeners();
  return queue.subscribe(input, callback);
};
export const invalidateModelAssetCover = queue.invalidate;
