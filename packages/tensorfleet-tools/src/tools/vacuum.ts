import { getConfig, getGlobalAuthInfo, setConfig } from "tensorfleet-auth";
import { ros2Bridge } from "tensorfleet-ros";
import {
  TensorfleetLogger,
  VACUUM_COMMAND_NAMES,
  type VacuumCapabilities,
  type VacuumAdapterSnapshot,
  type VacuumCommand,
  type VacuumCommandResult,
  type VacuumCommandName,
  type VacuumCapabilityName,
  checkVacuumTargetReadiness,
  type VacuumTargetSelector,
} from "tensorfleet-util";
import {
  createVacuumAdapter,
  normalizeVacuumBackend,
  normalizeVacuumTimeout,
  readVacuumRuntimeHealth,
  type VacuumBackendInput,
  type VacuumRuntimeHealthSnapshot,
  type VacuumRuntimeConfig,
  type VacuumRuntimeContext,
} from "tensorfleet-util/vacuum/node-runtime";
import type { TensorfleetVacuum } from "../schema-types/tensorfleet.vacuum.input";
import { withRosConnection } from "./ros-connect";

const logger = new TensorfleetLogger("Tools");
const VACUUM_TOOL_NAME = "tensorfleet-vacuum";

const READ_ONLY_ACTIONS = [
  "get-supported-actions",
  "get-health",
  "get-snapshot",
  "get-capabilities",
  "get-map-summary",
  "get-map-targets",
  "get-room-targets",
  "get-zone-targets",
  "get-mission-state",
  "get-navigation-state",
  "get-pose",
  "check-navigation-readiness",
  "check-clean-area-readiness",
  "check-room-cleaning-readiness",
  "check-zone-cleaning-readiness",
] as const;

const MOVEMENT_START_ACTIONS = ["start-navigation", "start-clean-area"] as const;
const MISSION_CONTROL_ACTIONS = [
  "pause-mission",
  "resume-mission",
  "cancel-mission",
  "retry-mission-step",
  "skip-mission-step",
] as const;
const WRITE_ACTIONS = [...MOVEMENT_START_ACTIONS, ...MISSION_CONTROL_ACTIONS] as const;
const PUBLIC_COMMAND_ACTION = "send-command";
const PUBLIC_COMMANDS = [
  "start_cleaning",
  "pause",
  "resume",
  "stop",
  "return_to_dock",
  "set_fan_speed",
  "set_water_usage",
] as const satisfies readonly VacuumCommandName[];

const STATE_CHANGING_COMMANDS = ["set_fan_speed", "set_water_usage"] as const satisfies readonly VacuumCommandName[];
const MISSION_CONTROL_COMMANDS = ["pause", "resume", "stop"] as const satisfies readonly VacuumCommandName[];
const MOVEMENT_START_COMMANDS = ["start_cleaning", "return_to_dock"] as const satisfies readonly VacuumCommandName[];
const READINESS_ACTIONS = [
  "check-navigation-readiness",
  "check-clean-area-readiness",
  "check-room-cleaning-readiness",
  "check-zone-cleaning-readiness",
] as const;
const FORBIDDEN_RAW_TERMS = [
  "BasicControlCapability",
  "BatteryStateCapability",
  "FanSpeedControlCapability",
  "WaterUsageControlCapability",
  "GoToLocationCapability",
  "MapSegmentationCapability",
  "ZoneCleaningCapability",
  "nav2_msgs",
  "/vacuum_mission",
  "/navigate_to_pose",
  "/map",
  "ROS",
  "Valetudo",
  "Foxglove",
] as const;
const DEFERRED_COMMANDS = [
  "go_to_location",
  "cancel_navigation",
  "manual_control",
  "start_mapping",
  "pause_mapping",
  "resume_mapping",
  "finish_mapping",
  "discard_mapping",
  "accept_map",
  "load_map",
  "save_map_annotation",
  "delete_map_annotation",
  "start_room_cleaning",
  "start_zone_cleaning",
  "segment_cleaning",
  "zone_cleaning",
] as const satisfies readonly VacuumCommandName[];

type MovementStartAction = (typeof MOVEMENT_START_ACTIONS)[number];
type MissionControlAction = (typeof MISSION_CONTROL_ACTIONS)[number];
type WriteAction = (typeof WRITE_ACTIONS)[number];
type MissionControlCommand =
  | "pause_mission"
  | "resume_mission"
  | "cancel_mission"
  | "retry_mission_step"
  | "skip_mission_step";

type ConfigSource =
  | "param"
  | "tool-env-param"
  | "process-env"
  | "config-store-or-global"
  | "global-auth"
  | "missing";

type ResolvedValue = {
  value?: string;
  source: ConfigSource;
};

type PublicConfigStatus = {
  available: boolean;
  source: ConfigSource;
  validJwtShape?: boolean;
  isExpired?: boolean;
};

type BackendSelection =
  | {
      ok: true;
      input: string;
      source: ConfigSource;
      backend: VacuumRuntimeConfig["backend"];
    }
  | {
      ok: false;
      input?: string;
      source: ConfigSource;
      code: "invalid_state";
      message: string;
    };

type RuntimePreflight = {
  ok: boolean;
  status: "available" | "not_authenticated" | "unavailable";
  blockers: string[];
  auth: PublicConfigStatus;
  vmManagerUrl: PublicConfigStatus;
  runtimeUrl: PublicConfigStatus;
};

type ValidationResult =
  | { ok: true }
  | {
      ok: false;
      status: "needs_input" | "invalid_request";
      missingFields: string[];
      invalidFields: string[];
      message: string;
    };

type ReadinessTarget = {
  x: number;
  y: number;
  theta: number;
  frameId?: string;
  label?: string;
};

type CleanAreaRectangle = {
  type: "rectangle";
  x: number;
  y: number;
  width: number;
  height: number;
  frameId?: string;
  label?: string;
};

type NamedTargetSelector = VacuumTargetSelector;

export type VacuumParams = TensorfleetVacuum & {
  TENSORFLEET_JWT?: string;
  TENSORFLEET_VM_MANAGER_URL?: string;
  TENSORFLEET_VALETUDO_RUNTIME_URL?: string;
  TENSORFLEET_VACUUM_BACKEND?: VacuumBackendInput;
};

let vacuumRuntimeContextForTests: VacuumRuntimeContext | null = null;

export function __setVacuumRuntimeContextForTests(context: VacuumRuntimeContext | null): void {
  vacuumRuntimeContextForTests = context;
}

export async function vacuumTool(id: string, params: VacuumParams) {
  try {
    hydrateVacuumConfig(params);
    if (params.action === "get-supported-actions") {
      return textResult(buildVacuumSupportedActionsResponse(params));
    }

    const selection = resolveBackendSelection(params);
    if (!selection.ok) {
      return textResult(buildInvalidStateResponse(params, selection));
    }

    const config = resolveRuntimeConfig(params, selection);
    const requestValidation = validateVacuumRequest(params);
    if (!requestValidation.ok) {
      return textResult(buildInvalidRequestResponse(params, config, requestValidation));
    }

    if (isWriteAction(params.action) && config.backend !== "turtlebot4_nav2") {
      return textResult(buildUnsupportedWriteBackendResponse(params, config));
    }

    const preflight = inspectRuntimePreflight(params, config);
    if (!preflight.ok && isReadinessAction(params.action)) {
      return textResult(buildUnavailableReadinessResponse(params, config, preflight));
    }
    if (!preflight.ok) {
      return textResult(buildUnavailableRuntimeResponse(params, config, preflight));
    }

    if (params.action === "get-health" && config.backend === "valetudo") {
      return textResult(buildVacuumHealthResponse(params, config, await readVacuumRuntimeHealth(config)));
    }

    const runtimeContext = vacuumRuntimeContextForTests ?? {
      rosBridge: ros2Bridge,
      withRosConnection: <T>(fn: () => Promise<T>) => withRosConnection(id, params, fn),
    };
    const adapter = await createVacuumAdapter(config, runtimeContext);
    const refreshSnapshot = async () => {
      const refreshed = await createVacuumAdapter(config, runtimeContext);
      return refreshed.snapshot;
    };
    const result = await runVacuumAction(params, config, adapter.snapshot, adapter.sendCommand, refreshSnapshot);

    return textResult(result);
  } catch (error) {
    logger.error(`Vacuum ${params.action} failed:`, error);
    return textResult({
      success: false,
      action: params.action,
      error: error instanceof Error ? error.message : "Unknown error occurred",
      timestamp: new Date().toISOString(),
    });
  }
}

