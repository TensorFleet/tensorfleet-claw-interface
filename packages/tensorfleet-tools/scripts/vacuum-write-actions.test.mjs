#!/usr/bin/env bun

import assert from "node:assert/strict";
import { clearConfig, clearGlobalAuthInfo } from "tensorfleet-auth";
import { __setVacuumRuntimeContextForTests, executeVacuumTool, vacuumSchema } from "../dist/index.mjs";

const ENV_KEYS = [
  "TENSORFLEET_JWT",
  "TENSORFLEET_VM_MANAGER_URL",
  "TENSORFLEET_VALETUDO_RUNTIME_URL",
  "TENSORFLEET_VACUUM_BACKEND",
];

async function main() {
  await testSchemaIncludesWriteActions();
  await testStartNavigationValidationAndUnsupported();
  await testStartCleanAreaValidationAndUnsupported();
  await testMissingRuntimeBlocksBeforeDispatch();
  await withSimulationFixture(async (fixture) => {
    await testStartNavigationDispatch(fixture);
    await testStartCleanAreaDispatch(fixture);
    await testMissionControlMissingActiveMission(fixture);
    await testMissionControlUnavailableAction(fixture);
    await testMissionControlDispatch(fixture);
    await testSendCommandCannotBypass(fixture);
    await testNoRawNamesOrSecrets(fixture);
  });
  console.log("vacuum write-action regression tests passed");
}

