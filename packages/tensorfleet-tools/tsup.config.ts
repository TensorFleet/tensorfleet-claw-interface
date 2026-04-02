import { defineConfig } from "tsup";
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";

const rootDir = __dirname;
const packagesDir = path.resolve(rootDir, "./packages");
const typesDir = path.resolve(rootDir, "./packages/@types");
const tensorfleetUtilDir = path.resolve(rootDir, "./packages/tensorfleet-util/src");
const tensorfleetRosDir = path.resolve(rootDir, "./packages/tensorfleet-ros/src");

const nodeBuiltins = [
  ...builtinModules,
  ...builtinModules.map((mod) => `node:${mod}`),
];

function resolveExisting(basePath: string): string {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.mts`,
    `${basePath}.cts`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}.mjs`,
    `${basePath}.cjs`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
    path.join(basePath, "index.mts"),
    path.join(basePath, "index.cts"),
    path.join(basePath, "index.js"),
    path.join(basePath, "index.jsx"),
    path.join(basePath, "index.mjs"),
    path.join(basePath, "index.cjs"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return basePath;
}

function resolvePackageEntry(baseDir: string, subpath?: string): string {
  if (!subpath || subpath === "") {
    return resolveExisting(path.join(baseDir, "index"));
  }

  return resolveExisting(path.resolve(baseDir, `.${subpath}`));
}

function viteLikeAliasPlugin() {
  return {
    name: "vite-like-alias",
    setup(build: any) {
      build.onResolve({ filter: /^@\// }, (args: any) => {
        return {
          path: resolveExisting(path.resolve(rootDir, "src", args.path.slice(2))),
        };
      });

      build.onResolve({ filter: /^tensorfleet-util(\/.*)?$/ }, (args: any) => {
        const match = args.path.match(/^tensorfleet-util(\/.*)?$/);
        const subpath = match?.[1] ?? "";
        return {
          path: resolvePackageEntry(tensorfleetUtilDir, subpath),
        };
      });

      build.onResolve({ filter: /^tensorfleet-ros(\/.*)?$/ }, (args: any) => {
        const match = args.path.match(/^tensorfleet-ros(\/.*)?$/);
        const subpath = match?.[1] ?? "";
        return {
          path: resolvePackageEntry(tensorfleetRosDir, subpath),
        };
      });

      build.onResolve(
        {
          filter:
            /^@lichtblick\/(suite-base|log|suite|hooks|mcap-support|theme|message-path|typescript-transformers|comlink-transfer-handlers)(\/.*)?$/,
        },
        (args: any) => {
          const match = args.path.match(
            /^@lichtblick\/(suite-base|log|suite|hooks|mcap-support|theme|message-path|typescript-transformers|comlink-transfer-handlers)(\/.*)?$/,
          );

          if (!match) {
            return null;
          }

          const [, pkg, subpath = ""] = match;

          return {
            path: resolvePackageEntry(path.resolve(packagesDir, pkg, "src"), subpath),
          };
        },
      );

      build.onResolve({ filter: /^@lichtblick\/den(\/.*)?$/ }, (args: any) => {
        const match = args.path.match(/^@lichtblick\/den(\/.*)?$/);
        const subpath = match?.[1] ?? "";

        return {
          path: resolvePackageEntry(path.resolve(packagesDir, "den"), subpath),
        };
      });

      build.onResolve({ filter: /^@types\/([^/]+)(\/.*)?$/ }, (args: any) => {
        const match = args.path.match(/^@types\/([^/]+)(\/.*)?$/);

        if (!match) {
          return null;
        }

        const [, pkg, subpath = ""] = match;

        return {
          path: resolvePackageEntry(path.resolve(typesDir, pkg), subpath),
        };
      });

      build.onResolve({ filter: /^gzweb(\/.*)?$/ }, (args: any) => {
        const match = args.path.match(/^gzweb(\/.*)?$/);
        const subpath = match?.[1] ?? "";

        return {
          path: resolvePackageEntry(path.resolve(packagesDir, "gzweb", "src"), subpath),
        };
      });
    },
  };
}

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
  platform: "node",
  bundle: true,
  splitting: false,

  define: {
    global: "globalThis",
    __filename: JSON.stringify("browser"),
    __dirname: JSON.stringify("/"),
    ReactNull: "null",
  },

  loader: {
    ".wasm": "file",
  },

  external: [
    ...nodeBuiltins,
    "canvas",
    "bufferutil",
    "utf-8-validate",
    "jsdom",
    "ws",
  ],

  noExternal: [
    /^tensorfleet-/,
    /^@lichtblick\//,
  ],

  outExtension({ format }) {
    return {
      js: format === "esm" ? ".mjs" : ".js",
    };
  },

  esbuildPlugins: [viteLikeAliasPlugin()],
});