function hydrateVacuumConfig(params: VacuumParams): void {
  if (params.token != null) setConfig("TENSORFLEET_JWT", params.token);
  if (params.TENSORFLEET_JWT != null) setConfig("TENSORFLEET_JWT", params.TENSORFLEET_JWT);
  if (params.vmManagerUrl != null) setConfig("TENSORFLEET_VM_MANAGER_URL", params.vmManagerUrl);
  if (params.TENSORFLEET_VM_MANAGER_URL != null) setConfig("TENSORFLEET_VM_MANAGER_URL", params.TENSORFLEET_VM_MANAGER_URL);
  if (params.runtimeUrl != null) setConfig("TENSORFLEET_VALETUDO_RUNTIME_URL", params.runtimeUrl);
  if (params.TENSORFLEET_VALETUDO_RUNTIME_URL != null) {
    setConfig("TENSORFLEET_VALETUDO_RUNTIME_URL", params.TENSORFLEET_VALETUDO_RUNTIME_URL);
  }
  if (params.backend != null) setConfig("TENSORFLEET_VACUUM_BACKEND", params.backend);
  if (params.TENSORFLEET_VACUUM_BACKEND != null) setConfig("TENSORFLEET_VACUUM_BACKEND", params.TENSORFLEET_VACUUM_BACKEND);
}

function resolveRuntimeConfig(params: VacuumParams, selection: Extract<BackendSelection, { ok: true }>): VacuumRuntimeConfig {
  const runtimeUrl = resolveRuntimeUrl(params);
  const routeMode = params.routeMode ?? (runtimeUrl.value ? "direct" : "vm-manager");
  const baseUrl =
    routeMode === "direct"
      ? runtimeUrl.value ?? ""
      : resolveVmManagerUrl(params).value ?? "";
  const token = resolveAuthToken(params).value;

  return {
    backend: selection.backend,
    routeMode,
    baseUrl,
    token,
    timeoutMs: normalizeVacuumTimeout(params.timeoutMs),
  };
}

async function runVacuumAction(
  params: VacuumParams,
  config: VacuumRuntimeConfig,
  snapshot: VacuumAdapterSnapshot,
  sendCommand: (command: VacuumCommand) => Promise<VacuumCommandResult>,
  refreshSnapshot: () => Promise<VacuumAdapterSnapshot>,
) {
  const timestamp = new Date().toISOString();
  const base = {
    success: true,
    action: params.action,
    ...backendResponse(config.backend),
    timestamp,
  };

  switch (params.action) {
    case "get-health":
      return {
        ...base,
        health: runtimeHealthSummary(snapshot),
      };
    case "get-snapshot":
      return {
        ...base,
        snapshot: compactSnapshot(snapshot, params),
      };
    case "get-capabilities":
      return {
        ...base,
        capabilities: capabilitySummary(snapshot.capabilities),
        discovery: buildActionDiscoveryForSnapshot(config, snapshot),
      };
    case "get-map-summary":
      return {
        ...base,
        map: mapSummary(snapshot, params),
      };
    case "get-map-targets":
      return {
        ...base,
        targets: mapTargets(snapshot, params.includeGeometry === true),
        note: "Map targets are read-only in this tool; target cleaning commands are exposed only when the shared adapter supports them.",
      };
    case "get-room-targets":
      return {
        ...base,
        targets: roomTargets(snapshot, params.includeGeometry === true),
        note: "Room/segment targets are read-only inventory; start-room-cleaning is deferred.",
      };
    case "get-zone-targets":
      return {
        ...base,
        targets: zoneTargets(snapshot, params.includeGeometry === true),
        note: "Zone targets are read-only inventory; start-zone-cleaning is deferred.",
      };
    case "get-mission-state":
      return {
        ...base,
        mission: snapshot.mission,
        activeMission: snapshot.activeMission,
        missions: snapshot.missions,
        activity: snapshot.activity,
        readiness: snapshot.readiness,
      };
    case "get-navigation-state":
      return {
        ...base,
        navigation: navigationSummary(snapshot),
      };
    case "get-pose":
      return {
        ...base,
        pose: poseSummary(snapshot),
      };
    case "check-navigation-readiness":
      return {
        ...base,
        preflight: navigationReadiness(params, config, snapshot),
      };
    case "check-clean-area-readiness":
      return {
        ...base,
        preflight: cleanAreaReadiness(params, config, snapshot),
      };
    case "check-room-cleaning-readiness":
      return {
        ...base,
        preflight: targetCleaningReadiness(params, config, snapshot, "room"),
      };
    case "check-zone-cleaning-readiness":
      return {
        ...base,
        preflight: targetCleaningReadiness(params, config, snapshot, "zone"),
      };
    case "start-navigation":
      return await startNavigation(params, config, snapshot, sendCommand, refreshSnapshot, base);
    case "start-clean-area":
      return await startCleanArea(params, config, snapshot, sendCommand, refreshSnapshot, base);
    case "pause-mission":
    case "resume-mission":
    case "cancel-mission":
    case "retry-mission-step":
    case "skip-mission-step":
      return await runMissionControl(params, config, snapshot, sendCommand, refreshSnapshot, base);
    case "send-command":
      const result = buildDeferredCommandResult(params);
      return {
        ...base,
        success: result.ok,
        ...(result.ok ? {} : { error: result.error }),
        result,
      };
    default:
      throw new Error(`Unknown vacuum action: ${(params as { action: string }).action}`);
  }
}

export function buildVacuumSupportedActionsResponse(params: VacuumParams) {
  const timestamp = new Date().toISOString();
  const selection = resolveBackendSelection(params);

  if (!selection.ok) {
    return {
      success: false,
      action: params.action,
      status: "invalid_state",
      error: {
        code: selection.code,
        message: selection.message,
      },
      timestamp,
      vacuumTool: {
        tool: VACUUM_TOOL_NAME,
        exposedOpenClawTools: [VACUUM_TOOL_NAME],
      },
      acceptedBackends: backendAliases(),
      actions: buildStaticActionGroups(null, []),
      canMoveVacuumNow: false,
      movementBlockers: [selection.message, "Pass backend=simulation or backend=real_vacuum explicitly."],
    };
  }

  const config = resolveRuntimeConfig(params, selection);
  const preflight = inspectRuntimePreflight(params, config);
  const runtimeBlockers = preflight.blockers;

  return {
    success: true,
    action: params.action,
    status: preflight.ok ? "available" : preflight.status,
    ...backendResponse(config.backend),
    timestamp,
    vacuumTool: {
      tool: VACUUM_TOOL_NAME,
      exposedOpenClawTools: [VACUUM_TOOL_NAME],
      note: "Use the tensorfleet-vacuum product tool; lower-level backend/debug surfaces are not part of this vacuum contract.",
    },
    backendSelection: {
      input: selection.input,
      source: selection.source,
      selectedBackend: backendResponse(config.backend).backend,
      normalizedBackendAdapter: backendResponse(config.backend).backendAdapter,
    },
    runtime: {
      routeMode: config.routeMode,
      auth: preflight.auth,
      vmManagerUrl: preflight.vmManagerUrl,
      runtimeUrl: preflight.runtimeUrl,
      blockers: runtimeBlockers,
      note: "Config status reports only presence and source; token and URLs are intentionally omitted.",
    },
    acceptedBackends: backendAliases(),
    actions: buildStaticActionGroups(config.backend, runtimeBlockers),
    canMoveVacuumNow: false,
    movementBlockers: movementBlockers(config.backend, runtimeBlockers),
  };
}

function resolveBackendSelection(params: VacuumParams): BackendSelection {
  const selected = pickFirstString([
    [params.backend, "param"],
    [params.TENSORFLEET_VACUUM_BACKEND, "tool-env-param"],
    [process.env.TENSORFLEET_VACUUM_BACKEND, "process-env"],
    [getConfig<string>("TENSORFLEET_VACUUM_BACKEND"), "config-store-or-global"],
  ]);

  if (!selected.value) {
    return {
      ok: false,
      source: "missing",
      code: "invalid_state",
      message: "No TensorFleet vacuum backend is selected.",
    };
  }

  try {
    return {
      ok: true,
      input: selected.value,
      source: selected.source,
      backend: normalizeVacuumBackend(selected.value),
    };
  } catch {
    return {
      ok: false,
      input: selected.value,
      source: selected.source,
      code: "invalid_state",
      message: `Unsupported TensorFleet vacuum backend: ${selected.value}.`,
    };
  }
}

