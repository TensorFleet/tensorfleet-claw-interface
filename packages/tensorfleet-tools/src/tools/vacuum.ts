import * as http from "http";
import * as https from "https";

import { getConfig, getGlobalAuthInfo, setConfig } from "tensorfleet-auth";
import { ros2Bridge } from "tensorfleet-ros";
import { TensorfleetLogger } from "tensorfleet-util";
import type { TensorfleetVacuum } from "../schema-types/tensorfleet.vacuum.input";
import { withRosConnection } from "./ros-connect";

const logger = new TensorfleetLogger("Tools");

const VM_MANAGER_REAL_VACUUM_PATH = "/vms/self/tensorfleet/api/v1/valetudo";
const DIRECT_REAL_VACUUM_PATH = "/api/v1/valetudo";
const DEFAULT_TIMEOUT_MS = 5000;
const SIMULATION_TOPIC_TIMEOUT_MS = 1200;
const SIMULATION_MISSION_SNAPSHOT_SERVICE = "/vacuum_mission/get_snapshot";
const SIMULATION_MAP_ANNOTATION_SNAPSHOT_SERVICE = "/vacuum_map_annotations/get_snapshot";

type VacuumBackend = "valetudo" | "turtlebot4_nav2";
type VacuumBackendInput = VacuumBackend | "simulation" | "real_vacuum" | "real-vacuum" | "turtlebot4-nav2";
type VacuumRouteMode = "vm-manager" | "direct";
type VacuumCommandName = NonNullable<TensorfleetVacuum["command"]>;
type RosTopicInfo = { topic: string; type: string };
type RosServiceInfo = { service: string; type: string };

export type VacuumParams = TensorfleetVacuum & {
  TENSORFLEET_JWT?: string;
  TENSORFLEET_VM_MANAGER_URL?: string;
  TENSORFLEET_VALETUDO_RUNTIME_URL?: string;
  TENSORFLEET_VACUUM_BACKEND?: VacuumBackendInput;
};

type VacuumRuntimeConfig = {
  backend: VacuumBackend;
  routeMode: VacuumRouteMode;
  baseUrl: string;
  token?: string;
  timeoutMs: number;
};

type RuntimeCommandAvailability = {
  available?: boolean;
  reason?: string;
};

type ValetudoRuntimeHealth = {
  runtime?: {
    id?: string;
    version?: string;
    status?: string;
  };
  source?: {
    kind?: string;
    status?: string;
    stale?: boolean;
    lastSeenAt?: number | string | null;
  };
  updatedAt?: number | string;
};

type ValetudoRuntimeSnapshot = ValetudoRuntimeHealth & {
  backend?: string;
  robot?: {
    id?: string;
    name?: string;
  };
  connectivity?: {
    reachable?: boolean;
    online?: boolean;
  };
  state?: {
    value?: string;
    label?: string;
    started?: boolean;
    paused?: boolean;
  };
  battery?: {
    level?: number;
    charging?: boolean;
  };
  dock?: {
    state?: string;
    docked?: boolean;
    components?: unknown[];
  };
  cleaningSettings?: {
    fanSpeed?: RuntimeSetting;
    waterUsage?: RuntimeSetting;
  };
  maintenance?: {
    consumables?: unknown[];
  };
  statistics?: {
    current?: unknown;
  };
  attachments?: {
    items?: unknown[];
  };
  map?: RuntimeMap;
  capabilities?: {
    commands?: Record<string, RuntimeCommandAvailability>;
    diagnostics?: Array<{ name?: string; detected?: boolean; implemented?: boolean; scope?: string; note?: string }>;
  };
  diagnostics?: {
    mode?: string;
    rawCapabilityNames?: string[];
    notes?: string[];
    readiness?: unknown;
    lastCommand?: unknown;
    source?: unknown;
  };
  rawDiagnostics?: unknown;
};

type RuntimeSetting = {
  current?: string;
  options?: Array<string | { value?: string; label?: string }>;
};

type RuntimeMap = {
  available?: boolean;
  source?: string;
  updatedAt?: number | string;
  metadata?: {
    id?: string;
    width?: number;
    height?: number;
    pixelSize?: number;
    coordinateSystem?: string;
    layerCount?: number;
    entityCount?: number;
    segmentCount?: number;
    zoneCount?: number;
  };
  preview?: {
    layers?: RuntimeMapLayer[];
    entities?: RuntimeMapEntity[];
  };
  targets?: {
    segments?: RuntimeMapTarget[];
    zones?: RuntimeMapTarget[];
  };
  detail?: string;
  diagnostics?: string[];
};

type RuntimeMapLayer = {
  id?: string;
  kind?: string;
  label?: string;
  segmentId?: string;
  runs?: Array<{ x?: number; y?: number; count?: number }>;
  points?: Array<{ x?: number; y?: number }>;
};

type RuntimeMapEntity = {
  id?: string;
  kind?: string;
  label?: string;
  points?: Array<{ x?: number; y?: number }>;
  angle?: number;
  detail?: string;
};

type RuntimeMapTarget = {
  id?: string;
  label?: string;
  kind?: string;
  available?: boolean;
  geometry?: RuntimeMapTargetGeometry;
  detail?: string;
};

type RuntimeMapTargetGeometry = {
  type?: string;
  points?: Array<{ x?: number; y?: number }>;
  bounds?: { x?: number; y?: number; width?: number; height?: number };
};

type ValetudoRuntimeCommandResult = {
  ok?: boolean;
  status?: string;
  command?: string;
  message?: string;
  reason?: string;
  code?: string;
  updatedAt?: number | string;
  diagnostics?: unknown;
};

type SimulationRosSnapshot = {
  topics: RosTopicInfo[];
  services: RosServiceInfo[];
  mapMessage: Record<string, unknown> | null;
  batteryMessage: Record<string, unknown> | null;
  missionSnapshot: Record<string, unknown> | null;
  mapAnnotationSnapshot: Record<string, unknown> | null;
  updatedAt: string;
};

