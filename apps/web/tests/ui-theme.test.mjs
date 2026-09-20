import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import {
  applyUiTheme,
  initializeUiTheme,
  parseUiThemePreference,
  reportUiThemeStorageIssue,
  resolveUiTheme,
  uiThemeMetaColor,
  UI_THEME_MEDIA_QUERY,
  UI_THEME_STORAGE_KEY,
} from "../src/theme/ui-theme";

const sourceRoot = resolve(process.cwd(), "apps/web/src");
let checks = 0;

function check(name, run) {
  run();
  checks++;
  console.log(`✓ ${name}`);
}

check("theme preference accepts only explicit light/dark or an absent preference", () => {
  for (const value of [null, "light", "dark"]) assert.equal(parseUiThemePreference(value), value);
  for (const value of ["", "system", "LIGHT", "dark ", "null", "\"light\"", undefined, 0, {}, []]) {
    assert.throws(() => parseUiThemePreference(value), /界面主题偏好无效/);
  }
});

check("manual choice wins over the system; clearing it resumes system changes", () => {
  for (const system of ["light", "dark"]) {
    assert.equal(resolveUiTheme(null, system), system);
    assert.equal(resolveUiTheme("light", system), "light");
    assert.equal(resolveUiTheme("dark", system), "dark");
  }
});

function withBrowser({ systemTheme = "light", value = null, storageFailure = null, existingMeta = true } = {}, run) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const previousWarn = console.warn;
  const warnings = [];
  const metas = existingMeta ? [{ name: "theme-color", content: "stale-color" }] : [];
  const root = { dataset: {}, style: {} };
  const storageError = new Error("Theme storage access intentionally blocked for this test");
  const browser = {
    matchMedia(query) {
      assert.equal(query, UI_THEME_MEDIA_QUERY);
      return { matches: systemTheme === "dark" };
    },
    get localStorage() {
      if (storageFailure === "getter") throw storageError;
      return {
        getItem(key) {
          assert.equal(key, UI_THEME_STORAGE_KEY);
          if (storageFailure === "read") throw storageError;
          return value;
        },
      };
    },
  };
  const document = {
    documentElement: root,
    querySelector(selector) {
      assert.equal(selector, 'meta[name="theme-color"]');
      return metas[0] ?? null;
    },
    createElement(tag) {
      assert.equal(tag, "meta");
      return { name: "", content: "" };
    },
    head: { append(meta) { metas.push(meta); } },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  console.warn = (...args) => warnings.push(args);
  try {
    run({ root, metas, warnings, storageError });
  } finally {
    console.warn = previousWarn;
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else delete globalThis.document;
  }
}

check("initialization applies system and manual preferences before rendering", () => {
  for (const systemTheme of ["light", "dark"]) {
    for (const preference of [null, "light", "dark"]) {
      withBrowser({ systemTheme, value: preference }, ({ root, metas, warnings }) => {
        const state = initializeUiTheme();
        const expected = preference ?? systemTheme;
        assert.deepEqual(state, { preference, systemTheme, storageIssue: null });
        assert.equal(root.dataset.uiTheme, expected);
        assert.equal(root.style.colorScheme, expected);
        assert.equal(metas[0].content, uiThemeMetaColor(expected));
        assert.equal(metas.length, 1);
        assert.deepEqual(warnings, []);
      });
    }
  }
});

check("theme application creates missing metadata and updates rather than duplicating it", () => {
  withBrowser({ existingMeta: false }, ({ root, metas }) => {
    applyUiTheme("light");
    assert.deepEqual(metas, [{ name: "theme-color", content: uiThemeMetaColor("light") }]);
    applyUiTheme("dark");
    assert.equal(root.dataset.uiTheme, "dark");
    assert.equal(root.style.colorScheme, "dark");
    assert.deepEqual(metas, [{ name: "theme-color", content: uiThemeMetaColor("dark") }]);
  });
});

check("invalid stored preferences produce traceable warnings and a visible diagnostic state", () => {
  withBrowser({ value: "sepia", systemTheme: "dark" }, ({ warnings, root }) => {
    const state = initializeUiTheme();
    assert.equal(state.preference, null);
    assert.equal(state.systemTheme, "dark");
    assert.match(state.storageIssue, /无法读取或同步/);
    assert.equal(root.dataset.uiTheme, "dark");
    assert.equal(warnings.length, 1);
    const [message, context] = warnings[0];
    assert.match(message, /\[ui-theme\]/);
    assert.equal(context.operation, "read");
    assert.equal(context.key, UI_THEME_STORAGE_KEY);
    assert.match(context.reason.message, /sepia/);
  });
});

check("blocked storage never prevents initialization and never fails silently", () => {
  for (const storageFailure of ["getter", "read"]) {
    withBrowser({ storageFailure }, ({ warnings, root, storageError }) => {
      const state = initializeUiTheme();
      assert.equal(state.preference, null);
      assert.equal(root.dataset.uiTheme, "light");
      assert.equal(root.style.colorScheme, "light");
      assert.match(state.storageIssue, /浏览器/);
      assert.equal(warnings.length, 1);
      assert.equal(warnings[0][1].reason, storageError);
      assert.equal(warnings[0][1].operation, "read");
    });
  }
});