function inspectRuntimePreflight(params: VacuumParams, config: VacuumRuntimeConfig): RuntimePreflight {
  const auth = authStatus(params);
  const vmManagerUrl = settingStatus(resolveVmManagerUrl(params));
  const runtimeUrl = settingStatus(resolveRuntimeUrl(params));
  const blockers: string[] = [];

  if (config.routeMode === "vm-manager") {
    if (!auth.available) blockers.push("Missing TensorFleet auth token for VM Manager route.");
    if (auth.isExpired === true) blockers.push("TensorFleet auth token is expired.");
    if (!vmManagerUrl.available) blockers.push("Missing TENSORFLEET_VM_MANAGER_URL for VM Manager route.");
  }

  if (config.routeMode === "direct" && config.backend === "turtlebot4_nav2") {
    blockers.push("Simulation backend requires the VM Manager/ROS route; direct runtime routing is not supported.");
  }

  if (config.routeMode === "direct" && config.backend === "valetudo" && !runtimeUrl.available) {
    blockers.push("Missing TensorFleet Valetudo runtime URL for direct route.");
  }

  const notAuthenticated = blockers.some((blocker) => blocker.toLowerCase().includes("auth token"));
  return {
    ok: blockers.length === 0,
    status: blockers.length === 0 ? "available" : notAuthenticated ? "not_authenticated" : "unavailable",
    blockers,
    auth,
    vmManagerUrl,
    runtimeUrl,
  };
}

function buildInvalidStateResponse(params: VacuumParams, selection: Extract<BackendSelection, { ok: false }>) {
  return {
    success: false,
    action: params.action,
    status: "invalid_state",
    error: {
      code: selection.code,
      message: selection.message,
    },
    timestamp: new Date().toISOString(),
  };
}

function buildUnavailableRuntimeResponse(
  params: VacuumParams,
  config: VacuumRuntimeConfig,
  preflight: RuntimePreflight,
) {
  return {
    success: false,
    action: params.action,
    status: preflight.status,
    ...backendResponse(config.backend),
    error: {
      code: preflight.status,
      message: preflight.blockers.join(" "),
    },
    runtime: {
      routeMode: config.routeMode,
      auth: preflight.auth,
      vmManagerUrl: preflight.vmManagerUrl,
      runtimeUrl: preflight.runtimeUrl,
      blockers: preflight.blockers,
      note: "Config status reports only presence and source; token and URLs are intentionally omitted.",
    },
    timestamp: new Date().toISOString(),
  };
}

function buildStaticActionGroups(backend: VacuumRuntimeConfig["backend"] | null, runtimeBlockers: string[]) {
  const runtimeReady = backend != null && runtimeBlockers.length === 0;
  const backendIsRealVacuum = backend === "valetudo";
  const backendIsSimulation = backend === "turtlebot4_nav2";
  const movementStartCallableTools = backendIsSimulation
    ? MOVEMENT_START_ACTIONS.map((action) => ({
        tool: VACUUM_TOOL_NAME,
        action,
        availableNow: false,
        gated: true,
        reason:
          runtimeBlockers.length > 0
            ? runtimeBlockers.join(" ")
            : "Requires a fresh ready snapshot, map/pose evidence, no incompatible active mission, and normalized capability support.",
      }))
    : [];
  const missionControlCallableTools = backendIsSimulation
    ? MISSION_CONTROL_ACTIONS.map((action) => ({
        tool: VACUUM_TOOL_NAME,
        action,
        availableNow: false,
        gated: true,
        reason: "Requires a fresh active mission whose availableActions expose the matching mission action.",
      }))
    : [];
  const unavailableReadActions = runtimeReady
    ? []
    : READ_ONLY_ACTIONS.filter((action) => action !== "get-supported-actions").map((action) => ({
        tool: VACUUM_TOOL_NAME,
        action,
        reason: runtimeBlockers.length > 0 ? runtimeBlockers.join(" ") : "Backend is not selected.",
      }));

  return {
    readOnlyCallableTools: [
      { tool: VACUUM_TOOL_NAME, action: "get-supported-actions" },
      ...(runtimeReady
        ? READ_ONLY_ACTIONS.filter((action) => action !== "get-supported-actions").map((action) => ({
            tool: VACUUM_TOOL_NAME,
            action,
          }))
        : []),
    ],
    stateChangingCallableTools: [],
    movementStartCallableTools,
    missionControlCallableTools,
    writeCapableButGatedActions: backendIsSimulation
      ? [
          ...movementStartCallableTools,
          ...missionControlCallableTools,
        ]
      : [],
    supportedButCurrentlyUnavailableActions: [
      ...unavailableReadActions,
      ...(backendIsSimulation
        ? [
            {
              tool: VACUUM_TOOL_NAME,
              action: PUBLIC_COMMAND_ACTION,
              commands: PUBLIC_COMMANDS,
              reason: "send-command is retained only for compatibility and is refused as a backdoor control path.",
            },
        ]
      : []),
      ...(backendIsRealVacuum
        ? [
            {
              tool: VACUUM_TOOL_NAME,
              action: PUBLIC_COMMAND_ACTION,
              commands: PUBLIC_COMMANDS,
              reason:
                runtimeBlockers.length > 0
                  ? runtimeBlockers.join(" ")
                  : "Real-vacuum command dispatch is deferred; this rollout exposes simulation-only writes.",
            },
          ]
        : []),
    ],
    readOnlyActions: READ_ONLY_ACTIONS.map((action) => ({ tool: VACUUM_TOOL_NAME, action })),
    readinessPreflightActions: READINESS_ACTIONS.map((action) => ({ tool: VACUUM_TOOL_NAME, action })),
    writeActions: backendIsSimulation
      ? WRITE_ACTIONS.map((action) => ({ tool: VACUUM_TOOL_NAME, action, gated: true }))
      : [],
    compatibilityOnlyActions: [
      {
        tool: VACUUM_TOOL_NAME,
        action: PUBLIC_COMMAND_ACTION,
        commands: [...STATE_CHANGING_COMMANDS, ...MISSION_CONTROL_COMMANDS, ...MOVEMENT_START_COMMANDS],
        callable: false,
        reason: "Retained in schema for backward compatibility; refused in this read/preflight rollout.",
      },
    ],
    movementAffectingActions: [
      ...MOVEMENT_START_ACTIONS.map((action) => ({ tool: VACUUM_TOOL_NAME, action })),
      { tool: VACUUM_TOOL_NAME, action: "resume-mission" },
    ],
    deferredActions: DEFERRED_COMMANDS.map((command) => ({
      command,
      callable: false,
      reason: "Deferred in Step 4 + Step 5; not exposed as callable by the current vacuum tool schema.",
    })),
    unsupportedActions: backendIsSimulation
      ? PUBLIC_COMMANDS.map((command) => ({
          command,
          callable: false,
          reason: "Legacy basic vacuum commands are not the simulation movement or mission-control surface.",
        }))
      : [],
  };
}

function buildActionDiscoveryForSnapshot(config: VacuumRuntimeConfig, snapshot: VacuumAdapterSnapshot) {
  const capabilities = snapshot.capabilities;
  const supportedPublicCommands = PUBLIC_COMMANDS.filter((command) => {
    const capabilityName = command === "set_fan_speed" ? "fan_speed" : command === "set_water_usage" ? "water_usage" : command;
    const capability = capabilities[capabilityName];
    return capability?.supported === true && capability.available !== false;
  });
  const generalMovementBlockers = generalMovementReadinessBlockers(config, snapshot);
  const canMoveVacuumNow = config.backend === "turtlebot4_nav2" && generalMovementBlockers.length === 0;
  const groups = buildStaticActionGroups(config.backend, []);

  return {
    ...groups,
    movementStartCallableTools: (config.backend === "turtlebot4_nav2"
      ? MOVEMENT_START_ACTIONS.map((action) => {
          const capabilityName = action === "start-navigation" ? "start_navigation" : "start_coverage";
          const capabilityBlockers = capabilityBlockersFor(snapshot, capabilityName);
          const actionBlockers = uniqueStrings([...generalMovementBlockers, ...capabilityBlockers]);
          return {
            tool: VACUUM_TOOL_NAME,
            action,
            availableNow: actionBlockers.length === 0,
            gated: true,
            blockers: actionBlockers,
          };
        })
      : []),
    missionControlCallableTools: (config.backend === "turtlebot4_nav2"
      ? MISSION_CONTROL_ACTIONS.map((action) => {
          const command = missionControlCommandForAction(action);
          const gate = missionControlGate(snapshot, command);
          return {
            tool: VACUUM_TOOL_NAME,
            action,
            availableNow: gate.available,
            gated: true,
            blockers: gate.blockers,
          };
        })
      : []),
    supportedByCurrentSnapshot: {
      commands: supportedPublicCommands,
      movementStartCommands: ["start_navigation", "start_coverage"].filter((command) => {
        const capability = capabilities[command as "start_navigation" | "start_coverage"];
        return capability.supported === true && capability.available !== false;
      }),
      missionControlCommands: (["pause_mission", "resume_mission", "cancel_mission", "retry_mission_step", "skip_mission_step"] as const)
        .filter((command) => missionControlGate(snapshot, command).available),
    },
    canMoveVacuumNow,
    movementBlockers: movementBlockers(config.backend, generalMovementBlockers),
  };
}