export async function vacuumTool(_id: string, params: VacuumParams) {
  try {
    hydrateVacuumConfig(params);
    const config = resolveRuntimeConfig(params);

    if (config.backend !== "valetudo") {
      return await handleSimulationVacuum(_id, params, config);
    }

    switch (params.action) {
      case "get-health": {
        const health = await requestValetudo<ValetudoRuntimeHealth>(config, "GET", "health");
        return textResult({
          success: true,
          action: params.action,
          ...backendResponse(config.backend),
          health: normalizeHealth(health),
          timestamp: new Date().toISOString(),
        });
      }

      case "get-snapshot": {
        const snapshot = await fetchSnapshot(config);
        return textResult({
          success: true,
          action: params.action,
          ...backendResponse(config.backend),
          snapshot: normalizeSnapshot(snapshot, params),
          timestamp: new Date().toISOString(),
        });
      }

      case "get-capabilities": {
        const snapshot = await fetchSnapshot(config);
        return textResult({
          success: true,
          action: params.action,
          ...backendResponse(config.backend),
          capabilities: normalizeCapabilities(snapshot),
          timestamp: new Date().toISOString(),
        });
      }

      case "get-map-summary": {
        const snapshot = await fetchSnapshot(config);
        return textResult({
          success: true,
          action: params.action,
          ...backendResponse(config.backend),
          map: normalizeMap(snapshot.map, params),
          timestamp: new Date().toISOString(),
        });
      }

      case "get-map-targets": {
        const snapshot = await fetchSnapshot(config);
        return textResult({
          success: true,
          action: params.action,
          ...backendResponse(config.backend),
          targets: normalizeTargets(snapshot.map?.targets, params.includeGeometry === true),
          note: "Map targets are read-only in this tool; target cleaning commands are not exposed.",
          timestamp: new Date().toISOString(),
        });
      }

      case "get-mission-state": {
        const snapshot = await fetchSnapshot(config);
        return textResult({
          success: true,
          action: params.action,
          ...backendResponse(config.backend),
          mission: normalizeMission(snapshot),
          timestamp: new Date().toISOString(),
        });
      }

      case "send-command": {
        const snapshot = await fetchSnapshot(config);
        const commandRequest = buildCommandRequest(params, snapshot);
        if (!commandRequest.ok) {
          return textResult({
            success: false,
            action: params.action,
            ...backendResponse(config.backend),
            command: params.command ?? null,
            error: commandRequest.error,
            timestamp: new Date().toISOString(),
          });
        }

        const commandResult = await requestValetudo<ValetudoRuntimeCommandResult>(
          config,
          "POST",
          "command",
          commandRequest.request,
          { allowErrorBody: true },
        );

        return textResult({
          success: commandResult.ok === true && commandResult.status === "success",
          action: params.action,
          ...backendResponse(config.backend),
          command: params.command,
          result: normalizeCommandResult(params.command, commandResult),
          timestamp: new Date().toISOString(),
        });
      }

      default:
        throw new Error(`Unknown vacuum action: ${(params as { action: string }).action}`);
    }
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
  const backend = normalizeBackend(
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
    timeoutMs: normalizeTimeout(params.timeoutMs),
  };
}

function normalizeBackend(value: string): VacuumBackend {
  if (value === "valetudo" || value === "real_vacuum" || value === "real-vacuum") return "valetudo";
  if (value === "simulation" || value === "turtlebot4-nav2" || value === "turtlebot4_nav2") {
    return "turtlebot4_nav2";
  }
  throw new Error(`Unsupported vacuum backend: ${value}`);
}

function normalizeTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs == null) return DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("timeoutMs must be a positive number");
  }
  return timeoutMs;
}

function endpoint(config: VacuumRuntimeConfig, path: "health" | "snapshot" | "command"): string {
  const baseUrl = trimTrailingSlash(config.baseUrl);
  const routePrefix = config.routeMode === "direct" ? DIRECT_REAL_VACUUM_PATH : VM_MANAGER_REAL_VACUUM_PATH;
  return `${baseUrl}${routePrefix}/${path}`;
}

