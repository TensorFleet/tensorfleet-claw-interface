import { TensorfleetTelemetryRosConnect } from "../schema-types/tensorfleet-telemetry.ros-connect.input";
import { rosConnectTool } from "./ros-connect";

export async function executeRosConnect(_id: string, params: TensorfleetTelemetryRosConnect) {
  // Execute the tool directly with the provided _id
  return await rosConnectTool(_id, params);
}