function generalMovementReadinessBlockers(config: VacuumRuntimeConfig, snapshot: VacuumAdapterSnapshot): string[] {
  if (config.backend !== "turtlebot4_nav2") {
    return ["Real-vacuum movement and write commands are deferred by this tool rollout."];
  }
  const blockers = commonReadinessBlockers(snapshot);
  const map = mapUsability(snapshot, "navigation");
  const pose = poseSummary(snapshot);
  const mission = activeMissionCompatibility(snapshot);
  if (!map.usable) blockers.push(...map.blockers);
  if (!pose.available) blockers.push(pose.reason ?? "Pose/localization is unavailable.");
  blockers.push(...mission.blockers);
  return uniqueStrings(blockers);
}

function movementBlockers(backend: VacuumRuntimeConfig["backend"] | null, runtimeBlockers: string[]): string[] {
  const blockers = [
    ...runtimeBlockers,
    ...(backend === "valetudo"
      ? ["Real-vacuum movement and write commands are deferred by this tool rollout."]
      : []),
  ];
  return blockers.length > 0 ? uniqueStrings(blockers) : [];
}

function backendAliases() {
  return {
    simulation: ["simulation", "turtlebot4_nav2", "turtlebot4-nav2"],
    real_vacuum: ["real_vacuum", "real-vacuum", "valetudo"],
  };
}

function authStatus(params: VacuumParams): PublicConfigStatus {
  const globalAuth = getGlobalAuthInfo();
  const resolved = resolveAuthToken(params);
  return {
    available: resolved.value != null,
    source: resolved.source,
    ...(resolved.source === "global-auth" && globalAuth
      ? {
          validJwtShape: globalAuth.isValidJwtShape,
          isExpired: globalAuth.isExpired,
        }
      : {}),
  };
}

function resolveAuthToken(params: VacuumParams): ResolvedValue {
  const globalAuth = getGlobalAuthInfo();
  return pickFirstString([
    [params.token, "param"],
    [params.TENSORFLEET_JWT, "tool-env-param"],
    [process.env.TENSORFLEET_JWT, "process-env"],
    [getConfig<string>("TENSORFLEET_JWT"), "config-store-or-global"],
    [globalAuth?.token, "global-auth"],
  ]);
}

function resolveVmManagerUrl(params: VacuumParams): ResolvedValue {
  return pickFirstString([
    [params.vmManagerUrl, "param"],
    [params.TENSORFLEET_VM_MANAGER_URL, "tool-env-param"],
    [process.env.TENSORFLEET_VM_MANAGER_URL, "process-env"],
    [getConfig<string>("TENSORFLEET_VM_MANAGER_URL"), "config-store-or-global"],
  ]);
}

function resolveRuntimeUrl(params: VacuumParams): ResolvedValue {
  return pickFirstString([
    [params.runtimeUrl, "param"],
    [params.TENSORFLEET_VALETUDO_RUNTIME_URL, "tool-env-param"],
    [process.env.TENSORFLEET_VALETUDO_RUNTIME_URL, "process-env"],
    [getConfig<string>("TENSORFLEET_VALETUDO_RUNTIME_URL"), "config-store-or-global"],
  ]);
}

function settingStatus(resolved: ResolvedValue): PublicConfigStatus {
  return {
    available: resolved.value != null,
    source: resolved.source,
  };
}

function pickFirstString(entries: Array<[unknown, ConfigSource]>): ResolvedValue {
  for (const [value, source] of entries) {
    if (typeof value === "string" && value.length > 0) {
      return { value, source };
    }
  }
  return { source: "missing" };
}

function buildVacuumCommand(params: VacuumParams): VacuumCommand {
  if (!params.command) {
    throw new Error("command is required for action=send-command.");
  }
  if (!isVacuumCommandName(params.command)) {
    throw new Error(`Unsupported vacuum command: ${params.command}`);
  }
  if (params.command === "set_fan_speed" || params.command === "set_water_usage") {
    if (!params.value) {
      throw new Error(`value is required for command=${params.command}.`);
    }
    return { command: params.command, value: params.value };
  }
  return { command: params.command } as VacuumCommand;
}

function buildDeferredCommandResult(params: VacuumParams): VacuumCommandResult {
  const command: VacuumCommandName = params.command && isVacuumCommandName(params.command) ? params.command : "manual_control";
  return {
    ok: false,
    command,
    error: {
      code: "unsupported",
      command,
      message:
        "send-command is retained for compatibility but is not a backdoor control path. Use explicit gated actions such as start-navigation, start-clean-area, or mission-control actions.",
    },
  };
}

async function startNavigation(
  params: VacuumParams,
  config: VacuumRuntimeConfig,
  snapshot: VacuumAdapterSnapshot,
  sendCommand: (command: VacuumCommand) => Promise<VacuumCommandResult>,
  refreshSnapshot: () => Promise<VacuumAdapterSnapshot>,
  base: Record<string, unknown>,
) {
  const preflight = navigationReadiness(params, config, snapshot);
  const readiness = executionReadiness(preflight);
  if (!preflight.ready) {
    return blockedWriteResponse(base, params.action, "blocked", preflight.blockers, {
      requestedTarget: requestedTargetSummary((params as { target: ReadinessTarget }).target),
      readiness,
      previousActiveMission: summarizeMission(snapshot.activeMission),
      commandDispatched: false,
    });
  }

  const target = (params as { target: ReadinessTarget }).target;
  const command: VacuumCommand = {
    command: "start_navigation",
    target: { x: target.x, y: target.y, yaw: target.theta },
  };
  const commandResult = await sendCommand(command);
  const refreshed = await refreshMissionAfterCommand(refreshSnapshot);
  return {
    ...base,
    success: commandResult.ok,
    status: commandResult.ok ? "dispatched" : "backend_error",
    ...(commandResult.ok ? {} : { error: commandResult.error }),
    requestedTarget: requestedTargetSummary(target),
    readiness,
    command: commandSummary(commandResult),
    previousActiveMission: summarizeMission(snapshot.activeMission),
    refreshedActiveMission: refreshed.activeMission,
    warnings: refreshed.warnings,
  };
}

async function startCleanArea(
  params: VacuumParams,
  config: VacuumRuntimeConfig,
  snapshot: VacuumAdapterSnapshot,
  sendCommand: (command: VacuumCommand) => Promise<VacuumCommandResult>,
  refreshSnapshot: () => Promise<VacuumAdapterSnapshot>,
  base: Record<string, unknown>,
) {
  const preflight = cleanAreaReadiness(params, config, snapshot);
  const readiness = executionReadiness(preflight);
  if (!preflight.ready) {
    return blockedWriteResponse(base, params.action, "blocked", preflight.blockers, {
      requestedArea: requestedAreaSummary((params as { area: CleanAreaRectangle }).area),
      readiness,
      previousActiveMission: summarizeMission(snapshot.activeMission),
      commandDispatched: false,
    });
  }

  const area = (params as { area: CleanAreaRectangle }).area;
  const command: VacuumCommand = {
    command: "start_coverage",
    area: {
      shape: "rectangle",
      minX: area.x,
      minY: area.y,
      maxX: area.x + area.width,
      maxY: area.y + area.height,
    },
  };
  const commandResult = await sendCommand(command);
  const refreshed = await refreshMissionAfterCommand(refreshSnapshot);
  return {
    ...base,
    success: commandResult.ok,
    status: commandResult.ok ? "dispatched" : "backend_error",
    ...(commandResult.ok ? {} : { error: commandResult.error }),
    requestedArea: requestedAreaSummary(area),
    readiness,
    command: commandSummary(commandResult),
    previousActiveMission: summarizeMission(snapshot.activeMission),
    refreshedActiveMission: refreshed.activeMission,
    warnings: refreshed.warnings,
  };
}

