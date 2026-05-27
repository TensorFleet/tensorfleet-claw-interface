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

    case "set-autopilot-state": {
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
  return action === "set-autopilot-state";
}

function buildTargetAutoState(params: DroneParams): TargetAutoState {
  if (params.action !== "set-autopilot-state") {
    throw new Error(`Action does not set autopilot state: ${params.action}`);
  }

  assertNoUnsupportedAutoStateFields(params);

  const requestedStates = [
    params.landed == null ? null : "landed",
    params.airborne == null ? null : "airborne",
  ].filter(Boolean);

  if (requestedStates.length !== 1) {
    throw new Error("set-autopilot-state requires exactly one of landed or airborne");
  }

  let autoState: unknown = null;

  if (params.landed != null) {
    autoState = { kind: "landed", armed: params.landed.armed ?? null };
  } else if (params.airborne != null) {
    const { altMeters, yawRad } = params.airborne;
    autoState = {
      kind: "airborne",
      altMeters,
      ...(yawRad === undefined ? {} : { yawRad }),
    };
  }

  return assertTargetAutoState(autoState);
}

function assertNoUnsupportedAutoStateFields(params: DroneParams): void {
  const unsupportedTopLevelFields = ["mode", "flightMode", "kind", "target", "altMeters"] as const;
  const unsupportedNestedFields = ["mode", "flightMode", "kind", "target", "vx", "vy", "vz", "yawRate"] as const;
  const input = params as unknown as Record<string, unknown>;

  for (const field of unsupportedTopLevelFields) {
    if (input[field] !== undefined) {
      throw new Error(`set-autopilot-state does not accept ${field}; use landed or airborne`);
    }
  }

  const airborne = params.airborne as Record<string, unknown> | undefined;
  if (airborne == null) return;

  for (const field of unsupportedNestedFields) {
    if (airborne[field] !== undefined) {
      throw new Error(`airborne does not accept ${field}; only altMeters and yawRad are supported`);
    }
  }
}
