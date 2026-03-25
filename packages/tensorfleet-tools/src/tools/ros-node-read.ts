import { Type } from "@sinclair/typebox";
import { TensorfleetTelemetryRosNodeRead } from "../schema-types/tensorfleet-telemetry.ros-node.read.input";
import { rosConnect } from "./ros-connect";

export async function rosNodeReadTool(_id: string, params: TensorfleetTelemetryRosNodeRead) {
  // First, establish ROS connection using ros-connect tool
  const releaseLock = await rosConnect(_id, params);
  
  try {
    // For now, just return the input back to the user
    return { 
      content: [{ 
        type: "text", 
        text: JSON.stringify(params, null, 2) || ""
      }] 
    };
  } finally {
    // Release the lock when we're done
    releaseLock();
  }
}
