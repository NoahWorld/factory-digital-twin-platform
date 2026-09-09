import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "factory-scene-background-test-"));
const require = createRequire(import.meta.url);

const file = (name, size = 1024, type = "") => ({ name, size, type });

try {
  execFileSync(process.execPath, [
    join(root, "apps/web/node_modules/typescript/bin/tsc"),
    "--target", "ES2022",
    "--module", "commonjs",
    "--moduleResolution", "node",
    "--strict",
    "--skipLibCheck",
    "--outDir", temporary,
    join(root, "apps/web/src/pages/scene-background.ts"),
  ], { cwd: root, stdio: "inherit" });

  const {
    SCENE_BACKGROUND_LIMITS,
    modeFileAccept,
    validateKnownScale,
    validateSceneBackgroundFiles,
    validateSceneBackgroundName,
  } = require(join(temporary, "scene-background.js"));

  assert.equal(modeFileAccept("single-image"), ".png,.jpg,.jpeg,.webp");
  assert.equal(modeFileAccept("site-capture"), ".png,.jpg,.jpeg,.webp,.mp4,.webm");
  assert.match(validateSceneBackgroundFiles("single-image", []).errors.join(" "), /请先添加现场素材/);
  assert.deepEqual(
    validateSceneBackgroundFiles("single-image", [file("factory.WEBP")]).errors,
    [],
    "one supported image should pass the fast-background preflight",
  );
  assert.match(
    validateSceneBackgroundFiles("single-image", [file("front.jpg"), file("side.jpg")]).errors.join(" "),
    /只能使用 1 张图片/,
  );
  assert.match(
    validateSceneBackgroundFiles("single-image", [file("fake.txt")]).errors.join(" "),
    /仅支持 PNG、JPEG 和 WebP/,
  );
  assert.match(
    validateSceneBackgroundFiles("single-image", [
      file("factory.jpg", SCENE_BACKGROUND_LIMITS.imageBytes + 1),
    ]).errors.join(" "),
    /不能超过 8 MB/,
  );
  assert.match(
    validateSceneBackgroundFiles("site-capture", [file("same.jpg"), file("SAME.JPG")]).errors.join(" "),
    /存在同名文件/,
  );
  assert.match(
    validateSceneBackgroundFiles("single-image", [file("empty.png", 0)]).errors.join(" "),
    /不能使用空文件/,
  );

  const overlappingPhotos = Array.from({ length: 8 }, (_, index) => file(`capture-${index}.jpg`));
  const photoValidation = validateSceneBackgroundFiles("site-capture", overlappingPhotos);
  assert.deepEqual(photoValidation.errors, []);
  assert.equal(photoValidation.inputKind, "image-set");
  assert.match(
    validateSceneBackgroundFiles("site-capture", overlappingPhotos.slice(0, 7)).errors.join(" "),
    /需要 8–120 张/,
  );
  assert.match(
    validateSceneBackgroundFiles("site-capture", Array.from({ length: 121 }, (_, index) => file(`extra-${index}.jpg`))).errors.join(" "),
    /需要 8–120 张/,
  );
  assert.match(
    validateSceneBackgroundFiles("site-capture", Array.from({ length: 120 }, (_, index) => file(`large-${index}.jpg`, 5 * 1024 * 1024))).errors.join(" "),
    /总大小不能超过 500 MB/,
  );
  assert.match(
    validateSceneBackgroundFiles("site-capture", [file("capture.mp4"), file("capture.jpg")]).errors.join(" "),
    /不能混合视频和图片/,
  );

  const validVideo = validateSceneBackgroundFiles("site-capture", [file("walkthrough.mp4")]);
  assert.deepEqual(validVideo.errors, []);
  assert.equal(validVideo.inputKind, "video");
  assert.match(
    validateSceneBackgroundFiles("site-capture", [
      file("walkthrough.mp4", SCENE_BACKGROUND_LIMITS.videoBytes + 1),
    ]).errors.join(" "),
    /不能超过 100 MB/,
  );

  assert.equal(validateSceneBackgroundName("厂房底座"), null);
  assert.match(validateSceneBackgroundName("A"), /至少需要 2 个字符/);
  assert.match(validateSceneBackgroundName(" "), /至少需要 2 个字符/);
  assert.match(validateSceneBackgroundName("场".repeat(81)), /不能超过 80 个字符/);
  assert.equal(validateKnownScale("4.2"), null);
  assert.match(validateKnownScale("0"), /必须是大于 0/);
  assert.match(validateKnownScale("100001"), /不超过 100000 米/);
  assert.match(validateKnownScale("not-a-number"), /必须是大于 0/);

  console.log("PASS: scene-background input modes, resource limits and configuration validation.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
