import { TensorfleetTelemetryRosNodeRead } from "../schema-types/tensorfleet-telemetry.ros-node.read.input";
import { rosNodeReadTool } from "./ros-node-read";

export async function executeRosNodeRead(_id: string, params: TensorfleetTelemetryRosNodeRead) {
  // Execute the tool directly with the provided _id
  return await rosNodeReadTool(_id, params);
}
