import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssetRuntimeStatusBanner } from "../src/twin/AssetRuntimeStatusBanner";

const renderBanner = (props = {}) => renderToStaticMarkup(createElement(AssetRuntimeStatusBanner, {
  connections: {},
  loading: false,
  setupError: null,
  ...props,
}));

test("model-only displays show neither a warning nor a fictitious connection", () => {
  assert.equal(renderBanner({ label: "2D / 3D 设备联动" }), "");
});

test("real asset loading remains visible", () => {
  assert.match(renderBanner({ loading: true }), /正在读取资产映射/);
});

test("asset loading and configuration errors remain visible without connections", () => {
  for (const setupError of [
    "资产台账加载失败：当前账号无权访问。",
    "联动资产 pump-001 不存在，无法读取设备数据。",
    "当前绑定 51 台设备；本地直连轮询上限为 50。",
  ]) {
    const markup = renderBanner({ setupError });
    assert.match(markup, /role="alert"/);
    assert.ok(markup.includes(setupError));
  }
});

test("configured connections still show connecting and live states", () => {
  assert.match(renderBanner({ connections: { asset: { status: "loading", failureCount: 0 } } }), /正在连接设备数据/);
  assert.match(renderBanner({ connections: { asset: { status: "live", failureCount: 0 } } }), /在线 1 台/);
});

test("network failure and retry count remain visible", () => {
  const markup = renderBanner({ connections: { asset: { status: "offline", failureCount: 3, errorCode: "runtime_request_failed" } } });
  assert.match(markup, /role="alert"/);
  assert.match(markup, /数据失联 1 台/);
  assert.match(markup, /正在重连（第 3 次）/);
});

test("stale data is not disguised as a normal or unused connection", () => {
  const markup = renderBanner({ connections: { asset: { status: "offline", failureCount: 2, errorCode: "data_source_stale" } } });
  assert.match(markup, /role="alert"/);
  assert.match(markup, /数据陈旧 1 台/);
});
