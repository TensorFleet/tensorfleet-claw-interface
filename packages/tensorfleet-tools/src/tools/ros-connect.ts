import { Type } from "@sinclair/typebox";
import { loadTensorfleetConfig } from "../config-loader";
import { setupWindowMock, validateProxyConfig } from "../window-mock";
import { logger } from "../logger";
import { ToolAPI } from "../tool-api";
import { loadSchema } from "../schema-loader";
import { ROS2Bridge } from "tensorfleet-ros";

export function registerRosConnectTool(api: ToolAPI) {
  api.registerTool({
    name: "tensorfleet-telemetry-ros-connect",
    description: "Establish a connection to ROS2 via Foxglove Bridge using the provided configuration",
    parameters: loadSchema("tensorfleet-telemetry.ros-connect.input.json"),
    async execute(_id: string, params: any) {
      try {
        logger.info('Starting ROS connection process...');
        
        // Load and validate .tensorfleet configuration
        const config = await loadTensorfleetConfig(params['config-file']);
        logger.info('Configuration loaded successfully');

        // Set up window mock with proxy configuration for ROS2Bridge
        setupWindowMock(config);
        logger.info('Window mock setup complete');

        // Validate that proxy configuration is properly set
        if (!validateProxyConfig()) {
          throw new Error('Proxy configuration is incomplete. Please check your .tensorfleet file contains the required proxy settings.');
        }
        logger.info('Proxy configuration validated');

        // Import and initialize ROS2Bridge
        const { ros2Bridge } = await import("tensorfleet-ros");
        
        // Wait for connection to be established
        logger.info('Waiting for ROS connection to be established...');
        
        const connectionTimeout = 30000; // 30 seconds timeout
        const startTime = Date.now();
        
        return new Promise((resolve, reject) => {
          const checkConnection = () => {
            const elapsed = Date.now() - startTime;
            
            if (elapsed > connectionTimeout) {
              reject(new Error(`Connection timeout after ${connectionTimeout}ms. ROS2Bridge failed to connect.`));
              return;
            }
            
            if (ros2Bridge.isConnected()) {
              logger.info('ROS connection established successfully');
              resolve({
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    success: true,
                    message: "ROS connection established successfully",
                    timestamp: new Date().toISOString(),
                    connectionDetails: {
                      nodeId: (global.window as any)?.TENSORFLEET_NODE_ID || null,
                      proxyUrl: (global.window as any)?.TENSORFLEET_PROXY_URL || null,
                      vmManagerUrl: (global.window as any)?.TENSORFLEET_VM_MANAGER_URL || null
                    }
                  }, null, 2)
                }]
              });
            } else {
              // Continue polling
              setTimeout(checkConnection, 500);
            }
          };
          
          // Start checking connection status
          checkConnection();
        });
        
      } catch (error) {
        logger.error('ROS connection failed:', error);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error occurred',
              timestamp: new Date().toISOString()
            }, null, 2)
          }]
        };
      }
    },
  });
}
