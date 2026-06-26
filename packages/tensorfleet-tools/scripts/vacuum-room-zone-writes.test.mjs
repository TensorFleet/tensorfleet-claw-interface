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
  await testSchemaIncludesRoomZoneWrites();
  await testDiscoveryListsSimulationGatedWrites();
  await testDiscoveryDoesNotListRealVacuumWrites();
  await testMissingInputAndRuntimeRefuseBeforeDispatch();
  await testRealVacuumUnsupportedBeforeDispatch();
  await withSimulationFixture(async (fixture) => {
    await testUnknownTargetsRefuse(fixture);
    await testAmbiguousTargetsRefuse(fixture);
    await testInvalidTargetsRefuse(fixture);
    await testReadyTargetsDispatch(fixture);
    await testSendCommandCannotBypassRoomZoneGates(fixture);
    await testNoRawNamesOrSecrets(fixture);
  });
  console.log("vacuum room/zone write regression tests passed");
}

async function testSchemaIncludesRoomZoneWrites() {
  assert.ok(vacuumSchema.properties.action.enum.includes("start-room-cleaning"));
  assert.ok(vacuumSchema.properties.action.enum.includes("start-zone-cleaning"));
}

async function testDiscoveryListsSimulationGatedWrites() {
  resetRuntimeConfig();
  const response = await callVacuum({ action: "get-supported-actions", backend: "simulation" });
  assert.ok(response.actions.movementStartCallableTools.some((entry) => entry.action === "start-room-cleaning"));
  assert.ok(response.actions.movementStartCallableTools.some((entry) => entry.action === "start-zone-cleaning"));
  assert.ok(response.actions.writeCapableButGatedActions.some((entry) => entry.action === "start-room-cleaning"));
  assert.ok(response.actions.writeActions.some((entry) => entry.action === "start-zone-cleaning"));
  assert.equal(response.canMoveVacuumNow, false);
}

async function testDiscoveryDoesNotListRealVacuumWrites() {
  resetRuntimeConfig();
  const response = await callVacuum({ action: "get-supported-actions", backend: "real_vacuum", routeMode: "direct" });
  assert.equal(response.actions.movementStartCallableTools.some((entry) => entry.action === "start-room-cleaning"), false);
  assert.equal(response.actions.writeActions.some((entry) => entry.action === "start-zone-cleaning"), false);
}

async function testMissingInputAndRuntimeRefuseBeforeDispatch() {
  resetRuntimeConfig();
  let response = await callVacuum({ action: "start-room-cleaning", backend: "simulation" });
  assert.equal(response.success, false);
  assert.equal(response.status, "needs_input");
  assert.deepEqual(response.missingFields, ["room"]);
  assert.equal(response.commandDispatched, false);

  resetRuntimeConfig();
  response = await callVacuum({ action: "start-zone-cleaning", backend: "simulation" });
  assert.equal(response.status, "needs_input");
  assert.deepEqual(response.missingFields, ["zone"]);

  resetRuntimeConfig();
  response = await callVacuum({
    action: "start-room-cleaning",
    backend: "simulation",
    room: { id: "room-kitchen" },
  });
  assert.equal(response.success, false);
  assert.equal(response.status, "not_authenticated");
  assert.ok(response.runtime.blockers.some((blocker) => blocker.includes("auth token")));
}

async function testRealVacuumUnsupportedBeforeDispatch() {
  resetRuntimeConfig();
  let response = await callVacuum({
    action: "start-room-cleaning",
    backend: "real_vacuum",
    room: { id: "3" },
  });
  assert.equal(response.success, false);
  assert.equal(response.status, "unsupported");
  assert.equal(response.backend, "real_vacuum");
  assert.equal(response.commandDispatched, false);

  resetRuntimeConfig();
  response = await callVacuum({
    action: "start-zone-cleaning",
    backend: "real_vacuum",
    zone: { id: "zone-desk" },
  });
  assert.equal(response.status, "unsupported");
  assert.equal(response.backend, "real_vacuum");
}

async function testUnknownTargetsRefuse(fixture) {
  resetRuntimeConfig();
  fixture.reset();
  fixture.annotations = [room("room-kitchen", "Kitchen"), zone("zone-desk", "Desk Zone")];
  let response = await callVacuum(authenticated({
    action: "start-room-cleaning",
    backend: "simulation",
    room: { name: "Pantry" },
  }));
  assert.equal(response.success, false);
  assert.equal(response.status, "not_found");
  assert.equal(response.commandDispatched, false);
  assert.equal(fixture.calls.triggerTotal, 0);
  assert.equal(fixture.calls.parameterTotal, 0);

  resetRuntimeConfig();
  fixture.reset();
  fixture.annotations = [room("room-kitchen", "Kitchen"), zone("zone-desk", "Desk Zone")];
  response = await callVacuum(authenticated({
    action: "start-zone-cleaning",
    backend: "simulation",
    zone: { name: "Bed Zone" },
  }));
  assert.equal(response.status, "not_found");
  assert.equal(fixture.calls.triggerTotal, 0);
}

async function testAmbiguousTargetsRefuse(fixture) {
  resetRuntimeConfig();
  fixture.reset();
  fixture.annotations = [room("room-kitchen-a", "Kitchen"), room("room-kitchen-b", "Kitchen")];
  let response = await callVacuum(authenticated({
    action: "start-room-cleaning",
    backend: "simulation",
    room: { name: "Kitchen" },
  }));
  assert.equal(response.success, false);
  assert.equal(response.status, "ambiguous_target");
  assert.equal(response.candidates.length, 2);
  assert.equal(fixture.calls.triggerTotal, 0);

  resetRuntimeConfig();
  fixture.reset();
  fixture.annotations = [zone("zone-desk-a", "Desk Zone"), zone("zone-desk-b", "Desk Zone")];
  response = await callVacuum(authenticated({
    action: "start-zone-cleaning",
    backend: "simulation",
    zone: { name: "Desk Zone" },
  }));
  assert.equal(response.status, "ambiguous_target");
  assert.equal(response.candidates.length, 2);
  assert.equal(fixture.calls.triggerTotal, 0);
}

