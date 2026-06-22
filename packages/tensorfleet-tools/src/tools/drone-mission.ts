import {
  DroneController,
  DroneStateModel,
  MavrosMissionCommand,
  MavrosMissionWaypoint,
  TensorfleetLogger,
} from "tensorfleet-util";
import type { MavrosMissionWaypointInput } from "tensorfleet-util";
import { ros2Bridge } from "tensorfleet-ros";
import { withRosConnection } from "./ros-connect";
import type { TensorfleetDroneMission } from "../schema-types/tensorfleet.drone-mission.input";

const logger = new TensorfleetLogger("Tools");

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
      const mission = buildMissionWaypoints(params);

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

function buildMissionWaypoints(params: DroneMissionParams) {
  const inputs = parseMissionInputs(params);
  return inputs.map((input) => new MavrosMissionWaypoint(input));
}

function parseMissionInputs(params: DroneMissionParams): MavrosMissionWaypointInput[] {
  if (params.action === "set-return-to-launch" && isBlank(params.points)) {
    return [{ command: MavrosMissionCommand.RETURN_TO_LAUNCH }];
  }

  const points = params.points;
  if (points == null || points.trim() === "") {
    throw new Error(`${params.action} requires --points`);
  }

  return points
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((item) => parseMissionItem(params.action, item));
}

function parseMissionItem(action: DroneMissionAction, item: string): MavrosMissionWaypointInput {
  const normalized = item.toLowerCase();

  switch (normalized) {
    case "return-to-launch":
    case "rtl":
      return { command: MavrosMissionCommand.RETURN_TO_LAUNCH };
  }

  const prefixed = parsePrefixedMissionItem(normalized, item);
  const pointText = prefixed?.pointText ?? item;
  const [x, y, z] = parseCoordinateTriple(pointText);
  const command = prefixed?.command ?? actionToCoordinateCommand(action);

  switch (command) {
    case MavrosMissionCommand.GO_TO:
      return { command, latitude: x, longitude: y, altitude: z };
    case MavrosMissionCommand.TAKEOFF:
      return { command, latitude: x, longitude: y, altitude: z };
    case MavrosMissionCommand.LAND:
      return { command, latitude: x, longitude: y, altitude: z };
    default:
      throw new Error(`Action ${action} does not accept coordinate item: ${item}`);
  }
}

function parsePrefixedMissionItem(
  normalized: string,
  original: string,
): { command: MavrosMissionCommand; pointText: string } | undefined {
  const separatorIndex = normalized.indexOf(":");
  if (separatorIndex < 0) return undefined;

  const prefix = normalized.slice(0, separatorIndex).trim();
  const pointText = original.slice(separatorIndex + 1).trim();

  switch (prefix) {
    case "go-to":
    case "goto":
    case "local":
      return { command: MavrosMissionCommand.GO_TO, pointText };
    case "takeoff":
      return { command: MavrosMissionCommand.TAKEOFF, pointText };
    case "land":
      return { command: MavrosMissionCommand.LAND, pointText };
    default:
      throw new Error(`Unsupported mission item type: ${prefix}`);
  }
}

function actionToCoordinateCommand(action: DroneMissionAction): MavrosMissionCommand {
  switch (action) {
    case "set-local":
    case "set-go-to":
      return MavrosMissionCommand.GO_TO;
    case "set-takeoff":
      return MavrosMissionCommand.TAKEOFF;
    case "set-land":
      return MavrosMissionCommand.LAND;
    default:
      return MavrosMissionCommand.RETURN_TO_LAUNCH;
  }
}

function parseCoordinateTriple(value: string): [number, number, number] {
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error(`Invalid mission point "${value}". Use x,y,z or a supported named item.`);
  }

  return [parts[0]!, parts[1]!, parts[2]!];
}

function isBlank(value: string | undefined): boolean {
  return value == null || value.trim() === "";
}