async function runMissionControl(
  params: VacuumParams,
  config: VacuumRuntimeConfig,
  snapshot: VacuumAdapterSnapshot,
  sendCommand: (command: VacuumCommand) => Promise<VacuumCommandResult>,
  refreshSnapshot: () => Promise<VacuumAdapterSnapshot>,
  base: Record<string, unknown>,
) {
  const commandName = missionControlCommandForAction(params.action as MissionControlAction);
  const gate = missionControlGate(snapshot, commandName);
  if (!gate.available) {
    return blockedWriteResponse(base, params.action, gate.status, gate.blockers, {
      mission: {
        previousActiveMission: summarizeMission(snapshot.activeMission),
        requiredAction: commandName,
        availableActions: snapshot.activeMission?.availableActions ?? [],
      },
      capability: capabilityDescriptor(commandName, snapshot.capabilities[commandName]),
      commandDispatched: false,
    });
  }

  const commandResult = await sendCommand({ command: commandName } as VacuumCommand);
  const refreshed = await refreshMissionAfterCommand(refreshSnapshot);
  return {
    ...base,
    success: commandResult.ok,
    status: commandResult.ok ? "dispatched" : "backend_error",
    ...(commandResult.ok ? {} : { error: commandResult.error }),
    command: commandSummary(commandResult),
    previousActiveMission: summarizeMission(snapshot.activeMission),
    refreshedActiveMission: refreshed.activeMission,
    warnings: refreshed.warnings,
  };
}

function blockedWriteResponse(
  base: Record<string, unknown>,
  action: string,
  status: string,
  blockers: string[],
  details: Record<string, unknown>,
) {
  return {
    ...base,
    success: false,
    action,
    status,
    reason: blockers.join(" "),
    blockers: uniqueStrings(blockers),
    ...details,
  };
}

async function refreshMissionAfterCommand(refreshSnapshot: () => Promise<VacuumAdapterSnapshot>) {
  try {
    const refreshed = await refreshSnapshot();
    return {
      activeMission: summarizeMission(refreshed.activeMission),
      warnings: [] as string[],
    };
  } catch (error) {
    return {
      activeMission: null,
      warnings: [`Refreshed mission state unavailable: ${error instanceof Error ? error.message : "Unknown error occurred"}`],
    };
  }
}

function commandSummary(result: VacuumCommandResult) {
  return result.ok
    ? {
        ok: true,
        command: result.command,
        message: result.message,
      }
    : {
        ok: false,
        command: result.command,
        error: result.error,
      };
}

function requestedTargetSummary(target: ReadinessTarget) {
  return {
    x: target.x,
    y: target.y,
    theta: target.theta,
    frameId: target.frameId,
    label: target.label,
  };
}

function requestedAreaSummary(area: CleanAreaRectangle) {
  return {
    type: area.type,
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
    frameId: area.frameId,
    label: area.label,
    normalizedArea: {
      shape: "rectangle",
      minX: area.x,
      minY: area.y,
      maxX: area.x + area.width,
      maxY: area.y + area.height,
    },
  };
}

function executionReadiness<T extends { ready: boolean; blockers: string[]; note?: string; canDispatchCommand: boolean }>(preflight: T) {
  return {
    ...preflight,
    canDispatchCommand: preflight.ready,
    note: preflight.ready
      ? "Execution gate passed; a normalized product command may be dispatched by this action."
      : "Execution gate failed; no command was dispatched.",
  };
}

function missionControlCommandForAction(action: MissionControlAction): MissionControlCommand {
  const mapping: Record<MissionControlAction, MissionControlCommand> = {
    "pause-mission": "pause_mission",
    "resume-mission": "resume_mission",
    "cancel-mission": "cancel_mission",
    "retry-mission-step": "retry_mission_step",
    "skip-mission-step": "skip_mission_step",
  };
  return mapping[action];
}

function missionControlGate(snapshot: VacuumAdapterSnapshot, command: MissionControlCommand) {
  const blockers: string[] = [];
  const mission = snapshot.activeMission;
  if (!mission) {
    blockers.push("No active mission is available.");
  } else {
    if (!mission.availableActions.includes(command)) {
      blockers.push(`Active mission does not expose ${command} as an available action.`);
    }
    blockers.push(...missionStatusBlockers(command, mission.status));
  }
  blockers.push(...capabilityBlockersForCommand(snapshot, command));
  return {
    available: blockers.length === 0,
    status: blockers.some((blocker) => blocker.includes("not supported")) ? "unsupported" : "blocked",
    blockers: uniqueStrings(blockers),
  };
}

function missionStatusBlockers(command: MissionControlCommand, status: NonNullable<VacuumAdapterSnapshot["activeMission"]>["status"]): string[] {
  const terminalStatuses = new Set(["completed", "failed", "canceled", "unsupported", "idle"]);
  if (command === "pause_mission" && ["paused", ...terminalStatuses].includes(status)) {
    return [`Cannot pause a mission with status ${status}.`];
  }
  if (command === "resume_mission" && status !== "paused") {
    return [`Cannot resume a mission with status ${status}; the mission must be paused.`];
  }
  if (command === "cancel_mission" && terminalStatuses.has(status)) {
    return [`Cannot cancel a mission with status ${status}.`];
  }
  if ((command === "retry_mission_step" || command === "skip_mission_step") && terminalStatuses.has(status)) {
    return [`Cannot ${command === "retry_mission_step" ? "retry" : "skip"} a mission step with status ${status}.`];
  }
  return [];
}

function capabilityBlockersForCommand(snapshot: VacuumAdapterSnapshot, name: MissionControlCommand): string[] {
  const capability = snapshot.capabilities[name];
  if (!capability.supported) return [`${name} is not supported by the selected backend capabilities.`];
  if (capability.available === false) return [productDetail(capability.availabilityReason) ?? `${name} is currently unavailable.`];
  return [];
}

function isReadinessAction(action: string): action is (typeof READINESS_ACTIONS)[number] {
  return (READINESS_ACTIONS as readonly string[]).includes(action);
}

function isMovementStartAction(action: string): action is MovementStartAction {
  return (MOVEMENT_START_ACTIONS as readonly string[]).includes(action);
}

function isMissionControlAction(action: string): action is MissionControlAction {
  return (MISSION_CONTROL_ACTIONS as readonly string[]).includes(action);
}

function isWriteAction(action: string): action is WriteAction {
  return (WRITE_ACTIONS as readonly string[]).includes(action);
}

function validateVacuumRequest(params: VacuumParams): ValidationResult {
  if (params.action === "check-navigation-readiness" || params.action === "start-navigation") {
    return validateNavigationTarget((params as { target?: unknown }).target);
  }
  if (params.action === "check-clean-area-readiness" || params.action === "start-clean-area") {
    return validateCleanArea((params as { area?: unknown }).area);
  }
  if (params.action === "check-room-cleaning-readiness") {
    return validateNamedTarget((params as { room?: unknown }).room, "room");
  }
  if (params.action === "check-zone-cleaning-readiness") {
    return validateNamedTarget((params as { zone?: unknown }).zone, "zone");
  }
  return { ok: true };
}

function validateNavigationTarget(target: unknown): ValidationResult {
  if (!isRecord(target)) {
    return invalidRequest("needs_input", ["target"], [], "check-navigation-readiness requires target.x, target.y, and target.theta.");
  }

  const missingFields = ["x", "y", "theta"].filter((field) => target[field] === undefined).map((field) => `target.${field}`);
  const invalidFields = ["x", "y", "theta"]
    .filter((field) => target[field] !== undefined && !isFiniteNumber(target[field]))
    .map((field) => `target.${field}`);

  return missingFields.length > 0 || invalidFields.length > 0
    ? invalidRequest(missingFields.length > 0 ? "needs_input" : "invalid_request", missingFields, invalidFields, "Navigation readiness needs a numeric x, y, and theta target.")
    : { ok: true };
}

function validateCleanArea(area: unknown): ValidationResult {
  if (!isRecord(area)) {
    return invalidRequest(
      "needs_input",
      ["area"],
      [],
      "check-clean-area-readiness requires an area rectangle with type, x, y, width, and height.",
    );
  }

  const missingFields = ["type", "x", "y", "width", "height"]
    .filter((field) => area[field] === undefined)
    .map((field) => `area.${field}`);
  const invalidFields = [
    area.type !== undefined && area.type !== "rectangle" ? "area.type" : null,
    area.x !== undefined && !isFiniteNumber(area.x) ? "area.x" : null,
    area.y !== undefined && !isFiniteNumber(area.y) ? "area.y" : null,
    area.width !== undefined && (!isFiniteNumber(area.width) || area.width <= 0) ? "area.width" : null,
    area.height !== undefined && (!isFiniteNumber(area.height) || area.height <= 0) ? "area.height" : null,
  ].filter((field): field is string => field != null);

  return missingFields.length > 0 || invalidFields.length > 0
    ? invalidRequest(missingFields.length > 0 ? "needs_input" : "invalid_request", missingFields, invalidFields, "Clean-area readiness needs a rectangle with numeric x/y and positive width/height.")
    : { ok: true };
}

