import { Type } from "@sinclair/typebox";
import { TensorfleetTelemetryRosServiceRead } from "../schema-types/tensorfleet-telemetry.ros-service.read.input";
import { loadTensorfleetConfig } from "../config-loader";
import { setupWindowMock, validateProxyConfig } from "../window-mock";
import { logger } from "../logger";
import { ToolAPI } from "../tool-api";
import { loadSchema } from "../schema-loader";

export function registerRosServiceReadTool(api: ToolAPI) {
  api.registerTool({
    name: "tensorfleet-telemetry-ros-service-read",
    description: "Send a request and receive a response",
    parameters: loadSchema("tensorfleet-telemetry.ros-service.read.input.json"),
    async execute(_id: string, params: TensorfleetTelemetryRosServiceRead) {
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