import { Type } from "@sinclair/typebox";
import { TensorfleetTelemetryEntityRead } from "../schema-types/tensorfleet-telemetry.entity.read.input";
import { rosConnect } from "./ros-connect";

export async function entityReadTool(_id: string, params: TensorfleetTelemetryEntityRead) {
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