async function testSchemaIncludesWriteActions() {
  for (const action of [
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
}

async function testStartNavigationValidationAndUnsupported() {
  resetRuntimeConfig();
  let response = await callVacuum({ action: "start-navigation", backend: "simulation" });
  assert.equal(response.success, false);
  assert.equal(response.status, "needs_input");
  assert.deepEqual(response.missingFields, ["target"]);

  resetRuntimeConfig();
  response = await callVacuum({
    action: "start-navigation",
    backend: "simulation",
    target: { x: "1", y: 1, theta: 0 },
  });
  assert.equal(response.status, "invalid_request");
  assert.deepEqual(response.invalidFields, ["target.x"]);

  resetRuntimeConfig();
  response = await callVacuum({
    action: "start-navigation",
    backend: "real_vacuum",
    target: { x: 1, y: 1, theta: 0 },
  });
  assert.equal(response.success, false);
  assert.equal(response.status, "unsupported");
  assert.equal(response.backend, "real_vacuum");
}

async function testStartCleanAreaValidationAndUnsupported() {
  resetRuntimeConfig();
  let response = await callVacuum({ action: "start-clean-area", backend: "simulation" });
  assert.equal(response.success, false);
  assert.equal(response.status, "needs_input");
  assert.deepEqual(response.missingFields, ["area"]);

  resetRuntimeConfig();
  response = await callVacuum({
    action: "start-clean-area",
    backend: "simulation",
    area: { type: "rectangle", x: 0, y: 0, width: -1, height: 1 },
  });
  assert.equal(response.status, "invalid_request");
  assert.deepEqual(response.invalidFields, ["area.width"]);

  resetRuntimeConfig();
  response = await callVacuum({
    action: "start-clean-area",
    backend: "real_vacuum",
    area: { type: "rectangle", x: 0, y: 0, width: 1, height: 1 },
  });
  assert.equal(response.success, false);
  assert.equal(response.status, "unsupported");
  assert.equal(response.backend, "real_vacuum");
}

async function testMissingRuntimeBlocksBeforeDispatch() {
  resetRuntimeConfig();
  const response = await callVacuum({
    action: "start-navigation",
    backend: "simulation",
    target: { x: 1, y: 0.5, theta: 0 },
  });
  assert.equal(response.success, false);
  assert.equal(response.status, "not_authenticated");
  assert.ok(response.runtime.blockers.some((blocker) => blocker.includes("auth token")));
}

async function testStartNavigationDispatch(fixture) {
  resetRuntimeConfig();
  fixture.reset();
  const response = await callVacuum(authenticated({
    action: "start-navigation",
    backend: "simulation",
    target: { x: 1, y: 0.5, theta: 0, label: "Test point" },
  }));
  assert.equal(response.success, true);
  assert.equal(response.status, "dispatched");
  assert.equal(response.command.command, "start_navigation");
  assert.equal(response.previousActiveMission, null);
  assert.equal(response.refreshedActiveMission?.requestedCommand, "start_navigation");
  assert.equal(fixture.calls.triggerByCommand.start_navigation, 1);
  assert.equal(fixture.calls.parameterByName.navigation_request, 1);
  const payload = fixture.lastParameterPayload("navigation_request");
  assert.deepEqual(payload, { target: { x: 1, y: 0.5, yaw: 0 } });
}

async function testStartCleanAreaDispatch(fixture) {
  resetRuntimeConfig();
  fixture.reset();
  const response = await callVacuum(authenticated({
    action: "start-clean-area",
    backend: "simulation",
    area: { type: "rectangle", x: 0, y: 0, width: 1, height: 0.75 },
  }));
  assert.equal(response.success, true);
  assert.equal(response.status, "dispatched");
  assert.equal(response.command.command, "start_coverage");
  assert.equal(response.refreshedActiveMission?.requestedCommand, "start_coverage");
  assert.equal(fixture.calls.triggerByCommand.start_coverage, 1);
  assert.equal(fixture.calls.parameterByName.coverage_request, 1);
  const payload = fixture.lastParameterPayload("coverage_request");
  assert.deepEqual(payload.area, { shape: "rectangle", minX: 0, minY: 0, maxX: 1, maxY: 0.75 });
}

async function testMissionControlMissingActiveMission(fixture) {
  resetRuntimeConfig();
  fixture.reset();
  const response = await callVacuum(authenticated({ action: "pause-mission", backend: "simulation" }));
  assert.equal(response.success, false);
  assert.equal(response.status, "blocked");
  assert.ok(response.blockers.some((blocker) => blocker.includes("No active mission")));
  assert.equal(fixture.calls.triggerTotal, 0);
}

async function testMissionControlUnavailableAction(fixture) {
  resetRuntimeConfig();
  fixture.reset();
  fixture.activeMission = mission({ status: "running", availableActions: ["cancel_mission"] });
  const response = await callVacuum(authenticated({ action: "pause-mission", backend: "simulation" }));
  assert.equal(response.success, false);
  assert.equal(response.status, "blocked");
  assert.ok(response.blockers.some((blocker) => blocker.includes("pause_mission")));
  assert.equal(fixture.calls.triggerTotal, 0);
}

async function testMissionControlDispatch(fixture) {
  const cases = [
    ["pause-mission", "pause_mission", "running"],
    ["resume-mission", "resume_mission", "paused"],
    ["cancel-mission", "cancel_mission", "running"],
    ["retry-mission-step", "retry_mission_step", "needs_assistance"],
    ["skip-mission-step", "skip_mission_step", "running"],
  ];

  for (const [action, command, status] of cases) {
    resetRuntimeConfig();
    fixture.reset();
    fixture.activeMission = mission({ status, availableActions: [command] });
    const response = await callVacuum(authenticated({ action, backend: "simulation" }));
    assert.equal(response.success, true, `${action} should dispatch`);
    assert.equal(response.command.command, command);
    assert.equal(fixture.calls.triggerByCommand[command], 1);
  }
}

async function testSendCommandCannotBypass(fixture) {
  resetRuntimeConfig();
  fixture.reset();
  let response = await callVacuum(authenticated({
    action: "send-command",
    backend: "simulation",
    command: "start_cleaning",
  }));
  assert.equal(response.success, false);
  assert.equal(response.result.command, "start_cleaning");
  assert.equal(response.result.error.code, "unsupported");
  assert.equal(fixture.calls.triggerTotal, 0);
  assert.equal(fixture.calls.parameterTotal, 0);

  resetRuntimeConfig();
  fixture.reset();
  response = await callVacuum(authenticated({
    action: "send-command",
    backend: "simulation",
    command: "pause",
  }));
  assert.equal(response.success, false);
  assert.equal(response.result.command, "pause");
  assert.equal(response.result.error.code, "unsupported");
  assert.equal(fixture.calls.triggerTotal, 0);
  assert.equal(fixture.calls.parameterTotal, 0);
}

async function testNoRawNamesOrSecrets(fixture) {
  resetRuntimeConfig();
  fixture.reset();
  const response = await callVacuum(authenticated({ action: "get-supported-actions", backend: "simulation" }));
  const text = JSON.stringify(response);
  assert.equal(text.includes("secret-token"), false);
  assert.equal(text.includes("http://vm-manager.test"), false);
  assert.equal(text.includes("/vacuum_mission"), false);
  assert.equal(text.includes("Nav2"), false);
  assert.equal(text.includes("Valetudo"), false);
}

async function withSimulationFixture(fn) {
  const fixture = createSimulationFixture();
  const fakeRosBridge = {
    isConnected: () => true,
    getAvailableTopics: () => [
      { topic: "/map", type: "nav_msgs/msg/OccupancyGrid" },
      { topic: "/pose", type: "geometry_msgs/msg/PoseWithCovarianceStamped" },
      { topic: "/battery_state", type: "sensor_msgs/msg/BatteryState" },
    ],
    getAvailableServices: () => [
      { service: "/vacuum_mission/start_navigation", type: "std_srvs/srv/Trigger" },
      { service: "/vacuum_mission/start_coverage", type: "std_srvs/srv/Trigger" },
      { service: "/vacuum_mission/cancel", type: "std_srvs/srv/Trigger" },
      { service: "/vacuum_mission/pause", type: "std_srvs/srv/Trigger" },
      { service: "/vacuum_mission/resume", type: "std_srvs/srv/Trigger" },
      { service: "/vacuum_mission/retry_step", type: "std_srvs/srv/Trigger" },
      { service: "/vacuum_mission/skip_step", type: "std_srvs/srv/Trigger" },
      { service: "/vacuum_mission/get_snapshot", type: "tensorfleet/srv/GetMissionSnapshot" },
      { service: "/vacuum_mission_runtime/set_parameters", type: "rcl_interfaces/srv/SetParameters" },
      { service: "/vacuum_map_annotations/get_snapshot", type: "tensorfleet/srv/GetMapAnnotations" },
    ],
    subscribe: (subscription, handler) => {
      if (subscription.topic === "/map") handler(mapMessage());
      if (subscription.topic === "/pose") handler(poseMessage());
      if (subscription.topic === "/battery_state") handler({ percentage: 0.82 });
      return () => undefined;
    },
    callService: async (name, request) => fixture.callService(name, request),
  };
  __setVacuumRuntimeContextForTests({
    rosBridge: fakeRosBridge,
    withRosConnection: async (operation) => await operation(),
  });

  try {
    await fn(fixture);
  } finally {
    __setVacuumRuntimeContextForTests(null);
  }
}

function createSimulationFixture() {
  return {
    activeMission: null,
    calls: emptyCalls(),
    reset() {
      this.activeMission = null;
      this.calls = emptyCalls();
    },
    lastParameterPayload(name) {
      const entry = this.calls.parameters.find((call) => call.name === name);
      assert.ok(entry, `expected parameter ${name}`);
      return JSON.parse(entry.value);
    },
    async callService(name, request) {
      if (name === "/vacuum_mission/get_snapshot") {
        return { active: this.activeMission, recent: [] };
      }
      if (name === "/vacuum_map_annotations/get_snapshot") {
        return { annotations: [] };
      }
      if (name === "/vacuum_mission_runtime/set_parameters") {
        const parameter = request.parameters?.[0];
        this.calls.parameterTotal += 1;
        this.calls.parameterByName[parameter.name] = (this.calls.parameterByName[parameter.name] ?? 0) + 1;
        this.calls.parameters.push({ name: parameter.name, value: parameter.value.string_value });
        return { results: [{ successful: true }] };
      }
      const command = commandForService(name);
      if (command) {
        this.calls.triggerTotal += 1;
        this.calls.triggerByCommand[command] = (this.calls.triggerByCommand[command] ?? 0) + 1;
        if (command === "start_navigation" || command === "start_coverage") {
          this.activeMission = mission({ requestedCommand: command, type: command === "start_navigation" ? "navigation" : "coverage" });
        }
        return { success: true, message: `Dispatched ${command}` };
      }
      throw new Error(`Unexpected service ${name}`);
    },
  };
}

function emptyCalls() {
  return {
    triggerTotal: 0,
    parameterTotal: 0,
    triggerByCommand: {},
    parameterByName: {},
    parameters: [],
  };
}

function commandForService(name) {
  return {
    "/vacuum_mission/start_navigation": "start_navigation",
    "/vacuum_mission/start_coverage": "start_coverage",
    "/vacuum_mission/pause": "pause_mission",
    "/vacuum_mission/resume": "resume_mission",
    "/vacuum_mission/cancel": "cancel_mission",
    "/vacuum_mission/retry_step": "retry_mission_step",
    "/vacuum_mission/skip_step": "skip_mission_step",
  }[name];
}

function mission(overrides = {}) {
  const now = Date.now();
  return {
    id: "fixture-mission",
    type: overrides.type ?? "coverage",
    status: overrides.status ?? "running",
    backendSource: "turtlebot4_nav2",
    startedAt: now,
    updatedAt: now,
    requestedCommand: overrides.requestedCommand ?? "start_coverage",
    phase: overrides.status ?? "running",
    progress: {
      percent: 0.5,
      currentStep: 1,
      totalSteps: 2,
      distanceRemaining: null,
      areaCoveredSqM: null,
      areaRemainingSqM: null,
    },
    availableActions: overrides.availableActions ?? ["pause_mission", "cancel_mission"],
    result: null,
    error: null,
    target: null,
  };
}

function mapMessage() {
  return {
    info: {
      width: 4,
      height: 4,
      resolution: 0.25,
      origin: {
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      },
    },
    data: new Array(16).fill(0),
  };
}

function poseMessage() {
  return {
    pose: {
      pose: {
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      },
    },
  };
}

function authenticated(params) {
  return {
    token: "secret-token",
    vmManagerUrl: "http://vm-manager.test",
    ...params,
  };
}

async function callVacuum(params) {
  const result = await executeVacuumTool("vacuum-write-actions-test", params);
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
