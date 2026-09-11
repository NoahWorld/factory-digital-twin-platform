export type SceneBackgroundMode = "single-image" | "site-capture";

export type SceneBackgroundQuality = "lightweight" | "balanced" | "detail";

export type SceneBackgroundMovement = "fixed" | "limited" | "free";

export type SceneBackgroundFile = {
  name: string;
  size: number;
  type: string;
};

export type SceneBackgroundValidation = {
  errors: string[];
  inputKind: "none" | "image" | "image-set" | "video";
  totalBytes: number;
  warnings: string[];
};

export const SCENE_BACKGROUND_LIMITS = {
  imageBytes: 8 * 1024 * 1024,
  maximumCaptureImages: 120,
  maximumCaptureTotalBytes: 500 * 1024 * 1024,
  minimumCaptureImages: 8,
  videoBytes: 100 * 1024 * 1024,
} as const;

const imageExtensions = new Set(["jpeg", "jpg", "png", "webp"]);
const videoExtensions = new Set(["mp4", "webm"]);

const extensionOf = (filename: string): string =>
  filename.includes(".") ? filename.split(".").at(-1)?.toLowerCase() ?? "" : "";

const isImage = (file: SceneBackgroundFile): boolean => imageExtensions.has(extensionOf(file.name));
const isVideo = (file: SceneBackgroundFile): boolean => videoExtensions.has(extensionOf(file.name));

export function sceneBackgroundResourceKind(filename: string): "image" | "video" {
  const extension = extensionOf(filename);
  if (imageExtensions.has(extension)) return "image";
  if (videoExtensions.has(extension)) return "video";
  throw new Error(`场景底座素材“${filename}”不是受支持的图片或视频。`);
}

export const modeFileAccept = (mode: SceneBackgroundMode): string =>
  mode === "single-image"
    ? ".png,.jpg,.jpeg,.webp"
    : ".png,.jpg,.jpeg,.webp,.mp4,.webm";

export function validateSceneBackgroundFiles(
  mode: SceneBackgroundMode,
  files: readonly SceneBackgroundFile[],
): SceneBackgroundValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  let inputKind: SceneBackgroundValidation["inputKind"] = "none";

  if (files.length === 0) {
    return { errors: ["请先添加现场素材。"], inputKind, totalBytes, warnings };
  }

  const invalidNames = files.filter((file) => (
    file.name.length < 1
    || file.name.length > 240
    || file.name.includes("/")
    || file.name.includes("\\")
    || file.name.includes("\0")
  ));
  if (invalidNames.length > 0) {
    errors.push("文件名必须是长度不超过 240 个字符的普通文件名。");
  }

  const duplicateNames = files.filter((file, index) =>
    files.findIndex((candidate) => candidate.name.toLowerCase() === file.name.toLowerCase()) !== index,
  );
  if (duplicateNames.length > 0) {
    errors.push("素材中存在同名文件，请重命名后重新选择。");
  }

  if (files.some((file) => file.size <= 0)) {
    errors.push("不能使用空文件。");
  }

  if (mode === "single-image") {
    inputKind = "image";
    if (files.length !== 1) {
      errors.push("极速背景只能使用 1 张图片。");
    }
    if (files.some((file) => !isImage(file))) {
      errors.push("极速背景仅支持 PNG、JPEG 和 WebP 图片。");
    }
    if (files.some((file) => file.size > SCENE_BACKGROUND_LIMITS.imageBytes)) {
      errors.push("单张图片不能超过 8 MB。");
    }
    warnings.push("单图无法提供被遮挡区域，生成结果只适合固定视角或小范围镜头移动。");
  } else {
    const videos = files.filter(isVideo);
    const images = files.filter(isImage);
    const unsupported = files.length - videos.length - images.length;

    if (unsupported > 0) {
      errors.push("写实漫游仅支持 MP4、WebM 视频或 PNG、JPEG、WebP 图片。");
    }
    if (videos.length > 0 && images.length > 0) {
      errors.push("一次任务不能混合视频和图片，请选择其中一种采集方式。");
    } else if (videos.length > 0) {
      inputKind = "video";
      if (videos.length !== 1 || files.length !== 1) {
        errors.push("视频采集一次只能提交 1 个视频。");
      }
      if (videos.some((file) => file.size > SCENE_BACKGROUND_LIMITS.videoBytes)) {
        errors.push("环拍视频不能超过 100 MB。");
      }
      warnings.push("请保持缓慢移动并从不同方向覆盖现场，避免快速转身、强反光和大面积运动物体。");
    } else {
      inputKind = "image-set";
      if (
        images.length < SCENE_BACKGROUND_LIMITS.minimumCaptureImages
        || images.length > SCENE_BACKGROUND_LIMITS.maximumCaptureImages
      ) {
        errors.push("多图重建需要 8–120 张有重叠视角的图片。");
      }
      if (images.some((file) => file.size > SCENE_BACKGROUND_LIMITS.imageBytes)) {
        errors.push("单张图片不能超过 8 MB。");
      }
      if (totalBytes > SCENE_BACKGROUND_LIMITS.maximumCaptureTotalBytes) {
        errors.push("多图素材总大小不能超过 500 MB。");
      }
      warnings.push("相邻照片应有充分重叠，并从多个高度和方向覆盖墙角、通道与主要建筑。");
    }
  }

  return {
    errors: errors.map((message) => message.trim()),
    inputKind,
    totalBytes,
    warnings: warnings.map((message) => message.trim()),
  };
}

export const validateSceneBackgroundName = (name: string): string | null => {
  const trimmed = name.trim();
  if (trimmed.length < 2) return "场景名称至少需要 2 个字符。";
  if (trimmed.length > 80) return "场景名称不能超过 80 个字符。";
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\0")) {
    return "场景名称不能包含路径分隔符。";
  }
  return null;
};

export const validateKnownScale = (value: string): string | null => {
  if (value.trim() === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 100_000) {
    return "已知尺寸必须是大于 0 且不超过 100000 米的数字。";
  }
  return null;
};
