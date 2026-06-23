import { getConfig, getGlobalAuthInfo, setConfig } from "tensorfleet-auth";
import { ros2Bridge } from "tensorfleet-ros";
import {
  TensorfleetLogger,
  VACUUM_COMMAND_NAMES,
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

export type VacuumParams = TensorfleetVacuum & {
  TENSORFLEET_JWT?: string;
  TENSORFLEET_VM_MANAGER_URL?: string;
  TENSORFLEET_VALETUDO_RUNTIME_URL?: string;
  TENSORFLEET_VACUUM_BACKEND?: VacuumBackendInput;
};

export async function vacuumTool(id: string, params: VacuumParams) {
  try {
    hydrateVacuumConfig(params);
    const config = resolveRuntimeConfig(params);
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

function resolveRuntimeConfig(params: VacuumParams): VacuumRuntimeConfig {
  const backend = normalizeVacuumBackend(
    params.backend ??
      params.TENSORFLEET_VACUUM_BACKEND ??
      getConfig<string>("TENSORFLEET_VACUUM_BACKEND") ??
      "simulation",
  );
  const routeMode = params.routeMode ?? (params.runtimeUrl ? "direct" : "vm-manager");
  const baseUrl =
    routeMode === "direct"
      ? params.runtimeUrl ?? getConfig<string>("TENSORFLEET_VALETUDO_RUNTIME_URL") ?? "http://localhost:8080"
      : params.vmManagerUrl ?? getConfig<string>("TENSORFLEET_VM_MANAGER_URL") ?? "http://localhost:8080";
  const token = params.token ?? params.TENSORFLEET_JWT ?? getConfig<string>("TENSORFLEET_JWT") ?? getGlobalAuthInfo()?.token;

  return {
    backend,
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