function backendResponse(backend: VacuumBackend) {
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

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

async function fetchSnapshot(config: VacuumRuntimeConfig): Promise<ValetudoRuntimeSnapshot> {
  return requestValetudo<ValetudoRuntimeSnapshot>(config, "GET", "snapshot");
}

async function handleSimulationVacuum(_id: string, params: VacuumParams, config: VacuumRuntimeConfig) {
  if (params.action === "send-command") {
    return textResult({
      success: false,
      action: params.action,
      ...backendResponse(config.backend),
      command: params.command ?? null,
      error: {
        code: "unsupported",
        message:
          params.command == null
            ? "command is required for action=send-command."
            : `Command ${params.command} is not supported by the TurtleBot4/Nav2 adapter exposed by this tool.`,
      },
      timestamp: new Date().toISOString(),
    });
  }

  return await withRosConnection(_id, params, async () => {
    const snapshot = await readSimulationRosSnapshot();

    switch (params.action) {
      case "get-health":
        return textResult({
          success: true,
          action: params.action,
          ...backendResponse(config.backend),
          health: normalizeSimulationHealth(snapshot),
          timestamp: new Date().toISOString(),
        });
      case "get-snapshot":
        return textResult({
          success: true,
          action: params.action,
          ...backendResponse(config.backend),
          snapshot: normalizeSimulationSnapshot(snapshot, params),
          timestamp: new Date().toISOString(),
        });
      case "get-capabilities":
        return textResult({
          success: true,
          action: params.action,
          ...backendResponse(config.backend),
          capabilities: normalizeSimulationCapabilities(snapshot),
          timestamp: new Date().toISOString(),
        });
      case "get-map-summary":
        return textResult({
          success: true,
          action: params.action,
          ...backendResponse(config.backend),
          map: normalizeSimulationMap(snapshot, params),
          timestamp: new Date().toISOString(),
        });
      case "get-map-targets":
        return textResult({
          success: true,
          action: params.action,
          ...backendResponse(config.backend),
          targets: normalizeSimulationTargets(snapshot.mapAnnotationSnapshot, params.includeGeometry === true),
          timestamp: new Date().toISOString(),
        });
      case "get-mission-state":
        return textResult({
          success: true,
          action: params.action,
          ...backendResponse(config.backend),
          mission: normalizeSimulationMission(snapshot),
          timestamp: new Date().toISOString(),
        });
      default:
        throw new Error(`Unknown vacuum action: ${(params as { action: string }).action}`);
    }
  });
}

async function readSimulationRosSnapshot(): Promise<SimulationRosSnapshot> {
  const topics = typeof ros2Bridge.getAvailableTopics === "function" ? ros2Bridge.getAvailableTopics() : [];
  const services = typeof ros2Bridge.getAvailableServices === "function" ? ros2Bridge.getAvailableServices() : [];
  const missionSnapshotService = findService(services, SIMULATION_MISSION_SNAPSHOT_SERVICE);
  const annotationSnapshotService = findService(services, SIMULATION_MAP_ANNOTATION_SNAPSHOT_SERVICE);

  const [mapMessage, batteryMessage, missionSnapshot, mapAnnotationSnapshot] = await Promise.all([
    readOptionalRosTopic(findTopic(topics, "/map"), SIMULATION_TOPIC_TIMEOUT_MS),
    readOptionalRosTopic(findFirstTopic(topics, ["/battery_state", "/battery"]), SIMULATION_TOPIC_TIMEOUT_MS),
    missionSnapshotService ? callOptionalRosService(missionSnapshotService.service) : Promise.resolve(null),
    annotationSnapshotService ? callOptionalRosService(annotationSnapshotService.service) : Promise.resolve(null),
  ]);

  return {
    topics,
    services,
    mapMessage,
    batteryMessage,
    missionSnapshot,
    mapAnnotationSnapshot,
    updatedAt: new Date().toISOString(),
  };
}

function findTopic(topics: RosTopicInfo[], topic: string): RosTopicInfo | undefined {
  return topics.find((entry) => entry.topic === topic);
}

function findFirstTopic(topics: RosTopicInfo[], candidates: string[]): RosTopicInfo | undefined {
  return candidates.map((topic) => findTopic(topics, topic)).find((entry): entry is RosTopicInfo => entry != null);
}

function findService(services: RosServiceInfo[], service: string): RosServiceInfo | undefined {
  return services.find((entry) => entry.service === service);
}

async function readOptionalRosTopic(topic: RosTopicInfo | undefined, timeoutMs: number): Promise<Record<string, unknown> | null> {
  if (!topic) return null;

  return await new Promise<Record<string, unknown> | null>((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    let timeout: ReturnType<typeof setTimeout>;
    const finish = (value: Record<string, unknown> | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (unsubscribe) unsubscribe();
      resolve(value);
    };
    timeout = setTimeout(() => finish(null), timeoutMs);

    try {
      unsubscribe = ros2Bridge.subscribe({ topic: topic.topic, type: topic.type }, (message: unknown) => {
        finish(isRecord(message) ? message : null);
      });
    } catch {
      finish(null);
    }
  });
}

async function callOptionalRosService(service: string): Promise<Record<string, unknown> | null> {
  try {
    const result = await ros2Bridge.callService<unknown>(service, {}, { timeoutMs: DEFAULT_TIMEOUT_MS });
    return isRecord(result) ? result : null;
  } catch {
    return null;
  }
}

function normalizeSimulationHealth(snapshot: SimulationRosSnapshot) {
  return {
    runtime: {
      id: "turtlebot4_nav2",
      version: null,
      status: ros2Bridge.isConnected() ? "online" : "offline",
    },
    source: {
      kind: "ros_bridge",
      status: ros2Bridge.isConnected() ? "reachable" : "unreachable",
      stale: false,
      lastSeenAt: snapshot.updatedAt,
    },
    updatedAt: snapshot.updatedAt,
  };
}

function normalizeSimulationSnapshot(
  snapshot: SimulationRosSnapshot,
  params: Pick<VacuumParams, "includeDiagnostics" | "includeRawDiagnostics">,
) {
  const normalized: Record<string, unknown> = {
    identity: {
      id: "turtlebot4_nav2",
      label: "TurtleBot4/Nav2 Simulation",
      source: "turtlebot4_nav2",
      model: "simulation",
    },
    availability: {
      status: ros2Bridge.isConnected() ? "online" : "offline",
      connected: ros2Bridge.isConnected(),
      reachable: ros2Bridge.isConnected(),
      stale: false,
    },
    health: normalizeSimulationHealth(snapshot),
    activity: normalizeSimulationActivity(snapshot),
    battery: normalizeSimulationBattery(snapshot.batteryMessage),
    dock: null,
    cleaningSettings: {
      fanSpeed: null,
      waterUsage: null,
    },
    maintenance: {
      consumables: [],
    },
    statistics: null,
    attachments: {
      items: [],
    },
    map: normalizeSimulationMap(snapshot, { includePreview: true, includeGeometry: false }),
    capabilities: normalizeSimulationCapabilities(snapshot),
    mission: normalizeSimulationMission(snapshot),
    readiness: normalizeSimulationReadiness(snapshot),
    updatedAt: snapshot.updatedAt,
  };

  if (params.includeDiagnostics === true) {
    normalized.diagnostics = {
      backend: "turtlebot4_nav2",
      source: "ros_bridge",
      topics: summarizeRosTopics(snapshot.topics),
      services: summarizeRosServices(snapshot.services),
      ...(params.includeRawDiagnostics === true
        ? {
            raw: {
              missionSnapshot: snapshot.missionSnapshot,
              mapAnnotationSnapshot: snapshot.mapAnnotationSnapshot,
              mapMessage: snapshot.mapMessage,
              batteryMessage: snapshot.batteryMessage,
            },
          }
        : {}),
    };
  }

  return normalized;
}

function normalizeSimulationCapabilities(snapshot: SimulationRosSnapshot) {
  const services = new Set(snapshot.services.map((entry) => entry.service));
  const topics = new Set(snapshot.topics.map((entry) => entry.topic));
  const readiness = normalizeSimulationReadiness(snapshot);
  const commandEntries = [
    commandCapability("start_navigation", services.has("/vacuum_mission/start_navigation") && services.has("/vacuum_mission_runtime/set_parameters"), readiness),
    commandCapability("start_coverage", services.has("/vacuum_mission/start_coverage") && services.has("/vacuum_mission_runtime/set_parameters"), readiness),
    commandCapability("cancel_mission", services.has("/vacuum_mission/cancel"), readiness),
    commandCapability("pause_mission", services.has("/vacuum_mission/pause"), readiness),
    commandCapability("resume_mission", services.has("/vacuum_mission/resume"), readiness),
    commandCapability("retry_mission_step", services.has("/vacuum_mission/retry_step"), readiness),
    commandCapability("skip_mission_step", services.has("/vacuum_mission/skip_step"), readiness),
    commandCapability("start_mapping", services.has("/vacuum_mapping/start_auto") && services.has("/vacuum_mapping/start_manual"), readiness),
    commandCapability("pause_mapping", services.has("/vacuum_mapping/pause"), readiness),
    commandCapability("resume_mapping", services.has("/vacuum_mapping/resume"), readiness),
    commandCapability("finish_mapping", services.has("/vacuum_mapping/finish"), readiness),
    commandCapability("discard_mapping", services.has("/vacuum_mapping/discard"), readiness),
    commandCapability("accept_map", services.has("/vacuum_mapping/accept"), readiness),
    commandCapability("load_map", services.has("/vacuum_mapping/load_map"), readiness),
  ];

  return {
    commands: commandEntries,
    detected: [
      {
        name: "map",
        detected: topics.has("/map"),
        implemented: true,
        scope: "topic",
        note: "/map occupancy grid",
      },
      {
        name: "mission_state",
        detected: topics.has("/vacuum_mission/status") || services.has(SIMULATION_MISSION_SNAPSHOT_SERVICE),
        implemented: true,
        scope: "topic_or_service",
        note: "VM-owned vacuum mission runtime",
      },
      {
        name: "map_annotations",
        detected: services.has(SIMULATION_MAP_ANNOTATION_SNAPSHOT_SERVICE),
        implemented: true,
        scope: "service",
        note: "VM map annotation snapshot",
      },
    ],
    callableCommands: commandEntries.filter((entry) => entry.available).map((entry) => entry.name),
    deferredCommands: ["go_to_location", "room_cleaning", "zone_cleaning"],
  };
}

function commandCapability(name: string, supported: boolean, readiness: { ready: boolean; blockingReasons: string[] }) {
  return {
    name,
    supported,
    available: supported && readiness.ready,
    reason: supported ? (readiness.ready ? undefined : "not_ready") : "unsupported",
  };
}

function normalizeSimulationMap(snapshot: SimulationRosSnapshot, params: Pick<VacuumParams, "includePreview" | "includeGeometry">) {
  const mapInfo = snapshot.mapMessage?.info;
  const info = isRecord(mapInfo) ? mapInfo : null;
  const targets = normalizeSimulationTargets(snapshot.mapAnnotationSnapshot, params.includeGeometry === true);
  const width = numberOrNull(info?.width);
  const height = numberOrNull(info?.height);
  const resolution = numberOrNull(info?.resolution);

  return {
    available: snapshot.mapMessage != null || findTopic(snapshot.topics, "/map") != null,
    source: "ros_topic:/map",
    detail: snapshot.mapMessage ? "Map sampled from /map." : "Map topic is available, but no sample arrived before timeout.",
    updatedAt: snapshot.updatedAt,
    metadata: {
      id: "turtlebot4_nav2:map",
      width,
      height,
      pixelSize: resolution,
      coordinateSystem: "map",
      layerCount: snapshot.mapMessage ? 1 : 0,
      entityCount: 0,
      segmentCount: targets.segmentCount,
      zoneCount: targets.zoneCount,
    },
    preview: params.includePreview === true
      ? {
          layerCount: snapshot.mapMessage ? 1 : 0,
          entityCount: 0,
          layers: snapshot.mapMessage
            ? [
                {
                  id: "occupancy_grid",
                  kind: "occupancy_grid",
                  label: "Occupancy Grid",
                  runCount: Array.isArray(snapshot.mapMessage.data) ? snapshot.mapMessage.data.length : 0,
                  pointCount: 0,
                },
              ]
            : [],
          entities: [],
        }
      : {
          layerCount: snapshot.mapMessage ? 1 : 0,
          entityCount: 0,
        },
    targets,
    diagnostics: [],
  };
}

function normalizeSimulationTargets(snapshot: Record<string, unknown> | null, includeGeometry: boolean) {
  const annotations = extractSimulationAnnotations(snapshot);
  const rooms = annotations.filter((annotation) => annotation.kind === "room");
  const zones = annotations.filter((annotation) => annotation.kind === "zone");

  return {
    segmentCount: rooms.length,
    zoneCount: zones.length,
    segments: rooms.map((annotation) => normalizeSimulationTarget(annotation, includeGeometry)),
    zones: zones.map((annotation) => normalizeSimulationTarget(annotation, includeGeometry)),
  };
}

function normalizeSimulationTarget(annotation: Record<string, unknown>, includeGeometry: boolean) {
  const geometry = isRecord(annotation.area) ? annotation.area : undefined;
  return {
    id: stringOrDefault(annotation.id, "unknown"),
    label: stringOrDefault(annotation.name, stringOrDefault(annotation.label, "Unnamed")),
    kind: stringOrDefault(annotation.kind, "unknown"),
    available: true,
    detail: stringOrNull(annotation.description),
    ...(includeGeometry ? { geometry } : { geometrySummary: summarizeGeometry(geometry as RuntimeMapTargetGeometry | undefined) }),
  };
}

function extractSimulationAnnotations(snapshot: Record<string, unknown> | null): Array<Record<string, unknown>> {
  if (!snapshot) return [];
  const candidates = [snapshot.annotations, snapshot.items, snapshot.mapAnnotations];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(isRecord);
    }
  }
  return [];
}

