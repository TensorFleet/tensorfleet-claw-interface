import { Type } from "@sinclair/typebox";
import { TensorfleetTelemetryRosTopicRead } from "../schema-types/tensorfleet-telemetry.ros-topic.read.input";
import { rosConnect } from "./ros-connect";

export async function rosTopicReadTool(_id: string, params: TensorfleetTelemetryRosTopicRead) {
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
