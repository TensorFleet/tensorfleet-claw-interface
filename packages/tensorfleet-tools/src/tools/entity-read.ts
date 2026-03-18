import { Type } from "@sinclair/typebox";
import { TensorfleetTelemetryEntityRead } from "../schema-types/tensorfleet-telemetry.entity.read.input";
import { loadTensorfleetConfig } from "../config-loader";
import { setupWindowMock, validateProxyConfig } from "../window-mock";
import { logger } from "../logger";
import { ToolAPI } from "../tool-api";
import { loadSchema } from "../schema-loader";

export function registerEntityReadTool(api: ToolAPI) {
  api.registerTool({
    name: "tensorfleet-telemetry-entity-read",
    description: "Read from the parameters of a tensorfleet entity",
    parameters: loadSchema("tensorfleet-telemetry.entity.read.input.json"),
    async execute(_id: string, params: TensorfleetTelemetryEntityRead) {
      // Load and validate .tensorfleet configuration
      const config = await loadTensorfleetConfig(params['tensorfleet-project-path']);

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