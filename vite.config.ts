import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["jsdom", "undici", "ws"]
  },
  build: {
    target: "esnext",
    rollupOptions: {
      external: [
        "node:fs",
        "node:path",
        "node:zlib",
        "node:worker_threads",
        "node:stream",
        "node:http",
        "node:https",
        "node:crypto",
        "jsdom",
        "undici",
        "ws"
      ]
    }
  }
});