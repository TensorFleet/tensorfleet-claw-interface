import { defineConfig } from "vite";
import { resolve } from "path";

const rootDir = __dirname;
const packagesDir = resolve(rootDir, "./packages");
const typesDir = resolve(rootDir, "./packages/@types");

// ✅ tensorfleet-util resolves to SOURCE in dev/build (like your @lichtblick packages)
const tensorfleetUtilDir = resolve(rootDir, "./packages/tensorfleet-util/src");

export default defineConfig({
  plugins: [],

  worker: {
    plugins: () => [],
    format: "es",
  },

  define: {
    global: "globalThis",
    __filename: JSON.stringify("browser"),
    __dirname: JSON.stringify("/"),
    ReactNull: "null",
  },

  esbuild: {
    tsconfigRaw: "{}",
  },

  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "esnext",
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "tensorfleetClawInterface",
      formats: ["es", "cjs"],
      fileName: (format) => `index.${format === "es" ? "mjs" : "js"}`,
    },
    rollupOptions: {
      external: [
        // External dependencies that shouldn't be bundled
        "fs",
        "path",
        "os",
        "util",
        "events",
        "stream",
        "buffer",
        "crypto",
        "url",
        "querystring",
        "assert",
        "child_process",
        "cluster",
        "dgram",
        "dns",
        "domain",
        "http",
        "https",
        "net",
        "punycode",
        "readline",
        "repl",
        "string_decoder",
        "sys",
        "timers",
        "tls",
        "tty",
        "vm",
        "zlib",
        "worker_threads",
        "inspector",
        "v8",
        "perf_hooks",
        "async_hooks",
        "http2",
      ],
    },
  },

  resolve: {
    alias: [
      { find: "@", replacement: resolve(rootDir, "./src") },

      // ✅ tensorfleet-util deep imports:
      // import "... from 'tensorfleet-util/ros-util/ros-types'"
      // -> packages/tensorfleet-util/src/ros-util/ros-types.ts
      {
        find: /^tensorfleet-util(\/.*)?$/,
        replacement: `${tensorfleetUtilDir}$1`,
      },

      {
        find:
          /^@lichtblick\/(suite-base|log|suite|hooks|mcap-support|theme|message-path|typescript-transformers|comlink-transfer-handlers)(\/.*)?$/,
        replacement: `${packagesDir}/$1/src$2`,
      },
      {
        find: /^@lichtblick\/den(\/.*)?$/,
        replacement: `${packagesDir}/den$1`,
      },
      {
        find: /^@types\/([^/]+)/,
        replacement: `${typesDir}/$1`,
      },
      {
        find: /^gzweb(\/.*)?$/,
        replacement: `${packagesDir}/gzweb/src$1`,
      },
    ],
  },

  optimizeDeps: {
    exclude: [
      // ✅ keep this excluded so Vite doesn't prebundle it weirdly
      "tensorfleet-util",

      "@lichtblick/wasm-bz2",
      "@lichtblick/wasm-zstd",
      "@lichtblick/wasm-lz4",
      "@foxglove/wasm-bz2",
      "@foxglove/wasm-zstd",
      "@foxglove/wasm-lz4",
    ],
  },

  assetsInclude: ["**/*.wasm"],
});
