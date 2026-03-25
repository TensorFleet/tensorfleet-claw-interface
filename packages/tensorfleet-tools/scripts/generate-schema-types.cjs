#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { compileFromFile } = require("json-schema-to-typescript");

const rootDir = process.cwd();
const schemaDir = path.join(rootDir, "schema");
const outputDir = path.join(rootDir, "src", "schema-types");

function getJsonFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...getJsonFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(fullPath);
    }
  }

  return files;
}

async function main() {
  if (!fs.existsSync(schemaDir)) {
    throw new Error(`Schema directory not found: ${schemaDir}`);
  }

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const schemaFiles = getJsonFiles(schemaDir);

  for (const schemaFile of schemaFiles) {
    const relativePath = path.relative(schemaDir, schemaFile);
    const outputPath = path.join(outputDir, relativePath.replace(/\.json$/i, ".d.ts"));
    const outputPathDir = path.dirname(outputPath);

    fs.mkdirSync(outputPathDir, { recursive: true });

    const compiled = await compileFromFile(schemaFile, {
      bannerComment: ""
    });

    fs.writeFileSync(outputPath, `${compiled.trim()}\n`, "utf8");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});