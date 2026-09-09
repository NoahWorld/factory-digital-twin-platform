import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { decoderAssets } from "./decoder-assets";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react(), decoderAssets()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: environment.VITE_DEV_API_TARGET || "http://127.0.0.1:8787",
          changeOrigin: true,
        },
      },
    },
  };
});
