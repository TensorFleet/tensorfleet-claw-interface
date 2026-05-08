import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const buildDir = join(packageDir, "dist");
const packageJsonPath = join(packageDir, "package.json");
const pluginJsonPath = join(packageDir, "openclaw.plugin.json");

const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const pluginJson = JSON.parse(await readFile(pluginJsonPath, "utf8"));

await rm(join(buildDir, "package.json"), { force: true });
await rm(join(buildDir, "openclaw.plugin.json"), { force: true });
await rm(join(buildDir, "skills"), { force: true, recursive: true });
await rm(join(buildDir, "index.js"), { force: true });
await rm(join(buildDir, "index.mjs"), { force: true });
await rm(join(buildDir, "index.d.ts"), { force: true });
await rm(join(buildDir, "index.d.mts"), { force: true });
await mkdir(buildDir, { recursive: true });
await cp(join(packageDir, "skills"), join(buildDir, "skills"), { recursive: true });

await writeFile(
  join(buildDir, "package.json"),
  `${JSON.stringify(
    {
      name: packageJson.name,
      version: packageJson.version,
      description: packageJson.description,
      main: "dist/index.js",
      module: "dist/index.mjs",
      types: "dist/index.d.ts",
      openclaw: {
        extensions: ["./dist/index.js"],
      },
    },
    null,
    2,
  )}\n`,
);

await writeFile(
  join(buildDir, "openclaw.plugin.json"),
  `${JSON.stringify(pluginJson, null, 2)}\n`,
);