function validateNamedTarget(target: unknown, kind: "room" | "zone"): ValidationResult {
  if (!isRecord(target)) {
    return invalidRequest(
      "needs_input",
      [kind],
      [],
      `check-${kind}-cleaning-readiness requires a ${kind} target with id or name.`,
    );
  }
  const hasId = typeof target.id === "string" && target.id.trim() !== "";
  const hasName = typeof target.name === "string" && target.name.trim() !== "";
  const hasLabel = typeof target.label === "string" && target.label.trim() !== "";
  const invalidFields = [
    target.id !== undefined && typeof target.id !== "string" ? `${kind}.id` : null,
    target.name !== undefined && typeof target.name !== "string" ? `${kind}.name` : null,
    target.label !== undefined && typeof target.label !== "string" ? `${kind}.label` : null,
  ].filter((field): field is string => field != null);

  return !hasId && !hasName && !hasLabel || invalidFields.length > 0
    ? invalidRequest(
        invalidFields.length > 0 ? "invalid_request" : "needs_input",
        !hasId && !hasName && !hasLabel ? [`${kind}.id|name`] : [],
        invalidFields,
        `${kind === "room" ? "Room" : "Zone"} readiness needs a ${kind} id or name.`,
      )
    : { ok: true };
}

function invalidRequest(
  status: "needs_input" | "invalid_request",
  missingFields: string[],
  invalidFields: string[],
  message: string,
): ValidationResult {
  return {
    ok: false,
    status,
    missingFields,
    invalidFields,
    message,
  };
}

function buildInvalidRequestResponse(
  params: VacuumParams,
  config: VacuumRuntimeConfig,
  validation: Extract<ValidationResult, { ok: false }>,
) {
  const isWrite = isWriteAction(params.action);
  return {
    success: !isWrite,
    action: params.action,
    status: validation.status,
    ...backendResponse(config.backend),
    timestamp: new Date().toISOString(),
    ...(isWrite
      ? {
          missingFields: validation.missingFields,
          invalidFields: validation.invalidFields,
          blockers: [validation.message],
          requiredInputs: requiredInputsForAction(params.action),
          commandDispatched: false,
          reason: validation.message,
        }
      : {
          preflight: {
      ready: false,
      status: validation.status,
      missingFields: validation.missingFields,
      invalidFields: validation.invalidFields,
      blockers: [validation.message],
      requiredInputs: requiredInputsForAction(params.action),
      canDispatchCommand: false,
      note: "Read-only preflight only; no movement or cleaning command was dispatched.",
          },
        }),
  };
}

function buildUnsupportedWriteBackendResponse(params: VacuumParams, config: VacuumRuntimeConfig) {
  const blockers = [`${params.action} is supported only for the simulation backend in this rollout.`];
  return {
    success: false,
    action: params.action,
    status: "unsupported",
    ...backendResponse(config.backend),
    timestamp: new Date().toISOString(),
    reason: blockers.join(" "),
    blockers,
    commandDispatched: false,
  };
}

function buildUnavailableReadinessResponse(
  params: VacuumParams,
  config: VacuumRuntimeConfig,
  preflight: RuntimePreflight,
) {
  return {
    success: true,
    action: params.action,
    status: preflight.status,
    ...backendResponse(config.backend),
    timestamp: new Date().toISOString(),
    preflight: {
      ready: false,
      status: preflight.status,
      blockers: preflight.blockers,
      evidence: {
        runtime: {
          routeMode: config.routeMode,
          auth: preflight.auth,
          vmManagerUrl: preflight.vmManagerUrl,
          runtimeUrl: preflight.runtimeUrl,
          note: "Config status reports only presence and source; token and URLs are intentionally omitted.",
        },
      },
      canDispatchCommand: false,
      note: "Read-only preflight only; no movement or cleaning command was dispatched.",
    },
  };
}

function compactSnapshot(snapshot: VacuumAdapterSnapshot, params: VacuumParams) {
  return {
    identity: snapshot.identity,
    availability: snapshot.availability,
    backendHealth: runtimeHealthSummary(snapshot),
    readiness: snapshot.readiness,
    robot: {
      activity: activitySummary(snapshot),
      battery: snapshot.battery,
      dock: snapshot.dock,
      fault: snapshot.fault,
    },
    map: mapSummary(snapshot, params),
    pose: poseSummary(snapshot),
    navigation: navigationSummary(snapshot),
    mission: missionSummary(snapshot),
    capabilities: capabilitySummary(snapshot.capabilities),
    ...(params.includeDiagnostics === true ? { diagnostics: compactDiagnostics(snapshot, params) } : {}),
  };
}

function runtimeHealthSummary(snapshot: VacuumAdapterSnapshot) {
  return {
    availability: snapshot.availability,
    runtime: snapshot.health ? { ...snapshot.health, detail: productDetail(snapshot.health.detail) } : undefined,
    source: snapshot.source,
    readiness: snapshot.readiness,
    fault: snapshot.fault,
  };
}

function compactDiagnostics(snapshot: VacuumAdapterSnapshot, params: VacuumParams) {
  if (!snapshot.diagnostics) return undefined;
  const { raw: _raw, source: _source, runtime: _runtime, ...diagnostics } = snapshot.diagnostics;
  return params.includeRawDiagnostics === true
    ? diagnostics
    : {
        ...diagnostics,
        note: "Raw backend diagnostics are omitted from product responses.",
      };
}

function capabilitySummary(capabilities: VacuumCapabilities) {
  const entries = Object.entries(capabilities) as Array<[VacuumCapabilityName, VacuumCapabilities[VacuumCapabilityName]]>;
  const descriptor = ([name, capability]: (typeof entries)[number]) => ({
    name,
    supported: capability.supported,
    status: capability.status ?? (capability.supported ? (capability.available === false ? "unavailable" : "supported") : "unsupported"),
    available: capability.available ?? capability.supported,
    attributes: capability.attributes?.filter((value) => !containsForbiddenRawTerm(value)),
    commands: capability.commands?.filter((value) => isVacuumCommandName(value)).map((value) => value),
    reasons: capability.reasons,
    availabilityReason: productDetail(capability.availabilityReason),
  });

  return {
    supported: entries.filter((entry) => entry[1].supported && entry[1].available !== false).map(descriptor),
    unavailable: entries.filter((entry) => entry[1].supported && entry[1].available === false).map(descriptor),
    unsupported: entries.filter((entry) => !entry[1].supported).map(descriptor),
    deferredActions: DEFERRED_COMMANDS.map((command) => ({
      command,
      callable: false,
      reason: "Deferred; this rollout exposes only simulation navigation, rectangular Clean Area, and active mission-control writes.",
    })),
  };
}

function poseSummary(snapshot: VacuumAdapterSnapshot) {
  const pose = snapshot.pose;
  return {
    available: pose.available,
    readiness: pose.readiness,
    coordinates: pose.coordinates,
    reason: pose.available ? undefined : productDetail(pose.detail ?? "Pose is unavailable."),
    detail: productDetail(pose.detail),
  };
}

function navigationSummary(snapshot: VacuumAdapterSnapshot) {
  const navigation = snapshot.navigation;
  return {
    available: navigation.state !== "unknown",
    state: navigation.state,
    active: navigation.active,
    currentTarget: navigation.currentTarget,
    destination: navigation.currentTarget,
    terminalState: navigation.terminalState,
    progress: navigation.progress,
    pathSummary: pathSummary(navigation.planPath),
    blockers: navigationBlockers(snapshot),
    detail: productDetail(navigation.detail),
  };
}

function missionSummary(snapshot: VacuumAdapterSnapshot) {
  return {
    state: snapshot.mission.state,
    detail: productDetail(snapshot.mission.detail),
    activeMission: summarizeMission(snapshot.activeMission),
    recentMissions: snapshot.missions.recent.slice(0, 5).map(summarizeMission),
    activity: activitySummary(snapshot),
  };
}

function summarizeMission(mission: VacuumAdapterSnapshot["activeMission"]) {
  if (!mission) return null;
  return {
    id: mission.id,
    type: mission.type,
    status: mission.status,
    requestedCommand: mission.requestedCommand,
    phase: mission.phase,
    progress: mission.progress,
    result: mission.result,
    error: mission.error,
    availableActions: mission.availableActions,
    startedAt: mission.startedAt,
    updatedAt: mission.updatedAt,
  };
}

function activitySummary(snapshot: VacuumAdapterSnapshot) {
  if (!snapshot.activity) return undefined;
  return {
    status: snapshot.activity.status,
    label: snapshot.activity.label,
    updatedAt: snapshot.activity.updatedAt,
    reason: productDetail(snapshot.activity.reason),
    availableActions: snapshot.activity.availableActions,
  };
}