function normalizeSimulationMission(snapshot: SimulationRosSnapshot) {
  const active = normalizeSimulationActiveMission(snapshot.missionSnapshot);
  const recent = Array.isArray(snapshot.missionSnapshot?.recentMissions)
    ? snapshot.missionSnapshot.recentMissions.filter(isRecord)
    : [];
  return {
    active: active != null,
    status: active ? stringOrDefault(active.status, "running") : "idle",
    label: active ? humanizeOption(stringOrDefault(active.type, "mission")) : "Idle",
    availableActions: active ? arrayOrEmpty(active.availableActions as string[] | undefined) : [],
    activeMission: active,
    recent,
    note: snapshot.missionSnapshot
      ? "Mission state delegated to the VM vacuum mission runtime."
      : "Mission snapshot service is not advertised or did not respond.",
  };
}

function normalizeSimulationActiveMission(snapshot: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!snapshot) return null;
  const activeMission = snapshot.activeMission;
  if (isRecord(activeMission)) return activeMission;
  if (typeof snapshot.status === "string" && snapshot.status !== "idle") return snapshot;
  return null;
}

function normalizeSimulationActivity(snapshot: SimulationRosSnapshot) {
  const mission = normalizeSimulationMission(snapshot);
  const status = mission.active ? mission.status : "idle";
  return {
    status,
    label: mission.label,
    source: "turtlebot4_nav2",
    availableActions: mission.availableActions,
    updatedAt: snapshot.updatedAt,
  };
}

