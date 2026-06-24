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
} from "tensorfleet-util";
import {
  createVacuumAdapter,
  normalizeVacuumBackend,
  normalizeVacuumTimeout,
  readVacuumRuntimeHealth,
  type VacuumBackendInput,
  type VacuumRuntimeHealthSnapshot,
  type VacuumRuntimeConfig,
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
  "get-mission-state",
] as const;

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
const DEFERRED_COMMANDS = [
  "start_navigation",
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
  "start_coverage",
  "start_room_cleaning",
  "start_zone_cleaning",
  "pause_mission",
  "resume_mission",
  "cancel_mission",
  "retry_mission_step",
  "skip_mission_step",
  "segment_cleaning",
  "zone_cleaning",
] as const satisfies readonly VacuumCommandName[];

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

export type VacuumParams = TensorfleetVacuum & {
  TENSORFLEET_JWT?: string;
  TENSORFLEET_VM_MANAGER_URL?: string;
  TENSORFLEET_VALETUDO_RUNTIME_URL?: string;
  TENSORFLEET_VACUUM_BACKEND?: VacuumBackendInput;
};

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
    const preflight = inspectRuntimePreflight(params, config);
    if (!preflight.ok) {
      return textResult(buildUnavailableRuntimeResponse(params, config, preflight));
    }

    if (params.action === "get-health" && config.backend === "valetudo") {
      return textResult(buildVacuumHealthResponse(params, config, await readVacuumRuntimeHealth(config)));
    }

    const adapter = await createVacuumAdapter(config, {
      rosBridge: ros2Bridge,
      withRosConnection: <T>(fn: () => Promise<T>) => withRosConnection(id, params, fn),
    });
    const result = await runVacuumAction(params, config, adapter.snapshot, async () => {
      const command = buildVacuumCommand(params);
      return await adapter.sendCommand(command);
    });

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
  sendCommand: () => Promise<VacuumCommandResult>,
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
        health: {
          availability: snapshot.availability,
          runtime: snapshot.health,
          source: snapshot.source,
          readiness: snapshot.readiness,
          fault: snapshot.fault,
        },
      };
    case "get-snapshot":
      return {
        ...base,
        snapshot: filterSnapshotDiagnostics(snapshot, params),
      };
    case "get-capabilities":
      return {
        ...base,
        capabilities: snapshot.capabilities,
        discovery: buildActionDiscoveryForSnapshot(config, snapshot.capabilities),
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
    case "get-mission-state":
      return {
        ...base,
        mission: snapshot.mission,
        activeMission: snapshot.activeMission,
        missions: snapshot.missions,
        activity: snapshot.activity,
        readiness: snapshot.readiness,
      };
    case "send-command":
      const result = await sendCommand();
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
    movementStartCallableTools: [],
    missionControlCallableTools: [],
    writeCapableButGatedActions: backendIsRealVacuum
      ? [
          {
            tool: VACUUM_TOOL_NAME,
            action: PUBLIC_COMMAND_ACTION,
            commands: PUBLIC_COMMANDS,
            reason: "send-command is exposed but requires an explicit user control request plus live runtime capability/readiness checks.",
          },
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
              reason: "Simulation command dispatch currently returns explicit unsupported command results.",
            },
          ]
        : []),
      ...(backendIsRealVacuum && runtimeBlockers.length > 0
        ? [
            {
              tool: VACUUM_TOOL_NAME,
              action: PUBLIC_COMMAND_ACTION,
              commands: PUBLIC_COMMANDS,
              reason: runtimeBlockers.join(" "),
            },
          ]
        : []),
    ],
    readOnlyActions: READ_ONLY_ACTIONS.map((action) => ({ tool: VACUUM_TOOL_NAME, action })),
    writeActions: [
      {
        tool: VACUUM_TOOL_NAME,
        action: PUBLIC_COMMAND_ACTION,
        commands: [...STATE_CHANGING_COMMANDS, ...MISSION_CONTROL_COMMANDS, ...MOVEMENT_START_COMMANDS],
      },
    ],
    movementAffectingActions: [
      {
        tool: VACUUM_TOOL_NAME,
        action: PUBLIC_COMMAND_ACTION,
        commands: [...MOVEMENT_START_COMMANDS, "resume"],
      },
    ],
    deferredActions: DEFERRED_COMMANDS.map((command) => ({
      command,
      callable: false,
      reason: "Deferred in Step 0 + Step 1; not exposed by the current vacuum tool schema.",
    })),
    unsupportedActions: backendIsSimulation
      ? PUBLIC_COMMANDS.map((command) => ({
          command,
          callable: false,
          reason: "The simulation backend currently exposes vacuum command results as unsupported.",
        }))
      : [],
  };
}

