import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/extension.ts"],
  format: ["esm", "cjs"],
  dts: false,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: "esnext",
  platform: "browser",
  external: [
    "tensorfleet-tools",
    "jsdom",
    "undici",
    "ws",
    "node:fs",
    "node:path",
    "node:zlib",
    "node:worker_threads",
    "node:stream",
    "node:http",
    "node:https",
    "node:crypto"
  ]
});