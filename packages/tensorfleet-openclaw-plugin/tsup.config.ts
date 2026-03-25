import { defineConfig } from "tsup";
import { resolve } from "path";

const rootDir = __dirname;
const packagesDir = resolve(rootDir, "./packages");
const typesDir = resolve(rootDir, "./packages/@types");

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  target: "esnext",
  outDir: "dist",

  external: [
    "fs","path","os","util","events","stream","buffer","crypto","url",
    "querystring","assert","child_process","cluster","dgram","dns","domain",
    "http","https","net","punycode","readline","repl","string_decoder","sys",
    "timers","tls","tty","vm","zlib","worker_threads","inspector","v8",
    "perf_hooks","async_hooks","http2",
  ],

  esbuildOptions(options) {
    options.alias = {
      "@": resolve(rootDir, "./src"),
      "@types": typesDir,
    };
  },
});