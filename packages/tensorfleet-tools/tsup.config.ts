import { defineConfig } from "tsup";
import path from "path";

const rootDir = __dirname;
const packagesDir = path.resolve(rootDir, "./packages");
const typesDir = path.resolve(rootDir, "./packages/@types");
const tensorfleetUtilDir = path.resolve(
  rootDir,
  "./packages/tensorfleet-util/src"
);

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: {
    entry: "src/index.ts",
  },
  outDir: "dist",
  sourcemap: true,
  clean: true,
  target: "esnext",
  splitting: false,
  bundle: true,
  platform: "node",

  define: {
    global: "globalThis",
    __filename: `"node"`,
    __dirname: `"/"`,
    ReactNull: "null",
  },

  external: [
    // node builtins
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

    // IMPORTANT: keep these external
    "jsdom",
    "ws",
    "canvas",
    "bufferutil",
    "utf-8-validate",
  ],

  esbuildPlugins: [
    {
      name: "alias",
      setup(build) {
        // tensorfleet-util alias
        build.onResolve({ filter: /^tensorfleet-util(\/.*)?$/ }, (args) => ({
          path: path.resolve(
            tensorfleetUtilDir,
            args.path.replace(/^tensorfleet-util/, "")
          ),
        }));

        // lichtblick packages
        build.onResolve(
          {
            filter:
              /^@lichtblick\/(suite-base|log|suite|hooks|mcap-support|theme|message-path|typescript-transformers|comlink-transfer-handlers)(\/.*)?$/,
          },
          (args) => ({
            path: path.resolve(
              packagesDir,
              args.path
                .replace(/^@lichtblick\//, "")
                .replace(/(\/.*)?$/, "/src$1")
            ),
          })
        );

        // den special case
        build.onResolve({ filter: /^@lichtblick\/den(\/.*)?$/ }, (args) => ({
          path: path.resolve(
            packagesDir,
            args.path.replace(/^@lichtblick\/den/, "den")
          ),
        }));

        // @types alias
        build.onResolve({ filter: /^@types\/([^/]+)/ }, (args) => ({
          path: path.resolve(
            typesDir,
            args.path.replace(/^@types\//, "")
          ),
        }));

        // gzweb alias
        build.onResolve({ filter: /^gzweb(\/.*)?$/ }, (args) => ({
          path: path.resolve(
            packagesDir,
            "gzweb/src",
            args.path.replace(/^gzweb/, "")
          ),
        }));
      },
    },
  ],
});