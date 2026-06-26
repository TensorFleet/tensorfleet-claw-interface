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
const SECRET_SENTINELS = [
  "test-secret-jwt-token",
  "https://secret.vm-manager.example.invalid",
  "https://secret.valetudo-runtime.example.invalid",
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

  for (const action of [
    "get-supported-actions",
    "get-map-targets",
    "get-room-targets",
    "get-zone-targets",
    "get-navigation-state",
    "get-pose",
    "check-navigation-readiness",
    "check-clean-area-readiness",
    "check-room-cleaning-readiness",
    "check-zone-cleaning-readiness",
    "start-navigation",
    "start-clean-area",
    "pause-mission",
    "resume-mission",
    "cancel-mission",
    "retry-mission-step",
    "skip-mission-step",
  ]) {
    assert.ok(vacuumSchema.properties.action.enum.includes(action), `schema must include ${action}`);
  }

  const response = normalizeToolResult(await vacuumTool.execute("openclaw-plugin-discovery-smoke", {
    action: "get-supported-actions",
    backend: "simulation",
  }));
  const responseText = JSON.stringify(response);
  assert.equal(response.success, true);
  assert.equal(response.backend, "simulation");
  assert.equal(response.backendAdapter, "turtlebot4_nav2");
  assert.equal(response.backendSelection.selectedBackend, "simulation");
  assert.equal(response.backendSelection.normalizedBackendAdapter, "turtlebot4_nav2");
  assert.equal(response.status, "not_authenticated");
  assert.equal(response.runtime.auth.available, false);
  assert.equal(response.runtime.auth.source, "missing");
  assert.equal(response.runtime.vmManagerUrl.available, false);
  assert.equal(response.runtime.vmManagerUrl.source, "missing");
  assert.equal(response.runtime.runtimeUrl.available, false);
  assert.equal(response.runtime.runtimeUrl.source, "missing");
  assert.equal("token" in response.runtime.auth, false);
  assert.equal("value" in response.runtime.vmManagerUrl, false);
  assert.equal("value" in response.runtime.runtimeUrl, false);
  assert.deepEqual(response.vacuumTool.exposedOpenClawTools, ["tensorfleet-vacuum"]);
  assert.ok(response.actions.readOnlyCallableTools.some((entry) => entry.action === "get-supported-actions"));
  assert.ok(response.actions.readOnlyActions.some((entry) => entry.action === "get-navigation-state"));
  assert.ok(response.actions.readOnlyActions.some((entry) => entry.action === "get-pose"));
  assert.ok(response.actions.readOnlyActions.some((entry) => entry.action === "check-navigation-readiness"));
  assert.ok(response.actions.readOnlyActions.some((entry) => entry.action === "check-clean-area-readiness"));
  assert.ok(response.actions.readOnlyActions.some((entry) => entry.action === "get-room-targets"));
  assert.ok(response.actions.readOnlyActions.some((entry) => entry.action === "get-zone-targets"));
  assert.ok(response.actions.readOnlyActions.some((entry) => entry.action === "check-room-cleaning-readiness"));
  assert.ok(response.actions.readOnlyActions.some((entry) => entry.action === "check-zone-cleaning-readiness"));
  assert.ok(response.actions.missionControlCallableTools.some((entry) => entry.action === "pause-mission"));
  assert.ok(response.actions.movementStartCallableTools.some((entry) => entry.action === "start-navigation"));
  assert.equal(response.canMoveVacuumNow, false);
  assertNoSecretLeakage(responseText);

  const invalid = normalizeToolResult(await vacuumTool.execute("openclaw-plugin-write-smoke", {
    action: "start-navigation",
    backend: "simulation",
    target: { x: 1 },
  }));
  assert.equal(invalid.success, false);
  assert.equal(invalid.status, "needs_input");
  assert.deepEqual(invalid.missingFields, ["target.y", "target.theta"]);
  assertNoSecretLeakage(JSON.stringify(invalid));

  console.log("OpenClaw plugin vacuum discovery smoke passed");
}

function normalizeToolResult(result) {
  if (typeof result === "string") {
    return JSON.parse(result);
  }
  if (
    result &&
    typeof result === "object" &&
    Array.isArray(result.content) &&
    result.content.length === 1 &&
    result.content[0]?.type === "text" &&
    typeof result.content[0].text === "string"
  ) {
    return JSON.parse(result.content[0].text);
  }
  assert.ok(result && typeof result === "object", "tool result must be a JSON object or JSON string");
  return result;
}

function assertNoSecretLeakage(text) {
  for (const value of SECRET_SENTINELS) {
    assert.equal(text.includes(value), false, "tool result must not leak secret config values");
  }
}

function resetRuntimeConfig() {
  process.env.TENSORFLEET_JWT = SECRET_SENTINELS[0];
  process.env.TENSORFLEET_VM_MANAGER_URL = SECRET_SENTINELS[1];
  process.env.TENSORFLEET_VALETUDO_RUNTIME_URL = SECRET_SENTINELS[2];
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
