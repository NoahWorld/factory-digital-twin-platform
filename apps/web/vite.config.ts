import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { decoderAssets } from "./decoder-assets";
import { resolveProductName } from "./product.config";

const PRODUCT_NAME_PLACEHOLDER = "{{PRODUCT_NAME}}";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function productNameHtmlPlugin(productName: string): Plugin {
  return {
    name: "product-name-html",
    transformIndexHtml(html) {
      if (!html.includes(PRODUCT_NAME_PLACEHOLDER)) {
        throw new Error(`index.html 缺少产品名称占位符 ${PRODUCT_NAME_PLACEHOLDER}`);
      }

      return html.split(PRODUCT_NAME_PLACEHOLDER).join(escapeHtml(productName));
    },
  };
}

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");
  const productName = resolveProductName(environment.VITE_PRODUCT_NAME);

  return {
    plugins: [productNameHtmlPlugin(productName), react(), decoderAssets()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      proxy: {
        "/api": {
          target: environment.VITE_DEV_API_TARGET || "http://127.0.0.1:8787",
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
