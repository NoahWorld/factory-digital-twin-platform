import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    server: {
      port: 5173,
      // Some local automation filesystems do not deliver native change events.
      // Set both options: Chokidar's environment override can leave FsEvents on.
      watch: process.env.NEWPOWER_POLL_WATCH === "true"
        ? { usePolling: true, useFsEvents: false }
        : undefined,
      proxy: {
        "/api": {
          target: environment.VITE_DEV_API_TARGET || "http://127.0.0.1:8787",
          changeOrigin: true,
        },
      },
    },
  };
});
