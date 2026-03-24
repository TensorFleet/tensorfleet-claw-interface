import { TensorfleetTelemetryEntityRead } from "../schema-types/tensorfleet-telemetry.entity.read.input";
import { entityReadTool } from "./entity-read";
import { ToolExecutionResult } from "../tool-api";

export async function executeEntityRead(_id: string, params: TensorfleetTelemetryEntityRead): Promise<ToolExecutionResult> {
  // Execute the tool directly with the provided _id
  return await entityReadTool(_id, params);
}
