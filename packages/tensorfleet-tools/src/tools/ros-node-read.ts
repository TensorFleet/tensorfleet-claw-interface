import { Type } from "@sinclair/typebox";
import { TensorfleetTelemetryRosNodeRead } from "../schema-types/tensorfleet-telemetry.ros-node.read.input";
import { withRosConnection } from "./ros-connect";

export async function rosNodeReadTool(_id: string, params: TensorfleetTelemetryRosNodeRead) {
  return await withRosConnection(_id, params, async () => {
    // For now, just return the input back to the user
    return { 
      content: [{ 
        type: "text", 
        text: JSON.stringify(params, null, 2) || ""
      }] 
    };
  });
}
