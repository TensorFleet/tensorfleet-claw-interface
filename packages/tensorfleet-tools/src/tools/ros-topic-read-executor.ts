import { TensorfleetTelemetryRosTopicRead } from "../schema-types/tensorfleet-telemetry.ros-topic.read.input";
import { rosTopicReadTool } from "./ros-topic-read";
import { ToolExecutionResult } from "../tool-api";

export async function executeRosTopicRead(_id: string, params: TensorfleetTelemetryRosTopicRead): Promise<ToolExecutionResult> {
  // Execute the tool directly with the provided _id
  return await rosTopicReadTool(_id, params);
}