check("write and cross-tab sync failures return user-facing diagnostics with operation context", () => {
  withBrowser({}, ({ warnings }) => {
    const reason = new Error("Intentionally denied");
    assert.match(reportUiThemeStorageIssue("write", reason), /当前页面切换.*未能保存/);
    assert.match(reportUiThemeStorageIssue("sync", reason), /无法读取或同步/);
    assert.deepEqual(warnings.map(([, context]) => context.operation), ["write", "sync"]);
    for (const [, context] of warnings) {
      assert.equal(context.key, UI_THEME_STORAGE_KEY);
      assert.equal(context.reason, reason);
    }
  });
});

const paletteSource = await readFile(join(sourceRoot, "theme/theme-palette.css"), "utf8");
const withoutComments = value => value.replace(/\/\*[\s\S]*?\*\//g, "");
function palette(theme) {
  const block = withoutComments(paletteSource).match(new RegExp(`\\[data-ui-theme="${theme}"\\]\\s*\\{([^}]+)\\}`));
  assert.ok(block, `${theme} theme must have an explicit CSS palette`);
  const values = new Map();
  for (const [, name, value] of block[1].matchAll(/(--ui-[\w-]+)\s*:\s*([^;]+);/g)) {
    assert.ok(!values.has(name), `${theme} must not redefine ${name} in its palette`);
    values.set(name, value.trim());
  }
  return values;
}
const palettes = { light: palette("light"), dark: palette("dark") };

check("both palettes define the same complete application-chrome token contract", () => {
  assert.deepEqual([...palettes.light.keys()].sort(), [...palettes.dark.keys()].sort());
  const required = [
    "bg", "surface", "surface-raised", "surface-muted", "input-bg", "hover",
    "text", "text-strong", "text-muted", "text-subtle", "border", "border-strong",
    "accent", "accent-hover", "on-accent", "accent-soft", "accent-border",
    "danger", "danger-soft", "success", "success-soft", "warning", "warning-soft",
    "info", "info-soft", "purple", "purple-soft", "backdrop", "color-scheme",
  ];
  for (const [theme, values] of Object.entries(palettes)) {
    for (const token of required) assert.ok(values.has(`--ui-${token}`), `${theme} is missing ${token}`);
    assert.equal(values.get("--ui-color-scheme"), theme);
    assert.equal(uiThemeMetaColor(theme), values.get("--ui-bg"), `${theme} browser chrome must match the page background`);
  }
});

function luminance(hex) {
  assert.match(hex, /^#[\da-f]{6}$/i, `Contrast checks need an opaque six-digit color, received ${hex}`);
  const components = [1, 3, 5].map(offset => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return components[0] * 0.2126 + components[1] * 0.7152 + components[2] * 0.0722;
}

function assertContrast(theme, foreground, background) {
  const values = palettes[theme];
  const a = luminance(values.get(`--ui-${foreground}`));
  const b = luminance(values.get(`--ui-${background}`));
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  assert.ok(ratio >= 4.5, `${theme} ${foreground} on ${background}: ${ratio.toFixed(2)}:1 < 4.5:1`);
}

check("regular and subdued application text meet WCAG AA contrast in both themes", () => {
  for (const theme of ["light", "dark"]) {
    for (const text of ["text", "text-strong", "text-muted", "text-subtle"]) {
      for (const surface of ["bg", "surface", "surface-raised", "surface-muted", "input-bg"]) {
        assertContrast(theme, text, surface);
      }
    }
  }
});

check("primary buttons and semantic status surfaces meet WCAG AA text contrast", () => {
  for (const theme of ["light", "dark"]) {
    assertContrast(theme, "on-accent", "accent");
    assertContrast(theme, "on-accent", "accent-hover");
    assertContrast(theme, "on-danger", "danger-solid");
    assertContrast(theme, "on-danger", "danger-solid-hover");
    for (const status of ["accent", "danger", "success", "warning", "info", "purple"]) {
      assertContrast(theme, status, `${status}-soft`);
    }
  }
});

async function cssFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await cssFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".css")) result.push(path);
  }
  return result;
}

const cssSources = await Promise.all((await cssFiles(sourceRoot)).map(async path => ({ path, css: withoutComments(await readFile(path, "utf8")) })));
check("every application CSS --ui-* reference is supplied by both theme palettes", () => {
  let references = 0;
  for (const { path, css } of cssSources) {
    for (const [, name] of css.matchAll(/var\(\s*(--ui-[\w-]+)/g)) {
      references++;
      for (const [theme, values] of Object.entries(palettes)) {
        assert.ok(values.has(name), `${relative(sourceRoot, path)} references ${name}, missing in ${theme}`);
      }
    }
  }
  assert.ok(references > 0, "The application must actually consume the UI theme contract");
});

console.log(`UI theme: ${checks} regression groups passed.`);
