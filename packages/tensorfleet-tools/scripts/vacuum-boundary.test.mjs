#!/usr/bin/env bun

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../../..");

const sourceRoots = [
  "packages/tensorfleet-tools/src",
  "packages/tensorfleet-tools/scripts",
  "packages/tensorfleet-openclaw-plugin/src",
  "packages/tensorfleet-openclaw-plugin/scripts",
];

const sourceFiles = sourceRoots
  .flatMap((root) => listSourceFiles(resolve(repoRoot, root)))
  .filter((file) => file !== import.meta.path);

assertNoMatches(
  sourceFiles,
  /vscode-tensorfleet|panels-standalone|vacuum-adapter|useVacuumAdapter|useTurtleBot4Nav2Adapter|useValetudoAdapter/,
  "OpenClaw/tools source must not depend on the VS Code extension vacuum adapter",
);
assertNoMatches(
  sourceFiles,
  /useVacuumAdapter|useTurtleBot4Nav2Adapter|useValetudoAdapter/,
  "OpenClaw/tools vacuum source must not depend on React hooks",
);

const vacuumToolSource = readRepoFile("packages/tensorfleet-tools/src/tools/vacuum.ts");
assert.match(
  vacuumToolSource,
  /from "tensorfleet-util\/vacuum\/node-runtime"/,
  "tensorfleet-vacuum must use the shared tensorfleet-util vacuum node runtime",
);

const pluginSource = readRepoFile("packages/tensorfleet-openclaw-plugin/src/index.ts");
assert.match(pluginSource, /from "tensorfleet-tools"/, "OpenClaw plugin must consume tensorfleet-tools");

console.log("vacuum OpenClaw/tools boundary checks passed");

function listSourceFiles(dir) {
  const entries = readdirSync(dir);
  const files = [];
  for (const entry of entries) {
    const path = resolve(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...listSourceFiles(path));
      continue;
    }
    if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry)) {
      files.push(path);
    }
  }
  return files;
}

function assertNoMatches(files, pattern, message) {
  const offenders = files
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .map((file) => relative(repoRoot, file));
  assert.deepEqual(offenders, [], `${message}: ${offenders.join(", ")}`);
}

function readRepoFile(path) {
  return readFileSync(resolve(repoRoot, path), "utf8");
}
