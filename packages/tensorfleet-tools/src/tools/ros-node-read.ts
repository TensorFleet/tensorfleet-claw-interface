import { Type } from "@sinclair/typebox";
import { TensorfleetTelemetryRosNodeRead } from "../schema-types/tensorfleet-telemetry.ros-node.read.input";
import { rosConnectTool } from "./ros-connect";

export function rosNodeReadTool(_id: string, params: TensorfleetTelemetryRosNodeRead) {
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