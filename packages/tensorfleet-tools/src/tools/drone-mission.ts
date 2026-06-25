import {
  createMissionDataHash,
  DroneController,
  DroneStateModel,
  MavrosMissionCommand,
  MavrosMissionWaypoint,
  TensorfleetLogger,
} from "tensorfleet-util";
import type { MavrosMissionWaypointInput, MavrosMsgsWaypoint } from "tensorfleet-util";
import { ros2Bridge } from "tensorfleet-ros";
import { withRosConnection } from "./ros-connect";
import type { TensorfleetDroneMission } from "../schema-types/tensorfleet.drone-mission.input";

const logger = new TensorfleetLogger("Tools");
const MISSION_ITEM_KEYS = ["goTo", "takeoff", "land", "returnToLaunch"] as const;
const COMMON_MISSION_FIELDS = ["frame", "isCurrent", "autocontinue"] as const;
const GO_TO_FIELDS = [
  "latitude",
  "longitude",
  "altitude",
  ...COMMON_MISSION_FIELDS,
  "holdSeconds",
  "acceptanceRadiusMeters",
  "passRadiusMeters",
  "yawDegrees",
] as const;
const TAKEOFF_FIELDS = [
  "latitude",
  "longitude",
  "altitude",
  ...COMMON_MISSION_FIELDS,
  "minimumPitchDegrees",
  "flags",
  "yawDegrees",
] as const;
const LAND_FIELDS = [
  "latitude",
  "longitude",
  "altitude",
  ...COMMON_MISSION_FIELDS,
  "abortAltitudeMeters",
  "precisionLandMode",
  "yawDegrees",
] as const;
const RETURN_TO_LAUNCH_FIELDS = [...COMMON_MISSION_FIELDS] as const;

export type DroneMissionAction = TensorfleetDroneMission["action"];

type HighLevelMissionWaypoint = {
  index: number;
  current: boolean;
} & (
  | Record<string, unknown>
  | {
      unknown: {
        command: number;
        frame: number;
        isCurrent: boolean;
        autocontinue: boolean;
      };
    }
);

export type DroneMissionParams = TensorfleetDroneMission & {
  token?: string;
  vmManagerUrl?: string;
  proxyUrl?: string;
  nodeId?: string;
  region?: string;
};

export async function droneMissionTool(_id: string, params: DroneMissionParams) {
  try {
    return await withRosConnection(_id, params, async () => {
      const model = new DroneStateModel();
      const controller = new DroneController(model, ros2Bridge);

      model.connect(ros2Bridge);

      try {
        const result = await runDroneMissionAction(controller, model, params);
        const responseText = JSON.stringify(
          {
            success: getActionSuccess(result),
            action: params.action,
            ...result,
            timestamp: new Date().toISOString(),
          },
          null,
          2,
        );

        return {
          content: [{ type: "text", text: responseText || "" }],
        };
      } finally {
        controller.dispose();
        model.disconnect();
      }
    });
  } catch (error) {
    logger.error(`Drone mission ${params.action} failed:`, error);
    const errorText = JSON.stringify(
      {
        success: false,
        action: params.action,
        error: error instanceof Error ? error.message : "Unknown error occurred",
        timestamp: new Date().toISOString(),
      },
      null,
      2,
    );

    return {
      content: [{ type: "text", text: errorText || "" }],
    };
  }
}

