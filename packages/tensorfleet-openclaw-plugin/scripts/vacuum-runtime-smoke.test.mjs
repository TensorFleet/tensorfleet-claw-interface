#!/usr/bin/env bun

import assert from "node:assert/strict";
import plugin from "../dist/dist/index.js";
import { vacuumSchema } from "tensorfleet-tools";

const ENV_KEYS = [
  "TENSORFLEET_JWT",
  "TENSORFLEET_VM_MANAGER_URL",
  "TENSORFLEET_VALETUDO_RUNTIME_URL",
  "TENSORFLEET_VACUUM_BACKEND",
];

const WRITE_ACTIONS = [
  "start-navigation",
  "start-clean-area",
  "start-room-cleaning",
  "start-zone-cleaning",
  "pause-mission",
  "resume-mission",
  "cancel-mission",
  "retry-mission-step",
  "skip-mission-step",
];

const TARGET_READ_ACTIONS = [
  "get-map-targets",
  "get-room-targets",
  "get-zone-targets",
  "check-room-cleaning-readiness",
  "check-zone-cleaning-readiness",
];

async function main() {
  resetRuntimeConfig();
  const vacuumTool = registeredVacuumTool();

  await testSchemaIncludesWriteActions();
  await testMissingConfigRefusal(vacuumTool);
  await testCleanAreaMissingConfigRefusal(vacuumTool);
  await testInvalidNavigationTargetRefusal(vacuumTool);
  await testInvalidCleanAreaRefusal(vacuumTool);
  await testMissingZoneSelectorRefusal(vacuumTool);
  await testMissionControlMissingConfigRefusal(vacuumTool);
  await testCancelMissionMissingConfigRefusal(vacuumTool);
  await testRealVacuumNavigationRefusal(vacuumTool);
  await testRealVacuumRoomRefusal(vacuumTool);
  await testRealVacuumDiscoveryDoesNotAdvertiseRoomZoneWrites(vacuumTool);
  await testSendCommandCannotBypassRuntimeGates(vacuumTool);
  await testConfiguredDiscoveryReportsSourcesWithoutValues(vacuumTool);

  console.log("OpenClaw plugin vacuum runtime smoke passed");
}

function registeredVacuumTool() {
  const registeredTools = [];
  plugin.register({
    registerTool(tool) {
      registeredTools.push(tool);
    },
  });

  const vacuumTool = registeredTools.find((tool) => tool.name === "tensorfleet-vacuum");
  assert.ok(vacuumTool, "runtime registration must include tensorfleet-vacuum");
  assert.equal(typeof vacuumTool.execute, "function", "registered vacuum tool must expose execute()");
  return vacuumTool;
}

async function testSchemaIncludesWriteActions() {
  for (const action of [...WRITE_ACTIONS, ...TARGET_READ_ACTIONS]) {
    assert.ok(vacuumSchema.properties.action.enum.includes(action), `schema must include ${action}`);
  }
}

async function testMissingConfigRefusal(vacuumTool) {
  resetRuntimeConfig();
  const response = await callVacuum(vacuumTool, "missing-config-navigation", {
    action: "start-navigation",
    backend: "simulation",
    target: { x: 1, y: 0.5, theta: 0 },
  });

  assert.equal(response.success, false);
  assert.equal(response.status, "not_authenticated");
  assert.equal(response.backend, "simulation");
  assert.equal(response.backendAdapter, "turtlebot4_nav2");
  assert.equal(response.runtime.auth.available, false);
  assert.equal(response.runtime.auth.source, "missing");
  assert.equal(response.runtime.vmManagerUrl.available, false);
  assert.equal(response.runtime.vmManagerUrl.source, "missing");
  assert.ok(response.runtime.blockers.some((blocker) => blocker.includes("auth token")));
  assert.ok(response.runtime.blockers.some((blocker) => blocker.includes("TENSORFLEET_VM_MANAGER_URL")));
  assertNoSecretOrEndpointLeak(response);
}

