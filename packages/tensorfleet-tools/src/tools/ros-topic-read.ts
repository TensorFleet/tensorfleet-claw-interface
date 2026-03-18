import { Type } from "@sinclair/typebox";
import { TensorfleetTelemetryRosTopicRead } from "../schema-types/tensorfleet-telemetry.ros-topic.read.input";
import { rosConnectTool } from "./ros-connect";

export function rosTopicReadTool(_id: string, params: TensorfleetTelemetryRosTopicRead) {
  // First, establish ROS connection using ros-connect tool
  rosConnectTool(_id, params);
  
  // For now, just return the input back to the user
  return { 
    content: [{ 
      type: "text", 
      text: JSON.stringify(params, null, 2) || ""
    }] 
  };
}