async function runDroneMissionAction(
  controller: DroneController,
  model: DroneStateModel,
  params: DroneMissionParams,
) {
  switch (params.action) {
    case "status": {
      await controller.initialize();
      const pullResult = await controller.mavrosMissionPull();
      const state = await model.getState();
      const mission = model.getCurrentState().mission ?? null;
      const missionStatus = await formatMissionStatus(mission, params);

      return {
        missionHash: missionStatus?.missionHash ?? null,
        droneStatus: summarizeDroneStatus(state),
        missionStatus: missionStatus?.missionStatus ?? null,
        pull: {
          success: pullResult?.success === true,
          receivedWaypointCount: pullResult?.wp_received ?? 0,
        },
        range: missionStatus?.range ?? null,
        waypoints: missionStatus?.waypoints ?? [],
      };
    }

    case "set-local":
    case "set-go-to":
    case "set-takeoff":
    case "set-land":
    case "set-return-to-launch": {
      const mission = getMission(params);

      await controller.initialize();
      await controller.sendMissionRequest(mission);

      return {
        waypointCount: mission.length,
        missionHash: await createMissionDataHash(mission),
        mission,
        state: await model.getState(),
      };
    }

    case "wait-for": {
      const missionMatch = await getMissionMatch(params);
      const index = getMissionIndex(params, missionMatch.missionLength);

      await controller.initialize();
      const wait = await controller.wait_for_mission_index(missionMatch.value, index);

      return {
        ...wait,
        missionHash: missionMatch.missionHash,
      };
    }

    default:
      throw new Error(`Unknown drone mission action: ${(params as { action: string }).action}`);
  }
}

async function getMissionMatch(params: DroneMissionParams): Promise<{
  value: MavrosMsgsWaypoint[] | string;
  missionHash: string;
  missionLength?: number;
}> {
  if (typeof params.missionHash === "string") {
    return {
      value: params.missionHash,
      missionHash: params.missionHash,
    };
  }

  const mission = getMission(params);
  return {
    value: mission,
    missionHash: await createMissionDataHash(mission),
    missionLength: mission.length,
  };
}

function getMission(params: DroneMissionParams): MavrosMsgsWaypoint[] {
  const mission = params.mission;
  if (!Array.isArray(mission) || mission.length === 0) {
    throw new Error(`${params.action} requires a non-empty mission array`);
  }

  return mission.map((item) => new MavrosMissionWaypoint(normalizeMissionItem(item)));
}

function getMissionIndex(params: DroneMissionParams, missionLength?: number): number {
  const index = params.index;

  if (!Number.isInteger(index)) {
    throw new Error("wait-for requires an integer index");
  }

  const missionIndex = index as number;

  if (missionIndex < 0) {
    throw new Error("wait-for index must be non-negative");
  }

  if (missionLength !== undefined && missionIndex >= missionLength) {
    throw new Error(`wait-for index must be between 0 and ${missionLength - 1}`);
  }

  return missionIndex;
}

function getActionSuccess(result: Awaited<ReturnType<typeof runDroneMissionAction>>): boolean {
  if (isSuccessResult(result)) {
    return result.success;
  }

  return true;
}

function isSuccessResult(result: unknown): result is { success: boolean } {
  return isPlainObject(result) && typeof result.success === "boolean";
}

async function formatMissionStatus(mission: DroneStateModel["state"]["mission"] | null, params: DroneMissionParams) {
  if (!mission) {
    return null;
  }

  const currentIndex = mission.current_seq ?? 0;
  const range = getWaypointDisplayRange(params, currentIndex, mission.waypoints.length);
  const waypoints = mission.waypoints
    .slice(range.start, range.end + 1)
    .map((waypoint, offset) => {
      const index = range.start + offset;
      return formatMissionWaypoint(waypoint, index, offset === 0 ? undefined : mission.waypoints[index - 1]);
    });
  const currentWaypoint = waypoints.find((waypoint) => waypoint.current) ?? null;
  const missionHash = await createMissionDataHash(mission.waypoints);

  return {
    missionHash,
    missionStatus: {
      completed: mission.completed,
      waypointCount: mission.waypoint_count,
      currentIndex,
      reachedIndex: mission.reached_seq ?? null,
      currentWaypoint,
      lastPull: {
        success: mission.last_pull_success,
        waypointCount: mission.last_pull_waypoint_count,
        at: mission.last_pull_at,
      },
    },
    range: {
      start: range.start,
      end: range.end,
      count: waypoints.length,
      before: { more: range.start },
      after: { more: mission.waypoints.length - range.end - 1 },
    },
    waypoints,
  };
}

