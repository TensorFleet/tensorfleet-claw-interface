import { Type } from "@sinclair/typebox";
import { TensorfleetTelemetryRosTopicRead } from "../schema-types/tensorfleet-telemetry.ros-topic.read.input";
import { loadTensorfleetConfig } from "../config-loader";
import { setupWindowMock, validateProxyConfig } from "../window-mock";
import { logger } from "../logger";
import { ToolAPI } from "../tool-api";
import { loadSchema } from "../schema-loader";

export function registerRosTopicReadTool(api: ToolAPI) {
  api.registerTool({
    name: "tensorfleet-telemetry-ros-topic-read",
    description: "Subscribe to an ros topic and wait for a publication on the topic",
    parameters: loadSchema("tensorfleet-telemetry.ros-topic.read.input.json"),
    async execute(_id: string, params: TensorfleetTelemetryRosTopicRead) {
      // Load and validate .tensorfleet configuration
      const config = await loadTensorfleetConfig(params['config-file']);

      // Set up window mock with proxy configuration for ROS2Bridge
      setupWindowMock(config);

      // Validate that proxy configuration is properly set
      if (!validateProxyConfig()) {
        throw new Error('Proxy configuration is incomplete. Please check your .tensorfleet file contains the required proxy settings.');
      }

      // For now, just return the input back to the user
      return { 
        content: [{ 
          type: "text", 
          text: JSON.stringify(params, null, 2) || ""
        }] 
      };
    },
  });
}