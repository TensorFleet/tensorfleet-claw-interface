import { Type } from "@sinclair/typebox";
import { TensorfleetTelemetryEntityRead } from "../schema-types/tensorfleet-telemetry.entity.read.input";
import { rosConnectTool } from "./ros-connect";

export async function entityReadTool(_id: string, params: TensorfleetTelemetryEntityRead) {
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