function getWaypointDisplayRange(
  params: DroneMissionParams,
  currentIndex: number,
  waypointCount: number,
): { start: number; end: number } {
  if (waypointCount <= 0) {
    return { start: 0, end: -1 };
  }

  const radius = getOptionalNonNegativeInteger(params.waypointRadius, 3, "waypointRadius");
  const requestedStart = getOptionalNonNegativeInteger(params.waypointStart, undefined, "waypointStart");
  const requestedEnd = getOptionalNonNegativeInteger(params.waypointEnd, undefined, "waypointEnd");

  const defaultStart = currentIndex - radius;
  const defaultEnd = currentIndex + radius;
  const start = clampIndex(requestedStart ?? defaultStart, waypointCount);
  const end = clampIndex(requestedEnd ?? defaultEnd, waypointCount);

  if (start > end) {
    throw new Error("waypointStart must be less than or equal to waypointEnd");
  }

  return { start, end };
}

function getOptionalNonNegativeInteger(value: unknown, fallback: number, name: string): number;
function getOptionalNonNegativeInteger(value: unknown, fallback: undefined, name: string): number | undefined;
function getOptionalNonNegativeInteger(value: unknown, fallback: number | undefined, name: string): number | undefined {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }

  return value as number;
}

function clampIndex(index: number, waypointCount: number): number {
  return Math.min(Math.max(index, 0), waypointCount - 1);
}

function summarizeDroneStatus(state: DroneStateModel["state"]) {
  return {
    connected: state.vehicle?.connected ?? null,
    armed: state.vehicle?.armed ?? null,
    mode: state.vehicle?.mode ?? null,
    landedState: state.extended?.landed_state ?? null,
    armable: state.status?.armable ?? null,
    faults: state.status?.faults ?? null,
    batteryPercentage: state.battery?.percentage ?? null,
  };
}

function formatMissionWaypoint(
  waypoint: MavrosMsgsWaypoint,
  index: number,
  previousWaypoint?: MavrosMsgsWaypoint,
): HighLevelMissionWaypoint {
  const base = {
    index,
    current: waypoint.is_current,
  };

  switch (waypoint.command) {
    case MavrosMissionCommand.GO_TO:
      return withDefined({
        ...base,
        goTo: omitRepeatedWaypointValues({
          ...getWaypointCoordinates(waypoint),
          frame: waypoint.frame,
          isCurrent: waypoint.is_current,
          autocontinue: waypoint.autocontinue,
          holdSeconds: waypoint.param1,
          acceptanceRadiusMeters: waypoint.param2,
          passRadiusMeters: waypoint.param3,
          yawDegrees: normalizeOptionalNumber(waypoint.param4),
        }, previousWaypoint),
      });

    case MavrosMissionCommand.TAKEOFF:
      return withDefined({
        ...base,
        takeoff: omitRepeatedWaypointValues({
          ...getWaypointCoordinates(waypoint),
          frame: waypoint.frame,
          isCurrent: waypoint.is_current,
          autocontinue: waypoint.autocontinue,
          minimumPitchDegrees: waypoint.param1,
          flags: waypoint.param3,
          yawDegrees: normalizeOptionalNumber(waypoint.param4),
        }, previousWaypoint),
      });

    case MavrosMissionCommand.LAND:
      return withDefined({
        ...base,
        land: omitRepeatedWaypointValues({
          ...getWaypointCoordinates(waypoint),
          frame: waypoint.frame,
          isCurrent: waypoint.is_current,
          autocontinue: waypoint.autocontinue,
          abortAltitudeMeters: waypoint.param1,
          precisionLandMode: waypoint.param2,
          yawDegrees: normalizeOptionalNumber(waypoint.param4),
        }, previousWaypoint),
      });

    case MavrosMissionCommand.RETURN_TO_LAUNCH:
      return {
        ...base,
        returnToLaunch: omitRepeatedWaypointValues({
          frame: waypoint.frame,
          isCurrent: waypoint.is_current,
          autocontinue: waypoint.autocontinue,
        }, previousWaypoint),
      };

    default:
      return {
        ...base,
        unknown: {
          command: waypoint.command,
          frame: waypoint.frame,
          isCurrent: waypoint.is_current,
          autocontinue: waypoint.autocontinue,
        },
      };
  }
}