async function testInvalidTargetsRefuse(fixture) {
  resetRuntimeConfig();
  fixture.reset();
  fixture.annotations = [room("room-bad", "Bad Room", { minX: 0, minY: 0, maxX: 0, maxY: 1 })];
  let response = await callVacuum(authenticated({
    action: "start-room-cleaning",
    backend: "simulation",
    room: { id: "room-bad" },
  }));
  assert.equal(response.success, false);
  assert.equal(response.status, "invalid_target");
  assert.equal(fixture.calls.triggerTotal, 0);

  resetRuntimeConfig();
  fixture.reset();
  fixture.annotations = [zone("zone-bad", "Bad Zone", { minX: 0, minY: 0, maxX: 1, maxY: 0 })];
  response = await callVacuum(authenticated({
    action: "start-zone-cleaning",
    backend: "simulation",
    zone: { id: "zone-bad" },
  }));
  assert.equal(response.status, "invalid_target");
  assert.equal(fixture.calls.triggerTotal, 0);
}

async function testReadyTargetsDispatch(fixture) {
  resetRuntimeConfig();
  fixture.reset();
  fixture.annotations = [room("room-kitchen", "Kitchen"), zone("zone-desk", "Desk Zone")];
  let response = await callVacuum(authenticated({
    action: "start-room-cleaning",
    backend: "simulation",
    room: { name: "Kitchen" },
  }));
  assert.equal(response.success, true);
  assert.equal(response.status, "dispatched");
  assert.equal(response.command.command, "start_room_cleaning");
  assert.equal(response.resolvedTarget.id, "room-kitchen");
  assert.equal(response.previousActiveMission, null);
  assert.equal(response.refreshedActiveMission?.requestedCommand, "start_room_cleaning");
  assert.equal(fixture.calls.triggerByCommand.start_coverage, 1);
  assert.equal(fixture.calls.parameterByName.coverage_request, 1);
  let payload = fixture.lastParameterPayload("coverage_request");
  assert.equal(payload.missionType, "room_cleaning");
  assert.equal(payload.target.id, "room-kitchen");
  assert.deepEqual(payload.area, { shape: "rectangle", minX: 0, minY: 0, maxX: 1, maxY: 1 });

  resetRuntimeConfig();
  fixture.reset();
  fixture.annotations = [room("room-kitchen", "Kitchen"), zone("zone-desk", "Desk Zone")];
  response = await callVacuum(authenticated({
    action: "start-zone-cleaning",
    backend: "simulation",
    zone: { id: "zone-desk" },
  }));
  assert.equal(response.success, true);
  assert.equal(response.command.command, "start_zone_cleaning");
  assert.equal(response.refreshedActiveMission?.requestedCommand, "start_zone_cleaning");
  assert.equal(fixture.calls.triggerByCommand.start_coverage, 1);
  assert.equal(fixture.calls.parameterByName.coverage_request, 1);
  payload = fixture.lastParameterPayload("coverage_request");
  assert.equal(payload.missionType, "zone_cleaning");
  assert.equal(payload.target.id, "zone-desk");
}

async function testSendCommandCannotBypassRoomZoneGates(fixture) {
  resetRuntimeConfig();
  fixture.reset();
  const response = await callVacuum(authenticated({
    action: "send-command",
    backend: "simulation",
    command: "start_room_cleaning",
  }));
  assert.equal(response.success, false);
  assert.equal(response.result.command, "start_room_cleaning");
  assert.equal(response.result.error.code, "unsupported");
  assert.equal(fixture.calls.triggerTotal, 0);
  assert.equal(fixture.calls.parameterTotal, 0);
}

async function testNoRawNamesOrSecrets(fixture) {
  resetRuntimeConfig();
  fixture.reset();
  fixture.annotations = [room("room-kitchen", "Kitchen")];
  const response = await callVacuum(authenticated({
    action: "start-room-cleaning",
    backend: "simulation",
    room: { id: "room-kitchen" },
  }));
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
    annotations: [],
    calls: emptyCalls(),
    reset() {
      this.activeMission = null;
      this.annotations = [];
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
        return { annotations: this.annotations };
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
          const payload = this.calls.parameters.length > 0
            ? JSON.parse(this.calls.parameters[this.calls.parameters.length - 1].value)
            : {};
          const requestedCommand = payload.missionType === "room_cleaning"
            ? "start_room_cleaning"
            : payload.missionType === "zone_cleaning"
              ? "start_zone_cleaning"
              : command;
          this.activeMission = mission({
            requestedCommand,
            type: payload.missionType ?? (command === "start_navigation" ? "navigation" : "coverage"),
            target: payload.target ?? null,
          });
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

function room(id, name, bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 }) {
  return annotation(id, "room", name, bounds);
}

function zone(id, name, bounds = { minX: 1, minY: 1, maxX: 2, maxY: 2 }) {
  return annotation(id, "zone", name, bounds);
}

function annotation(id, kind, name, bounds) {
  const now = Date.now();
  return {
    id,
    kind,
    name,
    mapId: "fixture-map",
    area: {
      shape: "rectangle",
      ...bounds,
    },
    createdAt: now,
    updatedAt: now,
  };
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
    target: overrides.target ?? null,
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
  const result = await executeVacuumTool("vacuum-room-zone-writes-test", params);
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