function normalizeSimulationReadiness(snapshot: SimulationRosSnapshot) {
  const topics = new Set(snapshot.topics.map((entry) => entry.topic));
  const blockingReasons = [
    ...(ros2Bridge.isConnected() ? [] : ["bridge_not_connected"]),
    ...(topics.has("/map") ? [] : ["map_topic_missing"]),
  ];

  return {
    ready: blockingReasons.length === 0,
    blockingReasons,
  };
}

function normalizeSimulationBattery(message: Record<string, unknown> | null) {
  if (!message) return null;
  const percentage = numberOrNull(message.percentage);
  const level = numberOrNull(message.level);
  return {
    percentage: percentage != null ? Math.round(percentage * 100) : level,
    charging: Boolean(message.power_supply_status === 1 || message.charging === true),
  };
}

function summarizeRosTopics(topics: RosTopicInfo[]) {
  return topics.map((entry) => ({ topic: entry.topic, type: entry.type }));
}

function summarizeRosServices(services: RosServiceInfo[]) {
  return services.map((entry) => ({ service: entry.service, type: entry.type }));
}

async function requestValetudo<T>(
  config: VacuumRuntimeConfig,
  method: "GET" | "POST",
  path: "health" | "snapshot" | "command",
  body?: unknown,
  options: { allowErrorBody?: boolean } = {},
): Promise<T> {
  if (config.routeMode === "vm-manager" && !config.token) {
    throw new Error("Not authenticated. Run tensorfleet-auth login first or pass token.");
  }

  const url = new URL(endpoint(config, path));
  const data = body == null ? undefined : JSON.stringify(body);
  const isHttps = url.protocol === "https:";
  const lib = isHttps ? https : http;
  const headers: http.OutgoingHttpHeaders = {
    Accept: "application/json",
    ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
  };
  if (config.token) {
    headers.Authorization = `Bearer ${config.token}`;
  }

  return new Promise<T>((resolve, reject) => {
    const req = lib.request(
      {
        method,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on("end", () => {
          const bodyText = Buffer.concat(chunks).toString("utf8");
          let payload: unknown;
          try {
            payload = parseJsonBody(bodyText);
          } catch (error) {
            reject(error);
            return;
          }

          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            if (payload == null) {
              reject(new Error("Valetudo runtime returned an empty response."));
              return;
            }
            resolve(payload as T);
            return;
          }

          if (options.allowErrorBody && payload != null) {
            resolve(payload as T);
            return;
          }

          reject(new Error(`Valetudo runtime request failed with HTTP ${res.statusCode}: ${bodyText || res.statusMessage || "Unknown error"}`));
        });
      },
    );

    req.on("error", (error) => reject(error));
    req.setTimeout(config.timeoutMs, () => req.destroy(new Error("Valetudo runtime request timed out")));
    if (data) req.write(data);
    req.end();
  });
}

function parseJsonBody(bodyText: string): unknown {
  if (!bodyText.trim()) return null;
  try {
    return JSON.parse(bodyText);
  } catch {
    throw new Error("Valetudo runtime returned malformed JSON.");
  }
}