function navigationReadiness(params: VacuumParams, config: VacuumRuntimeConfig, snapshot: VacuumAdapterSnapshot) {
  const target = (params as { target: ReadinessTarget }).target;
  const blockers = commonReadinessBlockers(snapshot);
  const capabilityBlockers = capabilityBlockersFor(snapshot, "start_navigation");
  const map = mapUsability(snapshot, "navigation");
  const pose = poseSummary(snapshot);
  const mission = activeMissionCompatibility(snapshot);

  if (!map.usable) blockers.push(...map.blockers);
  if (!pose.available) blockers.push(pose.reason ?? "Pose/localization is unavailable.");
  blockers.push(...mission.blockers, ...capabilityBlockers);

  if (config.backend === "valetudo" && snapshot.capabilities.start_navigation.supported !== true) {
    blockers.push("Real-vacuum navigation readiness is unsupported by the normalized real-vacuum capabilities.");
  }

  const ready = blockers.length === 0;
  return {
    ready,
    status: ready ? "ready" : readinessStatus(snapshot, "start_navigation", blockers),
    target,
    blockers: uniqueStrings(blockers),
    evidence: {
      backend: backendResponse(config.backend),
      runtime: runtimeHealthSummary(snapshot),
      map,
      pose,
      mission,
      capability: capabilityDescriptor("start_navigation", snapshot.capabilities.start_navigation),
      navigation: navigationSummary(snapshot),
    },
    canDispatchCommand: false,
    note: "Read-only navigation preflight only; no navigation command was dispatched.",
  };
}

function cleanAreaReadiness(params: VacuumParams, config: VacuumRuntimeConfig, snapshot: VacuumAdapterSnapshot) {
  const area = (params as { area: CleanAreaRectangle }).area;
  const blockers = commonReadinessBlockers(snapshot);
  const capabilityBlockers = capabilityBlockersFor(snapshot, "start_coverage");
  const map = mapUsability(snapshot, "coverage");
  const pose = poseSummary(snapshot);
  const mission = activeMissionCompatibility(snapshot);

  if (!map.usable) blockers.push(...map.blockers);
  if (!pose.available) blockers.push(pose.reason ?? "Pose/localization is unavailable.");
  blockers.push(...mission.blockers, ...capabilityBlockers);

  if (config.backend === "valetudo" && snapshot.capabilities.start_coverage.supported !== true) {
    blockers.push("Real-vacuum clean-area readiness is unsupported by the normalized real-vacuum capabilities.");
  }

  const ready = blockers.length === 0;
  return {
    ready,
    status: ready ? "ready" : readinessStatus(snapshot, "start_coverage", blockers),
    area,
    blockers: uniqueStrings(blockers),
    evidence: {
      backend: backendResponse(config.backend),
      runtime: runtimeHealthSummary(snapshot),
      map,
      pose,
      mission,
      capability: capabilityDescriptor("start_coverage", snapshot.capabilities.start_coverage),
      navigation: navigationSummary(snapshot),
    },
    canDispatchCommand: false,
    note: "Read-only clean-area preflight only; no cleaning command was dispatched.",
  };
}

function targetCleaningReadiness(
  params: VacuumParams,
  config: VacuumRuntimeConfig,
  snapshot: VacuumAdapterSnapshot,
  kind: "room" | "zone",
) {
  const selector = (params as { room?: NamedTargetSelector; zone?: NamedTargetSelector })[kind];
  const capabilityName = kind === "room" ? "room_cleaning" : "zone_cleaning";
  const semanticCapabilityName = kind === "room" ? "room_semantics" : "zone_semantics";
  const blockers = commonReadinessBlockers(snapshot);
  const mission = activeMissionCompatibility(snapshot);
  const capability = snapshot.capabilities[capabilityName];
  const semantics = snapshot.capabilities[semanticCapabilityName];
  const targetCheck = checkVacuumTargetReadiness(snapshot.map.targets, kind, selector, {
    supported: semantics.supported === true || capability.supported === true,
    source: snapshot.source,
    requireGeometry: true,
  });

  blockers.push(...mission.blockers);
  if (!capability.supported) {
    blockers.push(`${capabilityName} is not supported by the selected backend capabilities.`);
  }
  if (capability.available === false) {
    blockers.push(productDetail(capability.availabilityReason) ?? `${capabilityName} is currently unavailable.`);
  }
  if (!targetCheck.ready) {
    blockers.push(...targetCheck.blockers.map(productDetail).filter((blocker): blocker is string => blocker != null));
  }
  if (config.backend === "valetudo") {
    blockers.push(`Real-vacuum ${kind} cleaning remains read-only until normalized write support is enabled.`);
  }

  const callable = targetCheck.ready && blockers.length === 0;
  return {
    ready: callable,
    status: callable ? "ready" : targetReadinessStatus(snapshot, capabilityName, targetCheck.status, blockers),
    [kind]: selector,
    target: targetCheck.target,
    matches: targetCheck.ready ? undefined : targetCheck.matches,
    blockers: uniqueStrings(blockers),
    evidence: {
      backend: backendResponse(config.backend),
      runtime: runtimeHealthSummary(snapshot),
      map: mapTargetInventorySummary(snapshot),
      mission,
      semantics: capabilityDescriptor(semanticCapabilityName, semantics),
      capability: capabilityDescriptor(capabilityName, capability),
      targetCheck,
    },
    canDispatchCommand: false,
    note: `Read-only ${kind} cleaning preflight only; start-${kind}-cleaning is deferred and no command was dispatched.`,
  };
}

function commonReadinessBlockers(snapshot: VacuumAdapterSnapshot): string[] {
  return [
    ...(snapshot.availability.connected ? [] : [snapshot.availability.detail ?? "Runtime/source is not connected."]),
    ...snapshot.readiness.blockingReasons.map(productDetail),
    ...(snapshot.source?.status === "unreachable" ? ["Runtime source is unreachable."] : []),
    ...(snapshot.source?.status === "stale" ? ["Runtime source state is stale."] : []),
  ].filter((value): value is string => Boolean(value));
}

function capabilityBlockersFor(snapshot: VacuumAdapterSnapshot, name: "start_navigation" | "start_coverage"): string[] {
  const capability = snapshot.capabilities[name];
  if (!capability.supported) {
    return [`${name} is not supported by the selected backend capabilities.`];
  }
  if (capability.available === false) {
    return [productDetail(capability.availabilityReason) ?? `${name} is currently unavailable.`];
  }
  return [];
}

function readinessStatus(
  snapshot: VacuumAdapterSnapshot,
  capabilityName: "start_navigation" | "start_coverage",
  blockers: string[],
) {
  const capability = snapshot.capabilities[capabilityName];
  if (!capability.supported) return "unsupported";
  if (!snapshot.availability.connected || snapshot.source?.status === "unreachable" || snapshot.source?.status === "stale") {
    return "unavailable";
  }
  if (blockers.length > 0) return "blocked";
  return "ready";
}

function targetReadinessStatus(
  snapshot: VacuumAdapterSnapshot,
  capabilityName: "room_cleaning" | "zone_cleaning",
  targetStatus: string,
  blockers: string[],
) {
  const capability = snapshot.capabilities[capabilityName];
  if (!capability.supported || targetStatus === "unsupported_backend") return "unsupported";
  if (!snapshot.availability.connected || snapshot.source?.status === "unreachable" || snapshot.source?.status === "stale") {
    return "unavailable";
  }
  if (targetStatus === "missing_target") return "needs_input";
  if (targetStatus === "invalid_target_geometry" || targetStatus === "ambiguous_target") return "invalid_request";
  if (blockers.length > 0) return "blocked";
  return "ready";
}

function activeMissionCompatibility(snapshot: VacuumAdapterSnapshot) {
  const activeMission = summarizeMission(snapshot.activeMission);
  const status = snapshot.activeMission?.status;
  const activeStatuses = new Set(["preparing", "running", "paused", "canceling", "returning", "charging", "resuming", "needs_assistance"]);
  return {
    activeMission,
    compatible: !status || !activeStatuses.has(status),
    blockers: status && activeStatuses.has(status) ? [`Active ${snapshot.activeMission?.type} mission is ${status}.`] : [],
  };
}

function mapUsability(snapshot: VacuumAdapterSnapshot, purpose: "navigation" | "coverage") {
  const hasOccupancyMap = snapshot.map.metadata.hasMap;
  const usable = snapshot.map.readiness === "ready" && hasOccupancyMap;
  return {
    purpose,
    usable,
    readiness: snapshot.map.readiness,
    available: hasOccupancyMap || snapshot.map.layeredMetadata != null,
    blockers: usable ? [] : [productDetail(snapshot.map.detail) ?? `Map is not usable for ${purpose}.`],
  };
}

