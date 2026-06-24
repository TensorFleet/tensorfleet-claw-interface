#!/usr/bin/env bun

import assert from "node:assert/strict";
import { clearConfig, clearGlobalAuthInfo } from "tensorfleet-auth";
import { executeVacuumTool } from "../dist/index.mjs";

const ENV_KEYS = [
  "TENSORFLEET_JWT",
  "TENSORFLEET_VM_MANAGER_URL",
  "TENSORFLEET_VALETUDO_RUNTIME_URL",
  "TENSORFLEET_VACUUM_BACKEND",
];

async function main() {
  await testMissingBackend();
  await testSimulationDiscoveryWithMissingRuntime();
  await testRealVacuumDirectDiscovery();
  await testVmManagerConfigReporting();
  await testAliasResolution();
  await testForbiddenToolsAreNotAdvertised();
  console.log("vacuum capability discovery regression tests passed");
}

async function testMissingBackend() {
  resetRuntimeConfig();
  const response = await callVacuum({ action: "get-supported-actions" });

  assert.equal(response.success, false);
  assert.equal(response.status, "invalid_state");
  assert.equal(response.error.code, "invalid_state");
  assert.equal(response.canMoveVacuumNow, false);
  assert.deepEqual(response.vacuumTool.exposedOpenClawTools, ["tensorfleet-vacuum"]);
}

async function testSimulationDiscoveryWithMissingRuntime() {
  resetRuntimeConfig();
  const response = await callVacuum({ action: "get-supported-actions", backend: "simulation" });

  assert.equal(response.success, true);
  assert.equal(response.backend, "simulation");
  assert.equal(response.backendAdapter, "turtlebot4_nav2");
  assert.equal(response.status, "not_authenticated");
  assert.equal(response.runtime.auth.available, false);
  assert.equal(response.runtime.vmManagerUrl.available, false);
  assert.equal(response.canMoveVacuumNow, false);
  assert.deepEqual(response.actions.stateChangingCallableTools, []);
  assert.deepEqual(response.actions.movementStartCallableTools, []);
  assert.ok(response.actions.readOnlyCallableTools.some((entry) => entry.action === "get-supported-actions"));
  assert.ok(response.actions.supportedButCurrentlyUnavailableActions.some((entry) => entry.action === "send-command"));
  assert.ok(response.actions.unsupportedActions.some((entry) => entry.command === "start_cleaning"));
}

async function testRealVacuumDirectDiscovery() {
  resetRuntimeConfig();
  const response = await callVacuum({
    action: "get-supported-actions",
    backend: "real_vacuum",
    routeMode: "direct",
    runtimeUrl: "http://runtime.test",
  });

  assert.equal(response.success, true);
  assert.equal(response.status, "available");
  assert.equal(response.backend, "real_vacuum");
  assert.equal(response.backendAdapter, "valetudo");
  assert.equal(response.runtime.routeMode, "direct");
  assert.equal(response.runtime.runtimeUrl.available, true);
  assert.equal(response.runtime.runtimeUrl.source, "param");
  assert.equal(response.runtime.auth.available, false);
  assert.equal(response.canMoveVacuumNow, false);
  assert.deepEqual(response.actions.movementStartCallableTools, []);
  assert.ok(response.actions.writeCapableButGatedActions.some((entry) => entry.action === "send-command"));
}

async function testVmManagerConfigReporting() {
  resetRuntimeConfig();
  const response = await callVacuum({
    action: "get-supported-actions",
    backend: "real_vacuum",
    routeMode: "vm-manager",
  });

  assert.equal(response.status, "not_authenticated");
  assert.equal(response.runtime.auth.available, false);
  assert.equal(response.runtime.vmManagerUrl.available, false);
  assert.ok(response.runtime.blockers.some((blocker) => blocker.includes("auth token")));
  assert.ok(response.runtime.blockers.some((blocker) => blocker.includes("TENSORFLEET_VM_MANAGER_URL")));
  assert.equal(JSON.stringify(response).includes("http://localhost"), false);
}

async function testAliasResolution() {
  resetRuntimeConfig();
  const simulation = await callVacuum({ action: "get-supported-actions", backend: "turtlebot4_nav2" });
  assert.equal(simulation.backend, "simulation");
  assert.equal(simulation.backendAdapter, "turtlebot4_nav2");

  resetRuntimeConfig();
  const valetudo = await callVacuum({
    action: "get-supported-actions",
    backend: "valetudo",
    routeMode: "direct",
    runtimeUrl: "http://runtime.test",
  });
  assert.equal(valetudo.backend, "real_vacuum");
  assert.equal(valetudo.backendAdapter, "valetudo");
}

async function testForbiddenToolsAreNotAdvertised() {
  resetRuntimeConfig();
  const response = await callVacuum({
    action: "get-supported-actions",
    backend: "real_vacuum",
    routeMode: "direct",
    runtimeUrl: "http://runtime.test",
  });
  const advertisedToolNames = JSON.stringify(response.vacuumTool.exposedOpenClawTools);
  const fullResponse = JSON.stringify(response);

  assert.equal(advertisedToolNames.includes("tensorfleet-telemetry-ros"), false);
  assert.equal(advertisedToolNames.includes("foxglove"), false);
  assert.equal(advertisedToolNames.includes("shell"), false);
  assert.equal(advertisedToolNames.includes("filesystem"), false);
  assert.ok(fullResponse.includes("deferredActions"));
  assert.ok(response.actions.deferredActions.every((entry) => entry.callable === false));
  assert.ok(response.actions.readOnlyActions.every((entry) => entry.tool === "tensorfleet-vacuum"));
  assert.ok(response.actions.writeActions.every((entry) => entry.tool === "tensorfleet-vacuum"));
}

async function callVacuum(params) {
  const result = await executeVacuumTool("vacuum-discovery-test", params);
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, "text");
  return JSON.parse(result.content[0].text);
}

function resetRuntimeConfig() {
  clearConfig();
  clearGlobalAuthInfo();
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
