import { DroneController, DroneStateModel, TensorfleetLogger } from "tensorfleet-util";
import type { TargetAutoState } from "tensorfleet-util";
import { ros2Bridge } from "tensorfleet-ros";
import { withRosConnection } from "./ros-connect";
import { setConfig } from "tensorfleet-auth";

const logger = new TensorfleetLogger("Tools");

export type DroneAction =
  | "get-state"
  | "set-auto-state";

export interface DroneParams {
  action: DroneAction;
  "tensorfleet-project-path"?: string;
  token?: string;
  vmManagerUrl?: string;
  proxyUrl?: string;
  nodeId?: string;
  region?: string;
  autoState?: TargetAutoState;
}

export async function droneTool(_id: string, params: DroneParams) {
  try {
    hydrateDroneConfig(params);

    return await withRosConnection(_id, params, async () => {
      const model = new DroneStateModel();
      const controller = new DroneController(model, ros2Bridge, {
        autoStateManagement: params.action === "set-auto-state",
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

    case "set-auto-state": {
      await controller.initialize();
      await controller.requestAutoState(params.autoState ?? null);

      return {
        autoState: params.autoState ?? null,
        reached: controller.isInRequestedAutoState(),
      };
    }

    default:
      throw new Error(`Unknown drone action: ${(params as { action: string }).action}`);
  }
}
