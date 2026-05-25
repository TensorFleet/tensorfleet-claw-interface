import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const buildDir = join(packageDir, "dist");
const packageJsonPath = join(packageDir, "package.json");
const pluginJsonPath = join(packageDir, "openclaw.plugin.json");
const allowToolsScriptPath = join(buildDir, "allow-openclaw-tools.js");

const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const pluginJson = JSON.parse(await readFile(pluginJsonPath, "utf8"));

await rm(join(buildDir, "package.json"), { force: true });
await rm(join(buildDir, "openclaw.plugin.json"), { force: true });
await rm(join(buildDir, "skills"), { force: true, recursive: true });
await rm(join(buildDir, "index.js"), { force: true });
await rm(join(buildDir, "index.mjs"), { force: true });
await rm(join(buildDir, "index.d.ts"), { force: true });
await rm(join(buildDir, "index.d.mts"), { force: true });
await rm(allowToolsScriptPath, { force: true });
await mkdir(buildDir, { recursive: true });
await cp(join(packageDir, "skills"), join(buildDir, "skills"), { recursive: true });

await writeFile(
  join(buildDir, "package.json"),
  `${JSON.stringify(
    {
      name: packageJson.name,
      version: packageJson.version,
      description: packageJson.description,
      type: "module",
      main: "dist/index.js",
      types: "dist/index.d.ts",
      scripts: {
        "allow-tools": "node allow-openclaw-tools.js",
      },
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

await writeFile(
  allowToolsScriptPath,
  `#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const distDir = dirname(fileURLToPath(import.meta.url));
const pluginJsonPath = join(distDir, "openclaw.plugin.json");
const openclawConfigPath =
  process.argv[2] ?? process.env.OPENCLAW_CONFIG ?? join(homedir(), ".openclaw", "openclaw.json");

function assertObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(\`\${label} must be a JSON object\`);
  }
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(\`\${label} contains invalid JSON: \${error.message}\`);
    }
    throw new Error(\`Unable to read \${label} at \${path}: \${error.message}\`);
  }
}

const pluginJson = await readJson(pluginJsonPath, "built openclaw.plugin.json");
assertObject(pluginJson, "built openclaw.plugin.json");

const contractTools = pluginJson.contracts?.tools;
if (!Array.isArray(contractTools) || !contractTools.every((tool) => typeof tool === "string")) {
  throw new Error("built openclaw.plugin.json must contain contracts.tools as an array of strings");
}

const openclawConfig = await readJson(openclawConfigPath, "OpenClaw config");
assertObject(openclawConfig, "OpenClaw config");

if (openclawConfig.tools === undefined) {
  openclawConfig.tools = {};
}
assertObject(openclawConfig.tools, "OpenClaw config tools");

if (openclawConfig.tools.alsoAllow === undefined) {
  openclawConfig.tools.alsoAllow = [];
}
if (!Array.isArray(openclawConfig.tools.alsoAllow)) {
  throw new Error("OpenClaw config tools.alsoAllow must be an array when present");
}

const existing = openclawConfig.tools.alsoAllow;
const existingToolNames = new Set(existing.filter((tool) => typeof tool === "string"));
const addedTools = contractTools.filter((tool) => !existingToolNames.has(tool));

openclawConfig.tools.alsoAllow = [...existing, ...addedTools];

await writeFile(openclawConfigPath, \`\${JSON.stringify(openclawConfig, null, 2)}\\n\`);

if (addedTools.length === 0) {
  console.log(\`No changes needed. \${contractTools.length} TensorFleet tools are already allowed in \${openclawConfigPath}.\`);
} else {
  console.log(\`Added \${addedTools.length} TensorFleet tools to \${openclawConfigPath}:\`);
  for (const tool of addedTools) {
    console.log(\`- \${tool}\`);
  }
}
`,
);