async function testInvalidNavigationTargetRefusal(vacuumTool) {
  resetRuntimeConfig();
  const response = await callVacuum(vacuumTool, "invalid-navigation-target", {
    action: "start-navigation",
    backend: "simulation",
    target: { x: 1 },
  });

  assert.equal(response.success, false);
  assert.equal(response.status, "needs_input");
  assert.deepEqual(response.missingFields, ["target.y", "target.theta"]);
  assert.deepEqual(response.invalidFields, []);
  assert.equal(response.commandDispatched, false);
  assert.equal(response.runtime, undefined, "invalid target should refuse before runtime preflight");
}

async function testCleanAreaMissingConfigRefusal(vacuumTool) {
  resetRuntimeConfig();
  const response = await callVacuum(vacuumTool, "missing-config-clean-area", {
    action: "start-clean-area",
    backend: "simulation",
    area: { type: "rectangle", x: 0, y: 0, width: 1, height: 0.75 },
  });

  assert.equal(response.success, false);
  assert.equal(response.status, "not_authenticated");
  assert.equal(response.backend, "simulation");
  assert.equal(response.backendAdapter, "turtlebot4_nav2");
  assert.ok(response.runtime.blockers.some((blocker) => blocker.includes("auth token")));
  assert.ok(response.runtime.blockers.some((blocker) => blocker.includes("TENSORFLEET_VM_MANAGER_URL")));
  assertNoSecretOrEndpointLeak(response);
}

async function testInvalidCleanAreaRefusal(vacuumTool) {
  resetRuntimeConfig();
  const response = await callVacuum(vacuumTool, "invalid-clean-area", {
    action: "start-clean-area",
    backend: "simulation",
    area: { type: "rectangle", x: 0, y: 0, width: -1, height: 1 },
  });

  assert.equal(response.success, false);
  assert.equal(response.status, "invalid_request");
  assert.deepEqual(response.missingFields, []);
  assert.deepEqual(response.invalidFields, ["area.width"]);
  assert.equal(response.commandDispatched, false);
  assert.equal(response.runtime, undefined, "invalid area should refuse before runtime preflight");
}

async function testMissingZoneSelectorRefusal(vacuumTool) {
  resetRuntimeConfig();
  const response = await callVacuum(vacuumTool, "missing-zone-selector", {
    action: "start-zone-cleaning",
    backend: "simulation",
  });

  assert.equal(response.success, false);
  assert.equal(response.status, "needs_input");
  assert.deepEqual(response.missingFields, ["zone"]);
  assert.equal(response.commandDispatched, false);
  assert.equal(response.runtime, undefined, "missing zone selector should refuse before runtime preflight");
  assertNoSecretOrEndpointLeak(response);
}

async function testMissionControlMissingConfigRefusal(vacuumTool) {
  resetRuntimeConfig();
  const response = await callVacuum(vacuumTool, "missing-config-pause", {
    action: "pause-mission",
    backend: "simulation",
  });

  assert.equal(response.success, false);
  assert.equal(response.status, "not_authenticated");
  assert.equal(response.backend, "simulation");
  assert.ok(response.runtime.blockers.length >= 1);
  assertNoSecretOrEndpointLeak(response);
}

async function testCancelMissionMissingConfigRefusal(vacuumTool) {
  resetRuntimeConfig();
  const response = await callVacuum(vacuumTool, "missing-config-cancel", {
    action: "cancel-mission",
    backend: "simulation",
  });

  assert.equal(response.success, false);
  assert.equal(response.status, "not_authenticated");
  assert.equal(response.backend, "simulation");
  assert.ok(response.runtime.blockers.length >= 1);
  assertNoSecretOrEndpointLeak(response);
}

async function testRealVacuumNavigationRefusal(vacuumTool) {
  resetRuntimeConfig();
  const response = await callVacuum(vacuumTool, "real-vacuum-navigation-refusal", {
    action: "start-navigation",
    backend: "real_vacuum",
    target: { x: 1, y: 1, theta: 0 },
  });

  assert.equal(response.success, false);
  assert.equal(response.status, "unsupported");
  assert.equal(response.backend, "real_vacuum");
  assert.equal(response.backendAdapter, "valetudo");
  assert.equal(response.commandDispatched, false);
  assert.equal(response.runtime, undefined, "real-vacuum write refusal should not inspect or switch runtime config");
  assert.match(response.reason, /simulation backend/);
}