function mapIdentity(snapshot: VacuumAdapterSnapshot) {
  return {
    id: snapshot.map.layeredMetadata?.id ?? snapshot.mapping.activeMapName ?? null,
    activeMapName: snapshot.mapping.activeMapName,
    source: snapshot.map.layeredMetadata?.source,
    updatedAt: snapshot.map.layeredMetadata?.updatedAt ?? snapshot.map.metadata.lastUpdateAt,
  };
}

function mapDimensions(snapshot: VacuumAdapterSnapshot) {
  return {
    width: snapshot.map.metadata.hasMap ? snapshot.map.metadata.width : snapshot.map.layeredMetadata?.width ?? null,
    height: snapshot.map.metadata.hasMap ? snapshot.map.metadata.height : snapshot.map.layeredMetadata?.height ?? null,
  };
}

function mapResolution(snapshot: VacuumAdapterSnapshot) {
  return snapshot.map.metadata.hasMap ? snapshot.map.metadata.resolution : snapshot.map.layeredMetadata?.pixelSize ?? null;
}

function mapCellSummary(snapshot: VacuumAdapterSnapshot) {
  const metadata = snapshot.map.metadata;
  return {
    totalCells: metadata.totalCells,
    knownCells: metadata.knownCells,
    freeCells: metadata.freeCells,
    occupiedCells: metadata.occupiedCells,
    unknownCells: metadata.unknownCells,
    knownRatio: metadata.knownRatio,
    freeRatio: metadata.freeRatio,
    occupiedRatio: metadata.occupiedRatio,
    unknownRatio: metadata.unknownRatio,
    knownAreaSqM: metadata.knownAreaSqM,
  };
}

function annotationCounts(snapshot: VacuumAdapterSnapshot) {
  return {
    total: snapshot.map.annotations.length,
    rooms: snapshot.map.annotations.filter((annotation) => annotation.kind === "room").length,
    zones: snapshot.map.annotations.filter((annotation) => annotation.kind === "zone").length,
  };
}

function targetCounts(snapshot: VacuumAdapterSnapshot) {
  const roomTargets = (snapshot.map.targets?.segments ?? []).filter((target) => target.kind === "room" || target.kind === "segment");
  return {
    segments: snapshot.map.targets?.segments?.length ?? 0,
    rooms: roomTargets.length,
    zones: snapshot.map.targets?.zones?.length ?? 0,
  };
}

function mapTargetInventorySummary(snapshot: VacuumAdapterSnapshot) {
  return {
    identity: mapIdentity(snapshot),
    readiness: snapshot.map.readiness,
    source: snapshot.source,
    targetCounts: targetCounts(snapshot),
    annotations: annotationCounts(snapshot),
  };
}

function compactLayeredPreview(preview: VacuumAdapterSnapshot["map"]["layeredPreview"]) {
  if (!preview) return undefined;
  return {
    width: preview.width,
    height: preview.height,
    pixelSize: preview.pixelSize,
    coordinateSystem: preview.coordinateSystem,
    layerCount: preview.layers.length,
    entityCount: preview.entities.length,
    updatedAt: preview.updatedAt,
  };
}

function pathSummary(path: VacuumAdapterSnapshot["navigation"]["planPath"]) {
  return {
    available: Array.isArray(path) && path.length > 0,
    pointCount: path?.length ?? 0,
    start: path?.[0] ?? null,
    end: path && path.length > 0 ? path[path.length - 1] : null,
  };
}

function navigationBlockers(snapshot: VacuumAdapterSnapshot): string[] {
  return uniqueStrings([
    ...(snapshot.navigation.state === "blocked" ? ["Navigation is blocked."] : []),
    ...(snapshot.fault.faults ?? []),
  ]);
}

function capabilityDescriptor(name: VacuumCapabilityName, capability: VacuumCapabilities[VacuumCapabilityName]) {
  return {
    name,
    supported: capability.supported,
    status: capability.status ?? (capability.supported ? (capability.available === false ? "unavailable" : "supported") : "unsupported"),
    available: capability.available ?? capability.supported,
    attributes: capability.attributes?.filter((value) => !containsForbiddenRawTerm(value)),
    commands: capability.commands?.filter((value) => isVacuumCommandName(value)),
    availabilityReason: productDetail(capability.availabilityReason),
    reasons: capability.reasons,
  };
}

function requiredInputsForAction(action: string) {
  if (action === "check-navigation-readiness" || action === "start-navigation") return ["target.x", "target.y", "target.theta"];
  if (action === "check-clean-area-readiness" || action === "start-clean-area") {
    return ["area.type=rectangle", "area.x", "area.y", "area.width", "area.height"];
  }
  if (action === "check-room-cleaning-readiness") return ["room.id or room.name"];
  if (action === "check-zone-cleaning-readiness") return ["zone.id or zone.name"];
  return [];
}

function productDetail(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value
    .replaceAll("TurtleBot4/Nav2", "simulation")
    .replaceAll("Nav2", "navigation runtime")
    .replaceAll("ROS bridge", "simulation runtime")
    .replaceAll("ROS", "simulation runtime")
    .replaceAll("Valetudo", "real-vacuum")
    .replaceAll("/map", "normalized map")
    .replaceAll("/pose", "normalized pose")
    .replaceAll("nav2_msgs/action/NavigateToPose", "navigation mission support");
}

function containsForbiddenRawTerm(value: string): boolean {
  return FORBIDDEN_RAW_TERMS.some((term) => value.includes(term));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object";
}

function isVacuumCommandName(value: string): value is VacuumCommandName {
  return (VACUUM_COMMAND_NAMES as readonly string[]).includes(value);
}

function mapSummary(snapshot: VacuumAdapterSnapshot, params: VacuumParams) {
  const map = snapshot.map;
  return {
    available: map.metadata.hasMap || map.receiving || map.layeredMetadata != null,
    reason: map.metadata.hasMap || map.receiving || map.layeredMetadata != null ? undefined : productDetail(map.detail) ?? "Map is unavailable.",
    readiness: map.readiness,
    receiving: map.receiving,
    identity: mapIdentity(snapshot),
    dimensions: mapDimensions(snapshot),
    resolution: mapResolution(snapshot),
    cellSummary: mapCellSummary(snapshot),
    annotationCounts: annotationCounts(snapshot),
    targetCounts: targetCounts(snapshot),
    navigationUsability: mapUsability(snapshot, "navigation"),
    coverageUsability: mapUsability(snapshot, "coverage"),
    detail: productDetail(map.detail),
    layeredMetadata: map.layeredMetadata,
    layeredPreview: params.includePreview === true ? compactLayeredPreview(map.layeredPreview) : undefined,
    targets: params.includeGeometry === true ? map.targets : mapTargets(snapshot, false),
    annotations: annotationCounts(snapshot),
  };
}

function mapTargets(snapshot: VacuumAdapterSnapshot, includeGeometry: boolean) {
  if (includeGeometry) return snapshot.map.targets;
  return {
    segments: snapshot.map.targets?.segments?.map(({ geometry: _geometry, ...target }) => target),
    zones: snapshot.map.targets?.zones?.map(({ geometry: _geometry, ...target }) => target),
  };
}

function roomTargets(snapshot: VacuumAdapterSnapshot, includeGeometry: boolean) {
  const targets = (snapshot.map.targets?.segments ?? []).filter((target) => target.kind === "room" || target.kind === "segment");
  return includeGeometry ? targets : targets.map(({ geometry: _geometry, ...target }) => target);
}

function zoneTargets(snapshot: VacuumAdapterSnapshot, includeGeometry: boolean) {
  const targets = snapshot.map.targets?.zones ?? [];
  return includeGeometry ? targets : targets.map(({ geometry: _geometry, ...target }) => target);
}

function backendResponse(backend: VacuumRuntimeConfig["backend"]) {
  if (backend === "valetudo") {
    return {
      backend: "real_vacuum",
      backendAdapter: "valetudo",
      backendLabel: "Real vacuum",
    };
  }
  return {
    backend: "simulation",
    backendAdapter: "turtlebot4_nav2",
    backendLabel: "Simulation",
  };
}

function buildVacuumHealthResponse(
  params: VacuumParams,
  config: VacuumRuntimeConfig,
  health: VacuumRuntimeHealthSnapshot,
) {
  return {
    success: true,
    action: params.action,
    ...backendResponse(config.backend),
    timestamp: new Date().toISOString(),
    health: {
      availability: health.availability,
      runtime: health.health ? { ...health.health, detail: productDetail(health.health.detail) } : undefined,
      source: health.source,
      readiness: health.readiness,
      fault: health.fault,
    },
  };
}

function textResult(value: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) ?? "" }],
  };
}
