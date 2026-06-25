#!/usr/bin/env bun

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import plugin, { tensorfleetToolNames } from "../dist/dist/index.js";
import { vacuumSchema } from "tensorfleet-tools";

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

  assert.equal(typeof plugin.register, "function", "built plugin must expose an OpenClaw register(api) entrypoint");
  assert.deepEqual(tensorfleetToolNames, manifest.contracts.tools);

  const registeredTools = [];
  plugin.register({
    registerTool(tool) {
      registeredTools.push(tool);
    },
  });

  const registeredNames = registeredTools.map((tool) => tool.name);
  assert.deepEqual(registeredNames, manifest.contracts.tools);
  const vacuumTool = registeredTools.find((tool) => tool.name === "tensorfleet-vacuum");
  assert.ok(vacuumTool, "runtime registration must include tensorfleet-vacuum");

  assert.ok(vacuumSchema.properties.action.enum.includes("get-supported-actions"));

  const resultText = await vacuumTool.execute("openclaw-plugin-discovery-smoke", {
    action: "get-supported-actions",
    backend: "simulation",
  });
  assert.equal(typeof resultText, "string");

  const response = JSON.parse(resultText);
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
