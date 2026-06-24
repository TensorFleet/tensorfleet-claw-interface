#!/usr/bin/env bun

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";
import plugin from "../dist/dist/index.js";
import { executeVacuumTool, vacuumSchema } from "tensorfleet-tools";

const ENV_KEYS = [
  "TENSORFLEET_JWT",
  "TENSORFLEET_VM_MANAGER_URL",
  "TENSORFLEET_VALETUDO_RUNTIME_URL",
  "TENSORFLEET_VACUUM_BACKEND",
];

async function main() {
  resetRuntimeConfig();

  const manifest = JSON.parse(await readFile(new URL("../openclaw.plugin.json", import.meta.url), "utf8"));
  assert.ok(manifest.contracts.tools.includes("tensorfleet-vacuum"));

  const metadata = getToolPluginMetadata(plugin);
  assert.ok(metadata, "built plugin must expose OpenClaw tool-plugin metadata");
  const vacuumTool = metadata.tools.find((tool) => tool.name === "tensorfleet-vacuum");
  assert.ok(vacuumTool, "metadata must include tensorfleet-vacuum");
  assert.equal(metadata.tools.length, manifest.contracts.tools.length);

  assert.ok(vacuumSchema.properties.action.enum.includes("get-supported-actions"));

  const result = await executeVacuumTool("openclaw-plugin-discovery-smoke", {
    action: "get-supported-actions",
    backend: "simulation",
  });
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, "text");

  const response = JSON.parse(result.content[0].text);
  assert.equal(response.success, true);
  assert.equal(response.backend, "simulation");
  assert.equal(response.backendAdapter, "turtlebot4_nav2");
  assert.equal(response.status, "not_authenticated");
  assert.deepEqual(response.vacuumTool.exposedOpenClawTools, ["tensorfleet-vacuum"]);
  assert.ok(response.actions.readOnlyCallableTools.some((entry) => entry.action === "get-supported-actions"));
  assert.deepEqual(response.actions.movementStartCallableTools, []);
  assert.equal(response.canMoveVacuumNow, false);

  console.log("OpenClaw plugin vacuum discovery smoke passed");
}

function resetRuntimeConfig() {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}).then(() => {
  process.exit(0);
});