function omitRepeatedWaypointValues(
  value: Record<string, unknown>,
  previousWaypoint?: MavrosMsgsWaypoint,
): Record<string, unknown> {
  if (!previousWaypoint) {
    return withDefined(value);
  }

  const previousValue: Record<string, unknown> = withDefined({
    latitude: previousWaypoint.x_lat,
    longitude: previousWaypoint.y_long,
    altitude: previousWaypoint.z_alt,
    frame: previousWaypoint.frame,
    isCurrent: previousWaypoint.is_current,
    autocontinue: previousWaypoint.autocontinue,
    holdSeconds: previousWaypoint.param1,
    acceptanceRadiusMeters: previousWaypoint.param2,
    passRadiusMeters: previousWaypoint.param3,
    minimumPitchDegrees: previousWaypoint.param1,
    flags: previousWaypoint.param3,
    abortAltitudeMeters: previousWaypoint.param1,
    precisionLandMode: previousWaypoint.param2,
    yawDegrees: normalizeOptionalNumber(previousWaypoint.param4),
  });

  return Object.fromEntries(
    Object.entries(withDefined(value)).filter(([key, fieldValue]) => previousValue[key] !== fieldValue),
  );
}

function getWaypointCoordinates(waypoint: MavrosMsgsWaypoint) {
  return {
    latitude: waypoint.x_lat,
    longitude: waypoint.y_long,
    altitude: waypoint.z_alt,
  };
}

function normalizeOptionalNumber(value: number): number | undefined {
  return Number.isFinite(value) ? value : undefined;
}

function withDefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined),
  ) as T;
}

function normalizeMissionItem(item: NonNullable<DroneMissionParams["mission"]>[number]): MavrosMissionWaypointInput {
  if (!isPlainObject(item)) {
    throw new Error("Each mission item must be an object");
  }

  const itemRecord = item as Record<string, unknown>;
  const providedKeys = MISSION_ITEM_KEYS.filter((key) => itemRecord[key] != null);

  if (providedKeys.length !== 1) {
    throw new Error("Each mission item must provide exactly one of goTo, takeoff, land, or returnToLaunch");
  }

  assertOnlyFields(itemRecord, MISSION_ITEM_KEYS, "mission item");

  if (item.goTo != null) {
    assertMissionPayload("goTo", item.goTo, GO_TO_FIELDS, ["latitude", "longitude", "altitude"]);
    return { command: MavrosMissionCommand.GO_TO, ...item.goTo };
  }

  if (item.takeoff != null) {
    assertMissionPayload("takeoff", item.takeoff, TAKEOFF_FIELDS, ["latitude", "longitude", "altitude"]);
    return { command: MavrosMissionCommand.TAKEOFF, ...item.takeoff };
  }

  if (item.land != null) {
    assertMissionPayload("land", item.land, LAND_FIELDS, ["latitude", "longitude"]);
    return { command: MavrosMissionCommand.LAND, ...item.land };
  }

  assertMissionPayload("returnToLaunch", item.returnToLaunch ?? {}, RETURN_TO_LAUNCH_FIELDS, []);
  return { command: MavrosMissionCommand.RETURN_TO_LAUNCH, ...(item.returnToLaunch ?? {}) };
}

function assertMissionPayload(
  name: string,
  value: unknown,
  allowedFields: readonly string[],
  requiredFields: readonly string[],
): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new Error(`${name} mission item must be an object`);
  }

  assertOnlyFields(value, allowedFields, name);

  for (const field of requiredFields) {
    if (value[field] == null) {
      throw new Error(`${name}.${field} is required`);
    }
  }

  for (const field of Object.keys(value)) {
    const fieldValue = value[field];
    if (fieldValue == null) {
      throw new Error(`${name}.${field} must be omitted instead of null`);
    }

    if (field === "isCurrent" || field === "autocontinue") {
      if (typeof fieldValue !== "boolean") {
        throw new Error(`${name}.${field} must be a boolean`);
      }
      continue;
    }

    if (typeof fieldValue !== "number" || !Number.isFinite(fieldValue)) {
      throw new Error(`${name}.${field} must be a finite number`);
    }
  }
}

function assertOnlyFields(value: Record<string, unknown>, allowedFields: readonly string[], context: string): void {
  const allowed = new Set(allowedFields);
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      throw new Error(`${context} does not support field: ${field}`);
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}
