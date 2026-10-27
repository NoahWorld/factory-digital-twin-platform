import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { decoderAssets } from "./decoder-assets";
import { COMPANY_NAME, resolveProductName } from "./product.config";

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

      return html.split(PRODUCT_NAME_PLACEHOLDER).join(escapeHtml(productName))
        .split("{{COMPANY_NAME}}").join(escapeHtml(COMPANY_NAME));
    },
  };
}

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");
  const productName = resolveProductName(environment.VITE_PRODUCT_NAME);

  return {
    base: "/twin/",
    plugins: [productNameHtmlPlugin(productName), react(), decoderAssets()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      // Keep Vite HMR away from the legacy Umi 2 WebSocket proxy.
      hmr: { host: "127.0.0.1", clientPort: 5173, protocol: "ws" },
      proxy: {
        "/cloud": {
          target: environment.IOT_DEV_API_TARGET || "http://127.0.0.1:18848",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/cloud(?=\/|$)/, ""),
          ws: true,
        },
      },
    },
  };
});