function buildActionDiscoveryForSnapshot(config: VacuumRuntimeConfig, capabilities: VacuumCapabilities) {
  const supportedPublicCommands = PUBLIC_COMMANDS.filter((command) => {
    const capabilityName = command === "set_fan_speed" ? "fan_speed" : command === "set_water_usage" ? "water_usage" : command;
    const capability = capabilities[capabilityName];
    return capability?.supported === true && capability.available !== false;
  });

  return {
    ...buildStaticActionGroups(config.backend, []),
    supportedByCurrentSnapshot: {
      commands: supportedPublicCommands,
      movementStartCommands: supportedPublicCommands.filter((command) =>
        (MOVEMENT_START_COMMANDS as readonly string[]).includes(command),
      ),
    },
    canMoveVacuumNow: false,
    movementBlockers: movementBlockers(config.backend, []),
  };
}

function movementBlockers(backend: VacuumRuntimeConfig["backend"] | null, runtimeBlockers: string[]): string[] {
  return [
    ...runtimeBlockers,
    "Step 0 + Step 1 is discovery/readiness only and does not mark movement-start actions callable.",
    ...(backend === "turtlebot4_nav2" ? ["Simulation movement commands are not exposed as callable by this tool."] : []),
    ...(backend === "valetudo"
      ? ["Real-vacuum movement requires an explicit user control request and a live capability/readiness gate."]
      : []),
  ];
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

function isVacuumCommandName(value: string): value is VacuumCommandName {
  return (VACUUM_COMMAND_NAMES as readonly string[]).includes(value);
}

function filterSnapshotDiagnostics(snapshot: VacuumAdapterSnapshot, params: VacuumParams): VacuumAdapterSnapshot {
  if (params.includeDiagnostics === true) {
    if (params.includeRawDiagnostics === true || !snapshot.diagnostics) return snapshot;
    const { raw: _raw, ...diagnostics } = snapshot.diagnostics;
    return {
      ...snapshot,
      diagnostics,
    };
  }
  const { diagnostics: _diagnostics, ...withoutDiagnostics } = snapshot;
  return withoutDiagnostics;
}

function mapSummary(snapshot: VacuumAdapterSnapshot, params: VacuumParams) {
  const map = snapshot.map;
  return {
    readiness: map.readiness,
    receiving: map.receiving,
    detail: map.detail,
    metadata: map.metadata,
    layeredMetadata: map.layeredMetadata,
    layeredPreview: params.includePreview === true ? map.layeredPreview : undefined,
    targets: params.includeGeometry === true ? map.targets : mapTargets(snapshot, false),
    annotations: map.annotations,
  };
}

function mapTargets(snapshot: VacuumAdapterSnapshot, includeGeometry: boolean) {
  if (includeGeometry) return snapshot.map.targets;
  return {
    segments: snapshot.map.targets?.segments?.map(({ geometry: _geometry, ...target }) => target),
    zones: snapshot.map.targets?.zones?.map(({ geometry: _geometry, ...target }) => target),
  };
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
      runtime: health.health,
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
