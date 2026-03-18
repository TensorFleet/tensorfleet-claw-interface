import { TensorfleetTelemetryRosServiceRead } from "../schema-types/tensorfleet-telemetry.ros-service.read.input";
import { rosServiceReadTool } from "./ros-service-read";

export async function executeRosServiceRead(_id: string, params: TensorfleetTelemetryRosServiceRead) {
  // Execute the tool directly with the provided _id
  return await rosServiceReadTool(_id, params);
}
