import assert from "node:assert/strict";
import { test } from "node:test";
import { engineeringConfigurationError, engineeringFileError, engineeringIssues } from "../src/pages/engineering-import";

const layer = (patch = {}) => ({ name: "WALL", role: "wall", height: "3", base: "0", ...patch });

test("engineering file validation accepts only nonempty IFC/DXF within capability size", () => {
  const max = 100 * 1024 * 1024;
  assert.equal(engineeringFileError({ name: "Building.IFC", size: max }, max), null);
  assert.equal(engineeringFileError({ name: "Layout.dxf", size: 1 }, max), null);
  assert.match(engineeringFileError({ name: "Layout.dwg", size: 1 }, max), /DWG.*DXF/);
  assert.match(engineeringFileError({ name: "Building.rvt", size: 1 }, max), /RVT.*IFC/);
  assert.match(engineeringFileError({ name: "empty.dxf", size: 0 }, max), /为空/);
  assert.match(engineeringFileError({ name: "large.ifc", size: max + 1 }, max), /超过/);
});

test("CAD requires an explicit unit and every layer mapped, including annotations", () => {
  assert.match(engineeringConfigurationError("dxf", "", [layer()]), /选择图纸单位/);
  assert.match(engineeringConfigurationError("dxf", "mm", [layer(), layer({ name: "DIM", role: "" })]), /DIM/);
  assert.equal(engineeringConfigurationError("dxf", "mm", [layer(), layer({ name: "DIM", role: "ignore", height: "", base: "" })]), null);
  assert.match(engineeringConfigurationError("dxf", "mm", [layer({ role: "ignore" })]), /至少保留/);
  assert.match(engineeringConfigurationError("dxf", "mm", [layer({ role: "unknown" })]), /选择用途/);
  assert.match(engineeringConfigurationError("dxf", "mm", []), /没有可配置/);
});

test("height and base are finite explicit meter values and retain tiny valid geometry", () => {
  for (const height of ["", "0", "-1", "Infinity", "NaN", "1000.01"]) {
    assert.match(engineeringConfigurationError("dxf", "m", [layer({ height })]), /高度或厚度|高度|厚度/);
  }
  for (const base of ["", "Infinity", "-10000.01", "10000.01"]) {
    assert.match(engineeringConfigurationError("dxf", "m", [layer({ base })]), /基准标高/);
  }
  assert.equal(engineeringConfigurationError("dxf", "m", [layer({ height: "0.0001", base: "-1.2" })]), null);
  assert.equal(engineeringConfigurationError("dxf", "ft", [layer({ height: "1000", base: "10000" })]), null);
  assert.equal(engineeringConfigurationError("ifc", "", []), null);
});

test("structured diagnostics retain source identifiers and discard arbitrary server messages", () => {
  const issues = engineeringIssues({ issues: [{ code: "engineering_invalid_geometry", layer: "WALL\u0000", handle: "AB1", entityType: "LWPOLYLINE", message: "secret path /srv/token" }] });
  assert.deepEqual(issues, [{ code: "engineering_invalid_geometry", layer: "WALL", handle: "AB1", entityType: "LWPOLYLINE" }]);
  assert.equal(JSON.stringify(issues).includes("secret"), false);
  assert.deepEqual(engineeringIssues({ issues: [null, "raw error", { message: "raw error" }] }), []);
  assert.equal(engineeringIssues({ issues: Array(150).fill({ code: "unsupported", layer: "x".repeat(500) }) }).length, 100);
  assert.equal(engineeringIssues({ issues: [{ code: "unsupported", layer: "x".repeat(500) }] })[0].layer.length, 160);
});
