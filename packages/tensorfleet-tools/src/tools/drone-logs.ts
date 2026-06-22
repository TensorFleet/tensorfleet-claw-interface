import { DroneController, DroneStateModel, TensorfleetLogger } from "tensorfleet-util";
import { ros2Bridge } from "tensorfleet-ros";
import { getConfig } from "tensorfleet-auth";
import { withRosConnection } from "./ros-connect";
import type { TensorfleetDroneLogs } from "../schema-types/tensorfleet.drone-logs.input";

const logger = new TensorfleetLogger("Tools");

export type DroneLogsParams = TensorfleetDroneLogs & {
  token?: string;
  vmManagerUrl?: string;
  proxyUrl?: string;
  nodeId?: string;
};

export async function droneLogsTool(_id: string, params: DroneLogsParams) {
  try {
    return await withRosConnection(_id, params, async () => {
      const model = new DroneStateModel();
      const controller = new DroneController(model, ros2Bridge, {
        internalLogDestinationKey: getDroneLogDestinationKey(params),
      });

      model.connect(ros2Bridge);

      try {
        const responseText = JSON.stringify(
          {
            success: true,
            log: controller.getInternalLog({
              type: params.type,
              count: params.count,
            }),
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
    logger.error("Drone logs read failed:", error);
    const errorText = JSON.stringify(
      {
        success: false,
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

function getDroneLogDestinationKey(params: DroneLogsParams): string {
  return params.nodeId ?? getConfig("TENSORFLEET_NODE_ID") ?? "__unknown__";
}
