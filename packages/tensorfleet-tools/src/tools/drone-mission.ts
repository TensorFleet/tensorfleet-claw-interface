import {
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
            success: true,
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

      return {
        pullResult,
        mission: model.getCurrentState().mission ?? null,
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
        mission,
        state: await model.getState(),
      };
    }

    default:
      throw new Error(`Unknown drone mission action: ${(params as { action: string }).action}`);
  }
}

function getMission(params: DroneMissionParams): MavrosMsgsWaypoint[] {
  const mission = params.mission;
  if (!Array.isArray(mission) || mission.length === 0) {
    throw new Error(`${params.action} requires a non-empty mission array`);
  }

  return mission.map((item) => new MavrosMissionWaypoint(normalizeMissionItem(item)));
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
