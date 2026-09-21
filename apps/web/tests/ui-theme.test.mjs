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
    "bg", "surface", "surface-raised", "surface-muted", "input-bg", "readonly-bg", "hover",
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
      for (const surface of ["bg", "surface", "surface-raised", "surface-muted", "input-bg", "readonly-bg"]) {
        assertContrast(theme, text, surface);
      }
    }
  }
});

check("read-only surfaces are distinct from editable fields in both themes", () => {
  for (const [theme, values] of Object.entries(palettes)) {
    assert.notEqual(values.get("--ui-readonly-bg"), values.get("--ui-input-bg"), `${theme} read-only values must not look like editable fields`);
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

const standalonePageSource = await readFile(join(sourceRoot, "pages/Standalone3DProjectPage.tsx"), "utf8");
const standaloneInspectorSource = standalonePageSource
  .split('<aside className="standalone-3d-inspector">')[1]?.split("</aside>")[0];
const twinActionEditorSource = await readFile(join(sourceRoot, "twin/TwinActionEditor.tsx"), "utf8");

check("inspector actions remain native buttons with visible button affordance", () => {
  assert.ok(standaloneInspectorSource, "The standalone model inspector must be present");
  const actionButtons = [...standaloneInspectorSource.matchAll(/<button\b[\s\S]*?<\/button>/g)].map(([button]) => button);
  for (const label of ["移除", "重置", "关闭默认点击动作"]) {
    const button = actionButtons.find((candidate) => new RegExp(`>\\s*${label}\\s*</button>$`).test(candidate));
    assert.ok(button, `${label} must remain a native button`);
    assert.match(button, /type="button"/, `${label} must not submit an enclosing form`);
    assert.match(button, /className="[^"]*\binspector-action-button\b/, `${label} must have a visible action boundary`);
    assert.doesNotMatch(button, /className="[^"]*\btext-button\b/, `${label} must not be styled as plain explanatory text`);
    assert.match(button, /disabled=\{[^}]*!editable/, `${label} must retain the project permission guard`);
    if (label === "移除") assert.match(button, /className="[^"]*\bis-danger\b/, "The destructive action must retain its distinct intent");
  }
  const removeActionButton = [...twinActionEditorSource.matchAll(/<button\b[\s\S]*?<\/button>/g)].map(([button]) => button)
    .find((button) => />\s*移除\s*<\/button>$/.test(button));
  assert.ok(removeActionButton, "Removing a configured interaction must remain a native button");
  assert.match(removeActionButton, /className="[^"]*\binspector-action-button\b/, "Removing an interaction must use the same visible action boundary");
  assert.match(removeActionButton, /type="button"/);
});

check("property section headings are static headings and transform modes expose their state", () => {
  const headers = [...standaloneInspectorSource.matchAll(/<section className="standalone-property-group">\s*(<header\b[^>]*>[\s\S]*?<\/header>)/g)].map(([, header]) => header);
  assert.ok(headers.length > 0, "The inspector must retain structured property groups");
  for (const header of headers) {
    assert.match(header, /<h3\b[^>]*>[^<]+<\/h3>/, "Each property group needs a semantic heading");
    assert.doesNotMatch(header, /<(?:button|input|select|textarea)\b|tabIndex=|onClick=/, "Static section headers must not behave like controls");
  }
  const modes = standaloneInspectorSource.match(/<div className="standalone-segmented-control">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(modes, "Transform mode controls must remain available");
  for (const mode of ["translate", "scale"]) {
    const button = [...modes.matchAll(/<button\b[\s\S]*?<\/button>/g)].map(([value]) => value)
      .find((candidate) => candidate.includes(`setInstanceTransformMode("${mode}")`));
    assert.ok(button, `${mode} must be a native mode button`);
    assert.ok(button.includes(`aria-pressed={instanceTransformMode === "${mode}"}`), `${mode} must communicate its selected state without relying on color`);
    assert.match(button, /disabled=\{[^}]*!editable/, `${mode} must be unavailable without edit permission`);
  }
});

async function sourceFiles(directory, extensions = [".css"]) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await sourceFiles(path, extensions));
    else if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))) result.push(path);
  }
  return result;
}

const componentSources = await Promise.all((await sourceFiles(sourceRoot, [".tsx", ".jsx", ".html"])).map(async path => ({ path, source: await readFile(path, "utf8") })));
check("all dropdowns use the shared themed component instead of native OS menus", () => {
  let consumers = 0;
  for (const { path, source } of componentSources) {
    assert.doesNotMatch(source, /<select\b/, `${relative(sourceRoot, path)} must use the shared Select component`);
    consumers += [...source.matchAll(/<Select\b/g)].length;
  }
  assert.ok(consumers >= 40, `Expected all existing dropdowns to be migrated, found ${consumers}`);
  const shortcut = standalonePageSource.match(/const handleShortcut = \(event: KeyboardEvent\) => \{([\s\S]*?)\n    \};/)?.[1];
  assert.ok(shortcut?.includes("event.defaultPrevented"), "Scene shortcuts must respect handled dropdown keys");
  assert.ok(shortcut?.includes('[role="combobox"]'), "Custom comboboxes must suppress scene transform shortcuts");
});

const cssSources = await Promise.all((await sourceFiles(sourceRoot)).map(async path => ({ path, css: withoutComments(await readFile(path, "utf8")) })));
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
