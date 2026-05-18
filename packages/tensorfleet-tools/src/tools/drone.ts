import { assertTargetAutoState, DroneController, DroneStateModel, TensorfleetLogger } from "tensorfleet-util";
import type { TargetAutoState } from "tensorfleet-util";
import { ros2Bridge } from "tensorfleet-ros";
import { withRosConnection } from "./ros-connect";
import { setConfig } from "tensorfleet-auth";
import type { TensorfleetDrone } from "../schema-types/tensorfleet.drone.input";

const logger = new TensorfleetLogger("Tools");

export type DroneAction = TensorfleetDrone["action"];

export type DroneParams = TensorfleetDrone & {
  token?: string;
  vmManagerUrl?: string;
  proxyUrl?: string;
  nodeId?: string;
  region?: string;
};

export async function droneTool(_id: string, params: DroneParams) {
  try {
    hydrateDroneConfig(params);

    return await withRosConnection(_id, params, async () => {
      const model = new DroneStateModel();
      const controller = new DroneController(model, ros2Bridge, {
        autoStateManagement: isSetAutoStateAction(params.action),
      });

      model.connect(ros2Bridge);

      try {
        const result = await runDroneAction(controller, model, params);
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
    logger.error(`Drone ${params.action} failed:`, error);
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

function hydrateDroneConfig(params: DroneParams): void {
  if (params.token != null) setConfig("TENSORFLEET_JWT", params.token);
  if (params.vmManagerUrl != null) setConfig("TENSORFLEET_VM_MANAGER_URL", params.vmManagerUrl);
  if (params.proxyUrl != null) setConfig("TENSORFLEET_PROXY_URL", params.proxyUrl);
  if (params.nodeId != null) setConfig("TENSORFLEET_NODE_ID", params.nodeId);
  if (params.region != null) setConfig("TENSORFLEET_REGION", params.region);
}

async function runDroneAction(controller: DroneController, model: DroneStateModel, params: DroneParams) {
  switch (params.action) {
    case "get-state":
      return { state: await model.getState() };

    case "set-auto-state-landed":
    case "set-auto-state-airborne":
    case "set-auto-state-offboard-position-local":
    case "set-auto-state-offboard-velocity-local":
    case "set-auto-state-offboard-raw-local":
    case "set-auto-state-offboard-raw-attitude": {
      const autoState = buildTargetAutoState(params);

      await controller.initialize();
      await controller.requestAutoState(autoState);

      return {
        autoState,
        reached: controller.isInRequestedAutoState(),
      };
    }

    default:
      throw new Error(`Unknown drone action: ${(params as { action: string }).action}`);
  }
}

function isSetAutoStateAction(action: DroneAction): boolean {
  return action.startsWith("set-auto-state-");
}

function buildTargetAutoState(params: DroneParams): TargetAutoState {
  let autoState: unknown;

  switch (params.action) {
    case "set-auto-state-landed": {
      if (params.landed == null) {
        throw new Error("Missing landed payload for set-auto-state-landed");
      }

      autoState = { kind: "landed", armed: params.landed.armed };
      break;
    }

    case "set-auto-state-airborne": {
      if (params.airborne == null) {
        throw new Error("Missing airborne payload for set-auto-state-airborne");
      }

      autoState = {
        kind: "airborne",
        altMeters: params.airborne.altMeters,
        ...(params.airborne.yawRad === undefined ? {} : { yawRad: params.airborne.yawRad }),
      };
      break;
    }

    case "set-auto-state-offboard-position-local": {
      if (params.offboardPositionLocal == null) {
        throw new Error("Missing offboardPositionLocal payload for set-auto-state-offboard-position-local");
      }

      autoState = {
        kind: "offboard",
        target: {
          kind: "position_local",
          ...params.offboardPositionLocal,
        },
      };
      break;
    }

    case "set-auto-state-offboard-velocity-local": {
      if (params.offboardVelocityLocal == null) {
        throw new Error("Missing offboardVelocityLocal payload for set-auto-state-offboard-velocity-local");
      }

      autoState = {
        kind: "offboard",
        target: {
          kind: "velocity_local",
          ...params.offboardVelocityLocal,
        },
      };
      break;
    }

    case "set-auto-state-offboard-raw-local": {
      if (params.offboardRawLocal == null) {
        throw new Error("Missing offboardRawLocal payload for set-auto-state-offboard-raw-local");
      }

      autoState = {
        kind: "offboard",
        target: {
          kind: "raw_local",
          ...params.offboardRawLocal,
        },
      };
      break;
    }

    case "set-auto-state-offboard-raw-attitude": {
      if (params.offboardRawAttitude == null) {
        throw new Error("Missing offboardRawAttitude payload for set-auto-state-offboard-raw-attitude");
      }

      autoState = {
        kind: "offboard",
        target: {
          kind: "raw_attitude",
          ...params.offboardRawAttitude,
        },
      };
      break;
    }

    default:
      throw new Error(`Action does not set auto state: ${params.action}`);
  }

  return assertTargetAutoState(autoState);
}
