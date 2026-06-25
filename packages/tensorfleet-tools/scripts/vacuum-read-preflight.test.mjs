#!/usr/bin/env bun

import assert from "node:assert/strict";
import http from "node:http";
import { clearConfig, clearGlobalAuthInfo } from "tensorfleet-auth";
import { executeVacuumTool } from "../dist/index.mjs";

const ENV_KEYS = [
  "TENSORFLEET_JWT",
  "TENSORFLEET_VM_MANAGER_URL",
  "TENSORFLEET_VALETUDO_RUNTIME_URL",
  "TENSORFLEET_VACUUM_BACKEND",
];

async function main() {
  await testReadActionsWithMissingRuntime();
  await testNavigationReadinessInputValidation();
  await testCleanAreaReadinessInputValidation();
  await testReadinessWithMissingRuntime();
  await withRuntimeFixture(async (runtime) => {
    await testCompactSnapshotProjection(runtime);
    await testMapPoseMissionNavigationReadActions(runtime);
    await testRealVacuumReadinessUnsupported(runtime);
    await testSendCommandRefusesWithoutDispatch(runtime);
  });
  console.log("vacuum read/preflight regression tests passed");
}

async function testReadActionsWithMissingRuntime() {
  for (const action of [
    "get-health",
    "get-snapshot",
    "get-capabilities",
    "get-map-summary",
    "get-mission-state",
    "get-navigation-state",
    "get-pose",
  ]) {
    resetRuntimeConfig();
    const response = await callVacuum({ action, backend: "simulation" });
    assert.equal(response.success, false, `${action} should be unavailable without runtime config`);
    assert.equal(response.status, "not_authenticated");
    assert.equal(JSON.stringify(response).includes("secret-token"), false);
    assert.equal(JSON.stringify(response).includes("http://runtime.test"), false);
  }
}

async function testNavigationReadinessInputValidation() {
  resetRuntimeConfig();
  const missing = await callVacuum({ action: "check-navigation-readiness", backend: "simulation" });
  assert.equal(missing.success, true);
  assert.equal(missing.status, "needs_input");
  assert.deepEqual(missing.preflight.missingFields, ["target"]);
  assert.equal(missing.preflight.ready, false);
  assert.equal(missing.preflight.canDispatchCommand, false);

  resetRuntimeConfig();
  const partial = await callVacuum({
    action: "check-navigation-readiness",
    backend: "simulation",
    target: { x: 1 },
  });
  assert.equal(partial.status, "needs_input");
  assert.deepEqual(partial.preflight.missingFields, ["target.y", "target.theta"]);

  resetRuntimeConfig();
  const malformed = await callVacuum({
    action: "check-navigation-readiness",
    backend: "simulation",
    target: { x: "1", y: 0.5, theta: 0 },
  });
  assert.equal(malformed.status, "invalid_request");
  assert.deepEqual(malformed.preflight.invalidFields, ["target.x"]);
}

async function testCleanAreaReadinessInputValidation() {
  resetRuntimeConfig();
  const missing = await callVacuum({ action: "check-clean-area-readiness", backend: "simulation" });
  assert.equal(missing.success, true);
  assert.equal(missing.status, "needs_input");
  assert.deepEqual(missing.preflight.missingFields, ["area"]);
  assert.equal(missing.preflight.ready, false);
  assert.equal(missing.preflight.canDispatchCommand, false);

  resetRuntimeConfig();
  const malformed = await callVacuum({
    action: "check-clean-area-readiness",
    backend: "simulation",
    area: { type: "rectangle", x: 0, y: 0, width: -1, height: "0.5" },
  });
  assert.equal(malformed.status, "invalid_request");
  assert.deepEqual(malformed.preflight.invalidFields, ["area.width", "area.height"]);
}