async function testRealVacuumRoomRefusal(vacuumTool) {
  resetRuntimeConfig();
  const response = await callVacuum(vacuumTool, "real-vacuum-room-refusal", {
    action: "start-room-cleaning",
    backend: "real_vacuum",
    room: { id: "3" },
  });

  assert.equal(response.success, false);
  assert.equal(response.status, "unsupported");
  assert.equal(response.backend, "real_vacuum");
  assert.equal(response.backendAdapter, "valetudo");
  assert.equal(response.commandDispatched, false);
  assert.equal(response.runtime, undefined, "real-vacuum room write refusal should not inspect runtime config");
  assert.match(response.reason, /simulation backend/);
  assertNoSecretOrEndpointLeak(response);
}

async function testRealVacuumDiscoveryDoesNotAdvertiseRoomZoneWrites(vacuumTool) {
  resetRuntimeConfig();
  const response = await callVacuum(vacuumTool, "real-vacuum-discovery", {
    action: "get-supported-actions",
    backend: "real_vacuum",
    routeMode: "direct",
  });

  assert.equal(response.success, true);
  assert.equal(response.backend, "real_vacuum");
  assert.equal(response.backendAdapter, "valetudo");
  assert.equal(
    response.actions.movementStartCallableTools.some((entry) => entry.action === "start-room-cleaning"),
    false,
  );
  assert.equal(
    response.actions.movementStartCallableTools.some((entry) => entry.action === "start-zone-cleaning"),
    false,
  );
  assertNoSecretOrEndpointLeak(response);
}

async function testSendCommandCannotBypassRuntimeGates(vacuumTool) {
  resetRuntimeConfig();
  const response = await callVacuum(vacuumTool, "send-command-room-bypass", {
    action: "send-command",
    backend: "simulation",
    command: "start_room_cleaning",
  });

  assert.equal(response.success, false);
  assert.equal(response.status, "not_authenticated");
  assert.equal(response.runtime.auth.available, false);
  assert.equal(response.runtime.vmManagerUrl.available, false);
  assertNoSecretOrEndpointLeak(response);
}

async function testConfiguredDiscoveryReportsSourcesWithoutValues(vacuumTool) {
  resetRuntimeConfig();
  const response = await callVacuum(vacuumTool, "configured-discovery", {
    action: "get-supported-actions",
    backend: "simulation",
    TENSORFLEET_JWT: "test-token-that-must-not-leak",
    TENSORFLEET_VM_MANAGER_URL: "https://vm-manager.example.invalid",
  });

  assert.equal(response.success, true);
  assert.equal(response.status, "available");
  assert.equal(response.runtime.auth.available, true);
  assert.equal(response.runtime.auth.source, "tool-env-param");
  assert.equal(response.runtime.vmManagerUrl.available, true);
  assert.equal(response.runtime.vmManagerUrl.source, "tool-env-param");
  assert.equal(response.runtime.runtimeUrl.available, false);
  assert.equal(response.runtime.routeMode, "vm-manager");
  assertNoSecretOrEndpointLeak(response);
}

async function callVacuum(vacuumTool, id, params) {
  const result = await withTimeout(
    vacuumTool.execute(`openclaw-plugin-vacuum-runtime-smoke:${id}`, params),
    2500,
    id,
  );
  return normalizeToolResult(result, id);
}

function normalizeToolResult(result, id) {
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
  assert.fail(`${id} must return OpenClaw text output`);
}

async function withTimeout(promise, timeoutMs, id) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${id} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function assertNoSecretOrEndpointLeak(response) {
  const text = JSON.stringify(response);
  assert.equal(text.includes("test-token-that-must-not-leak"), false);
  assert.equal(text.includes("https://vm-manager.example.invalid"), false);
  assert.equal(text.includes("localhost"), false);
  assert.equal(text.includes("/vacuum_mission"), false);
  assert.equal(text.includes("/navigate_to_pose"), false);
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