function normalizeHealth(health: ValetudoRuntimeHealth) {
  return {
    runtime: {
      id: stringOrNull(health.runtime?.id),
      version: stringOrNull(health.runtime?.version),
      status: stringOrDefault(health.runtime?.status, "unknown"),
    },
    source: {
      kind: stringOrDefault(health.source?.kind, "unknown"),
      status: normalizeSourceStatus(health.source),
      stale: health.source?.stale === true,
      lastSeenAt: health.source?.lastSeenAt ?? null,
    },
    updatedAt: health.updatedAt ?? null,
  };
}

function normalizeSnapshot(snapshot: ValetudoRuntimeSnapshot, params: Pick<VacuumParams, "includeDiagnostics" | "includeRawDiagnostics">) {
  const normalized: Record<string, unknown> = {
    identity: {
      id: stringOrDefault(snapshot.robot?.id, "valetudo"),
      label: stringOrDefault(snapshot.robot?.name, "Valetudo Vacuum"),
      source: "valetudo",
      model: stringOrNull(snapshot.runtime?.id),
    },
    availability: {
      status: snapshot.connectivity?.online === true ? "online" : "offline",
      connected: snapshot.connectivity?.online === true,
      reachable: snapshot.connectivity?.reachable === true,
      stale: snapshot.source?.stale === true,
    },
    health: normalizeHealth(snapshot),
    activity: normalizeActivity(snapshot),
    battery: snapshot.battery
      ? {
          percentage: numberOrNull(snapshot.battery.level),
          charging: snapshot.battery.charging === true,
        }
      : null,
    dock: snapshot.dock
      ? {
          state: normalizeDockState(snapshot),
          docked: snapshot.dock.docked === true,
          components: arrayOrEmpty(snapshot.dock.components),
        }
      : null,
    cleaningSettings: normalizeCleaningSettings(snapshot.cleaningSettings),
    maintenance: {
      consumables: arrayOrEmpty(snapshot.maintenance?.consumables),
    },
    statistics: snapshot.statistics ?? null,
    attachments: {
      items: arrayOrEmpty(snapshot.attachments?.items),
    },
    map: normalizeMap(snapshot.map, { includePreview: true, includeGeometry: false }),
    capabilities: normalizeCapabilities(snapshot),
    mission: normalizeMission(snapshot),
    readiness: normalizeReadiness(snapshot),
    updatedAt: snapshot.updatedAt ?? null,
  };

  if (params.includeDiagnostics === true) {
    normalized.diagnostics = {
      backend: "valetudo",
      mode: snapshot.diagnostics?.mode,
      source: snapshot.diagnostics?.source ?? snapshot.source,
      readiness: snapshot.diagnostics?.readiness,
      notes: arrayOrEmpty(snapshot.diagnostics?.notes),
      rawCapabilityNames: arrayOrEmpty(snapshot.diagnostics?.rawCapabilityNames),
      ...(params.includeRawDiagnostics === true ? { raw: snapshot.rawDiagnostics } : {}),
    };
  }

  return normalized;
}

function normalizeCapabilities(snapshot: ValetudoRuntimeSnapshot) {
  const commandEntries = publicValetudoCommandEntries(snapshot).map(([name, value]) => {
    const effective = effectiveCommandAvailability(name, value, snapshot);
    return {
      name,
      supported: true,
      available: effective.available,
      reason: effective.available ? undefined : effective.reason,
    };
  });
  const detected = (snapshot.capabilities?.diagnostics ?? []).map((capability) => ({
    name: capability.name,
    detected: capability.detected === true,
    implemented: capability.implemented === true,
    scope: capability.scope,
    note: capability.note,
  }));

  return {
    commands: commandEntries,
    detected,
    callableCommands: commandEntries.filter((entry) => entry.available).map((entry) => entry.name),
    deferredCommands: ["go_to_location", "segment_cleaning", "zone_cleaning", "room_cleaning"],
  };
}

function publicValetudoCommandEntries(snapshot: ValetudoRuntimeSnapshot): Array<[string, RuntimeCommandAvailability | undefined]> {
  const commands = snapshot.capabilities?.commands ?? {};
  const entries = Object.entries(commands);
  if (commands.resume == null && commands.start_cleaning != null) {
    entries.push(["resume", commands.start_cleaning]);
  }
  return entries;
}

function normalizeMap(map: RuntimeMap | undefined, params: Pick<VacuumParams, "includePreview" | "includeGeometry">) {
  const targets = normalizeTargets(map?.targets, params.includeGeometry === true);
  const layers = map?.preview?.layers ?? [];
  const entities = map?.preview?.entities ?? [];

  return {
    available: map?.available === true,
    source: stringOrDefault(map?.source, "unknown"),
    detail: map?.detail,
    updatedAt: map?.updatedAt ?? null,
    metadata: {
      id: stringOrNull(map?.metadata?.id),
      width: numberOrNull(map?.metadata?.width),
      height: numberOrNull(map?.metadata?.height),
      pixelSize: numberOrNull(map?.metadata?.pixelSize),
      coordinateSystem: stringOrDefault(map?.metadata?.coordinateSystem, "unknown"),
      layerCount: numberOrDefault(map?.metadata?.layerCount, layers.length),
      entityCount: numberOrDefault(map?.metadata?.entityCount, entities.length),
      segmentCount: numberOrDefault(map?.metadata?.segmentCount, targets.segmentCount),
      zoneCount: numberOrDefault(map?.metadata?.zoneCount, targets.zoneCount),
    },
    preview: params.includePreview === true
      ? {
          layerCount: layers.length,
          entityCount: entities.length,
          layers: layers.map(normalizeLayer),
          entities: entities.map(normalizeEntity),
        }
      : {
          layerCount: layers.length,
          entityCount: entities.length,
        },
    targets,
    diagnostics: arrayOrEmpty(map?.diagnostics),
  };
}