async function testReadinessWithMissingRuntime() {
  resetRuntimeConfig();
  const navigation = await callVacuum({
    action: "check-navigation-readiness",
    backend: "simulation",
    target: { x: 1, y: 0.5, theta: 0 },
  });
  assert.equal(navigation.success, true);
  assert.equal(navigation.status, "not_authenticated");
  assert.equal(navigation.preflight.ready, false);
  assert.ok(navigation.preflight.blockers.some((blocker) => blocker.includes("auth token")));

  resetRuntimeConfig();
  const cleanArea = await callVacuum({
    action: "check-clean-area-readiness",
    backend: "simulation",
    area: { type: "rectangle", x: 0, y: 0, width: 1, height: 0.75 },
  });
  assert.equal(cleanArea.success, true);
  assert.equal(cleanArea.status, "not_authenticated");
  assert.equal(cleanArea.preflight.ready, false);
  assert.ok(cleanArea.preflight.blockers.some((blocker) => blocker.includes("auth token")));
}

async function testCompactSnapshotProjection(runtime) {
  resetRuntimeConfig();
  const response = await callVacuum({
    action: "get-snapshot",
    backend: "real_vacuum",
    routeMode: "direct",
    runtimeUrl: runtime.url,
  });
  const text = JSON.stringify(response);

  assert.equal(response.success, true);
  assert.equal(response.backend, "real_vacuum");
  assert.equal(response.snapshot.map.cellSummary.totalCells, 0);
  assert.equal(response.snapshot.map.grid, undefined);
  assert.equal(text.includes("rawCapabilityNames"), false);
  assert.equal(text.includes("BasicControlCapability"), false);
  assert.equal(text.includes("/map"), false);
}

async function testMapPoseMissionNavigationReadActions(runtime) {
  resetRuntimeConfig();
  const map = await callVacuum({
    action: "get-map-summary",
    backend: "real_vacuum",
    routeMode: "direct",
    runtimeUrl: runtime.url,
  });
  assert.equal(map.map.available, true);
  assert.equal(map.map.cellSummary.totalCells, 0);
  assert.equal(map.map.grid, undefined);
  assert.equal(map.map.targetCounts.segments, 1);
  assert.equal(map.map.navigationUsability.usable, false);
  assert.equal(map.map.coverageUsability.usable, false);

  resetRuntimeConfig();
  const pose = await callVacuum({
    action: "get-pose",
    backend: "real_vacuum",
    routeMode: "direct",
    runtimeUrl: runtime.url,
  });
  assert.equal(pose.pose.available, false);
  assert.equal(pose.pose.coordinates, null);
  assert.ok(pose.pose.reason);

  resetRuntimeConfig();
  const mission = await callVacuum({
    action: "get-mission-state",
    backend: "real_vacuum",
    routeMode: "direct",
    runtimeUrl: runtime.url,
  });
  assert.equal(mission.activeMission, null);
  assert.equal(mission.mission.state, "idle");

  resetRuntimeConfig();
  const navigation = await callVacuum({
    action: "get-navigation-state",
    backend: "real_vacuum",
    routeMode: "direct",
    runtimeUrl: runtime.url,
  });
  assert.equal(navigation.navigation.active, false);
  assert.equal(navigation.navigation.pathSummary.available, false);
}

async function testRealVacuumReadinessUnsupported(runtime) {
  resetRuntimeConfig();
  const navigation = await callVacuum({
    action: "check-navigation-readiness",
    backend: "real_vacuum",
    routeMode: "direct",
    runtimeUrl: runtime.url,
    target: { x: 1, y: 1, theta: 0 },
  });
  assert.equal(navigation.success, true);
  assert.equal(navigation.preflight.ready, false);
  assert.equal(navigation.preflight.status, "unsupported");
  assert.ok(navigation.preflight.blockers.some((blocker) => blocker.includes("Real-vacuum navigation readiness is unsupported")));

  resetRuntimeConfig();
  const cleanArea = await callVacuum({
    action: "check-clean-area-readiness",
    backend: "real_vacuum",
    routeMode: "direct",
    runtimeUrl: runtime.url,
    area: { type: "rectangle", x: 0, y: 0, width: 1, height: 0.75 },
  });
  assert.equal(cleanArea.preflight.ready, false);
  assert.equal(cleanArea.preflight.status, "unsupported");
  assert.ok(cleanArea.preflight.blockers.some((blocker) => blocker.includes("Real-vacuum clean-area readiness is unsupported")));
}

