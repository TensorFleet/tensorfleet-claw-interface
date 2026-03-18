import { Type } from "@sinclair/typebox";
import { TensorfleetTelemetryRosServiceRead } from "../schema-types/tensorfleet-telemetry.ros-service.read.input";
import { rosConnectTool } from "./ros-connect";

export async function rosServiceReadTool(_id: string, params: TensorfleetTelemetryRosServiceRead) {
  // First, establish ROS connection using ros-connect tool
  await rosConnectTool(_id, params);
  
  // For now, just return the input back to the user
  return { 
    content: [{ 
      type: "text", 
      text: JSON.stringify(params, null, 2) || ""
    }] 
  };
}