function normalizeTargets(targets: RuntimeMap["targets"] | undefined, includeGeometry: boolean) {
  const segments = (targets?.segments ?? []).map((target) => normalizeTarget(target, includeGeometry)).filter(Boolean);
  const zones = (targets?.zones ?? []).map((target) => normalizeTarget(target, includeGeometry)).filter(Boolean);

  return {
    segmentCount: segments.length,
    zoneCount: zones.length,
    segments,
    zones,
  };
}

function normalizeTarget(target: RuntimeMapTarget, includeGeometry: boolean) {
  const id = stringOrNull(target.id);
  const label = stringOrNull(target.label);
  if (!id || !label) return null;

  return {
    id,
    label,
    kind: stringOrDefault(target.kind, "unknown"),
    available: target.available === true,
    detail: target.detail,
    ...(includeGeometry ? { geometry: normalizeGeometry(target.geometry) } : { geometrySummary: summarizeGeometry(target.geometry) }),
  };
}

function normalizeLayer(layer: RuntimeMapLayer) {
  return {
    id: stringOrDefault(layer.id, "unknown"),
    kind: stringOrDefault(layer.kind, "unknown"),
    label: layer.label,
    segmentId: layer.segmentId,
    runCount: layer.runs?.length ?? 0,
    pointCount: layer.points?.length ?? 0,
  };
}

function normalizeEntity(entity: RuntimeMapEntity) {
  return {
    id: stringOrDefault(entity.id, "unknown"),
    kind: stringOrDefault(entity.kind, "unknown"),
    label: entity.label,
    pointCount: entity.points?.length ?? 0,
    angle: entity.angle,
    detail: entity.detail,
  };
}

function normalizeGeometry(geometry: RuntimeMapTargetGeometry | undefined) {
  if (!geometry) return null;
  return {
    type: stringOrDefault(geometry.type, "unknown"),
    points: normalizePoints(geometry.points),
    bounds: normalizeBounds(geometry.bounds),
  };
}

function summarizeGeometry(geometry: RuntimeMapTargetGeometry | undefined) {
  if (!geometry) return null;
  return {
    type: stringOrDefault(geometry.type, "unknown"),
    pointCount: geometry.points?.length ?? 0,
    hasBounds: geometry.bounds != null,
  };
}

function normalizePoints(points: RuntimeMapTargetGeometry["points"] | undefined) {
  if (!Array.isArray(points)) return undefined;
  return points
    .map((point) => {
      const x = numberOrNull(point.x);
      const y = numberOrNull(point.y);
      return x == null || y == null ? null : { x, y };
    })
    .filter((point): point is { x: number; y: number } => point != null);
}

function normalizeBounds(bounds: RuntimeMapTargetGeometry["bounds"] | undefined) {
  if (!bounds) return undefined;
  const x = numberOrNull(bounds.x);
  const y = numberOrNull(bounds.y);
  const width = numberOrNull(bounds.width);
  const height = numberOrNull(bounds.height);
  if (x == null || y == null || width == null || height == null) return undefined;
  return { x, y, width, height };
}

function normalizeMission(snapshot: ValetudoRuntimeSnapshot) {
  return {
    active: snapshot.state?.started === true,
    status: normalizeActivity(snapshot).status,
    label: snapshot.state?.label ?? snapshot.state?.value ?? "Unknown",
    availableActions: availableActions(snapshot),
    activeMission: null,
    recent: [],
    note: "Valetudo main-branch runtime exposes robot activity, not runtime-owned mission snapshots.",
  };
}

function normalizeActivity(snapshot: ValetudoRuntimeSnapshot) {
  const status = normalizeActivityStatus(snapshot);

  return {
    status,
    label: snapshot.state?.label ?? snapshot.state?.value ?? "Unknown",
    availableActions: availableActions(snapshot),
    updatedAt: snapshot.updatedAt ?? null,
  };
}

function normalizeActivityStatus(snapshot: ValetudoRuntimeSnapshot): string {
  const stateValue = String(snapshot.state?.value ?? "").toLowerCase();
  if (stateValue.includes("fault") || stateValue.includes("error")) {
    return "faulted";
  }
  if (snapshot.state?.paused === true || stateValue.includes("pause")) {
    return "paused";
  }
  if (stateValue.includes("return")) {
    return "returning";
  }
  if (snapshot.dock?.docked === true) {
    return snapshot.battery?.charging === true ? "charging" : "docked";
  }
  if (snapshot.state?.started === true || stateValue.includes("clean")) {
    return "cleaning";
  }
  return "idle";
}

function availableActions(snapshot: ValetudoRuntimeSnapshot): string[] {
  return publicValetudoCommandEntries(snapshot)
    .filter(([command, availability]) => effectiveCommandAvailability(command, availability, snapshot).available)
    .map(([command]) => command);
}

function normalizeReadiness(snapshot: ValetudoRuntimeSnapshot) {
  const blockingReasons = [
    ...(snapshot.connectivity?.online === true ? [] : ["runtime_offline"]),
    ...(snapshot.connectivity?.reachable === true ? [] : ["source_unreachable"]),
    ...(snapshot.source?.stale === true ? ["stale_source"] : []),
  ];

  return {
    ready: blockingReasons.length === 0,
    blockingReasons,
  };
}

