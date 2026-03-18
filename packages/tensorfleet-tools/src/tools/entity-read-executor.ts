import { TensorfleetTelemetryEntityRead } from "../schema-types/tensorfleet-telemetry.entity.read.input";
import { entityReadTool } from "./entity-read";

export async function executeEntityRead(_id: string, params: TensorfleetTelemetryEntityRead) {
  // Execute the tool directly with the provided _id
  return await entityReadTool(_id, params);
}