async function testSendCommandRefusesWithoutDispatch(runtime) {
  resetRuntimeConfig();
  const before = runtime.commandPostCount;
  const response = await callVacuum({
    action: "send-command",
    backend: "real_vacuum",
    routeMode: "direct",
    runtimeUrl: runtime.url,
    command: "start_cleaning",
  });

  assert.equal(response.success, false);
  assert.equal(response.result.ok, false);
  assert.equal(response.result.error.code, "unsupported");
  assert.equal(runtime.commandPostCount, before);
}

async function withRuntimeFixture(fn) {
  const state = { commandPostCount: 0 };
  const server = http.createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.method === "GET" && request.url === "/api/v1/valetudo/health") {
      response.end(JSON.stringify(runtimeHealth()));
      return;
    }
    if (request.method === "GET" && request.url === "/api/v1/valetudo/snapshot") {
      response.end(JSON.stringify(runtimeSnapshot()));
      return;
    }
    if (request.method === "POST" && request.url === "/api/v1/valetudo/command") {
      state.commandPostCount += 1;
      response.end(JSON.stringify({ ok: false, status: "unsupported", command: "start_cleaning", message: "not used", updatedAt: Date.now() }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const runtime = {
    get commandPostCount() {
      return state.commandPostCount;
    },
    url: `http://127.0.0.1:${address.port}`,
  };

  try {
    await fn(runtime);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function runtimeHealth() {
  return {
    runtime: { id: "fixture-runtime", version: "test", status: "online" },
    source: { kind: "fixed_mock", status: "reachable", stale: false, lastSeenAt: Date.now() },
    updatedAt: Date.now(),
  };
}

function runtimeSnapshot() {
  return {
    ...runtimeHealth(),
    backend: "valetudo",
    robot: { id: "fixture-vacuum", name: "Fixture Vacuum" },
    connectivity: { reachable: true, online: true },
    state: { value: "idle", label: "Idle", started: false, paused: false },
    battery: { level: 87, charging: false },
    dock: { state: "docked", docked: true },
    map: {
      available: true,
      source: "fixed_mock",
      updatedAt: Date.now(),
      metadata: {
        id: "fixture-map",
        width: 100,
        height: 80,
        pixelSize: 0.05,
        coordinateSystem: "valetudo_pixel",
        layerCount: 1,
        entityCount: 1,
        segmentCount: 1,
        zoneCount: 0,
      },
      preview: {
        layers: [{ id: "floor", kind: "floor", runs: [{ x: 0, y: 0, count: 5 }] }],
        entities: [{ id: "robot", kind: "robot", points: [{ x: 1, y: 1 }] }],
      },
      targets: {
        segments: [{ id: "1", label: "Kitchen", kind: "room", available: true }],
        zones: [],
      },
      detail: "Fixture map is available.",
    },
    capabilities: {
      commands: {
        start_cleaning: { available: true },
        pause: { available: false, reason: "invalid_state" },
        stop: { available: false, reason: "invalid_state" },
        return_to_dock: { available: false, reason: "invalid_state" },
      },
      diagnostics: [{ name: "BasicControlCapability", detected: true, implemented: true, scope: "runtime" }],
    },
    diagnostics: {
      mode: "fixture",
      rawCapabilityNames: ["BasicControlCapability", "GoToLocationCapability"],
    },
    updatedAt: Date.now(),
  };
}

async function callVacuum(params) {
  const result = await executeVacuumTool("vacuum-read-preflight-test", params);
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