function buildCommandRequest(
  params: VacuumParams,
  snapshot: ValetudoRuntimeSnapshot,
):
  | { ok: true; request: { command: string; params?: Record<string, unknown> } }
  | { ok: false; error: { code: string; message: string } } {
  const command = params.command;
  if (!command) {
    return { ok: false, error: { code: "invalid_request", message: "command is required for action=send-command." } };
  }

  const sourceReason = sourceUnavailableReason(snapshot);
  if (sourceReason) {
    return { ok: false, error: { code: sourceReason, message: humanizeReason(sourceReason) } };
  }

  const runtimeCommand = mapRuntimeCommandName(command, snapshot);
  const availability = snapshot.capabilities?.commands?.[runtimeCommand];
  const effectiveAvailability = effectiveCommandAvailability(command, availability, snapshot);
  if (!effectiveAvailability.available) {
    return {
      ok: false,
      error: {
        code: effectiveAvailability.reason,
        message: humanizeReason(effectiveAvailability.reason),
      },
    };
  }

  if (command === "set_fan_speed" || command === "set_water_usage") {
    const value = params.value?.trim();
    if (!value) {
      return { ok: false, error: { code: "invalid_request", message: `${command} requires value.` } };
    }
    const setting = command === "set_fan_speed" ? snapshot.cleaningSettings?.fanSpeed : snapshot.cleaningSettings?.waterUsage;
    const options = settingOptions(setting);
    if (options.length > 0 && !options.includes(value)) {
      return { ok: false, error: { code: "invalid_request", message: `Selected value is not available. Options: ${options.join(", ")}` } };
    }
    return {
      ok: true,
      request: {
        command: runtimeCommand,
        params: {
          value,
        },
      },
    };
  }

  if (!isBasicRuntimeCommand(runtimeCommand)) {
    return { ok: false, error: { code: "unsupported", message: `Unsupported vacuum command: ${command}` } };
  }

  return {
    ok: true,
    request: {
      command: runtimeCommand,
    },
  };
}

function mapRuntimeCommandName(command: VacuumCommandName, snapshot: ValetudoRuntimeSnapshot): string {
  if (command === "resume") {
    return snapshot.capabilities?.commands?.resume ? "resume" : "start_cleaning";
  }
  return command;
}

function isBasicRuntimeCommand(command: string): boolean {
  return ["start_cleaning", "pause", "resume", "stop", "return_to_dock"].includes(command);
}

function effectiveCommandAvailability(
  command: string,
  availability: RuntimeCommandAvailability | undefined,
  snapshot: ValetudoRuntimeSnapshot,
): { available: true } | { available: false; reason: string } {
  if (availability?.available !== true) {
    return { available: false, reason: availability?.reason ?? "unavailable" };
  }

  const invalidState = invalidStateReason(command, snapshot);
  if (invalidState) {
    return { available: false, reason: invalidState };
  }

  return { available: true };
}

function invalidStateReason(command: string, snapshot: ValetudoRuntimeSnapshot): string | undefined {
  const status = normalizeActivityStatus(snapshot);

  switch (command) {
    case "start_cleaning":
      return ["idle", "docked", "charging"].includes(status) ? undefined : "invalid_state";
    case "pause":
      return status === "cleaning" ? undefined : "invalid_state";
    case "resume":
      return status === "paused" ? undefined : "invalid_state";
    case "stop":
      return status === "cleaning" || status === "paused" || status === "returning" ? undefined : "invalid_state";
    case "return_to_dock":
      return ["idle", "cleaning", "paused"].includes(status) ? undefined : "invalid_state";
    default:
      return undefined;
  }
}

function normalizeCommandResult(command: VacuumCommandName | undefined, result: ValetudoRuntimeCommandResult) {
  return {
    ok: result.ok === true && result.status === "success",
    command: command ?? result.command ?? null,
    status: result.status ?? "unknown",
    message: result.message ?? null,
    reason: result.reason ?? result.code ?? null,
    updatedAt: result.updatedAt ?? null,
  };
}

function normalizeCleaningSettings(settings: ValetudoRuntimeSnapshot["cleaningSettings"] | undefined) {
  return {
    fanSpeed: normalizeSetting(settings?.fanSpeed),
    waterUsage: normalizeSetting(settings?.waterUsage),
  };
}

function normalizeSetting(setting: RuntimeSetting | undefined) {
  if (!setting) return null;
  return {
    current: setting.current,
    options: settingOptions(setting).map((value) => ({ value, label: humanizeOption(value) })),
  };
}

function settingOptions(setting: RuntimeSetting | undefined): string[] {
  return (setting?.options ?? [])
    .map((option) => (typeof option === "string" ? option : option.value))
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
}

function normalizeDockState(snapshot: ValetudoRuntimeSnapshot): string {
  if (snapshot.battery?.charging === true) return "charging";
  const dockState = String(snapshot.dock?.state ?? "").toLowerCase();
  if (dockState.includes("return")) return "returning";
  if (dockState.includes("error") || dockState.includes("fault")) return "error";
  if (snapshot.dock?.docked === true) return "docked";
  if (snapshot.dock) return "undocked";
  return "unknown";
}

function sourceUnavailableReason(snapshot: ValetudoRuntimeSnapshot): string | undefined {
  if (snapshot.source?.stale === true) return "stale_source";
  if (snapshot.connectivity?.online === false || snapshot.runtime?.status === "offline") return "runtime_offline";
  if (snapshot.connectivity?.reachable === false || snapshot.source?.status === "unreachable") return "source_unreachable";
  if (snapshot.runtime?.status === "degraded") return "degraded_runtime";
  return undefined;
}

function normalizeSourceStatus(source: ValetudoRuntimeHealth["source"]): string {
  if (source?.stale === true) return "stale";
  if (source?.status === "reachable" || source?.status === "unreachable") return source.status;
  return "unknown";
}

function humanizeReason(reason: string): string {
  const reasons: Record<string, string> = {
    unavailable: "Command is currently unavailable.",
    invalid_state: "Command is not valid for the current robot state.",
    invalid_request: "Invalid command request.",
    runtime_offline: "Runtime offline.",
    source_unreachable: "Source unreachable.",
    stale_source: "Robot state is stale.",
    degraded_runtime: "Runtime degraded.",
    unsupported: "Command is not supported.",
  };
  return reasons[reason] ?? humanizeOption(reason);
}

function humanizeOption(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function textResult(value: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) ?? "" }],
  };
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function arrayOrEmpty<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
