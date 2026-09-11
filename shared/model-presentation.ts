/** Lightweight, versioned scene settings shared by the editor and API. */
export type ModelPresentation = {
  lighting: "standard" | "studio";
  shellMode: "original" | "solid" | "hidden";
  showFlow: boolean;
  explosion: number;
};

export const defaultModelPresentation: ModelPresentation = {
  lighting: "standard", shellMode: "original", showFlow: true, explosion: 0,
};

export const parseModelPresentation = (input: unknown):
  { ok: true; value: ModelPresentation } | { ok: false; message: string } => {
  // Missing values are the documented migration for pre-presentation canvases.
  if (input === undefined) return { ok: true, value: { ...defaultModelPresentation } };
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, message: "presentation 必须是对象" };
  }
  const value = input as Record<string, unknown>;
  if (value.lighting !== "standard" && value.lighting !== "studio") {
    return { ok: false, message: "presentation.lighting 必须是 standard 或 studio" };
  }
  if (!["original", "solid", "hidden"].includes(value.shellMode as string)) {
    return { ok: false, message: "presentation.shellMode 必须是 original、solid 或 hidden" };
  }
  if (typeof value.showFlow !== "boolean") {
    return { ok: false, message: "presentation.showFlow 必须是布尔值" };
  }
  if (typeof value.explosion !== "number" || !Number.isFinite(value.explosion)
    || value.explosion < 0 || value.explosion > 1) {
    return { ok: false, message: "presentation.explosion 必须是 0–1 之间的数值" };
  }
  return { ok: true, value: {
    lighting: value.lighting, shellMode: value.shellMode as ModelPresentation["shellMode"],
    showFlow: value.showFlow, explosion: value.explosion,
  } };
};
