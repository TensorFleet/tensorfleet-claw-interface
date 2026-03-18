import { TensorfleetTelemetryRosConnect } from "../schema-types/tensorfleet-telemetry.ros-connect.input";
import { loadTensorfleetConfig } from "../config-loader";
import { setupWindowMockForROS2Bridge, validateProxyConfig } from "../window-mock";
import { logger } from "../logger";

export async function executeRosConnect(params: TensorfleetTelemetryRosConnect) {
  try {
    // Load and validate .tensorfleet configuration
    const config = await loadTensorfleetConfig(params['tensorfleet-project-path']);

    // Set up window mock with proxy configuration for ROS2Bridge
    // The config loader now returns either:
    // 1. A full configuration object with env field (new format)
    // 2. A VM configuration object (legacy format)
    setupWindowMockForROS2Bridge(config);

    // Validate that proxy configuration is properly set
    if (!validateProxyConfig()) {
      throw new Error('Proxy configuration is incomplete. Please check your .tensorfleet file contains the required proxy settings.');
    }

    // For now, just return the input back to the user
    return { 
      content: [{ 
        type: "text", 
        text: JSON.stringify(params, null, 2)
      }] 
    };
  } catch (error) {
    // Re-throw the error to propagate it to the CLI
    throw error;
  }
}
