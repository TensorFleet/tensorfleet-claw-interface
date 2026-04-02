import { executeEntityRead, executeRosNodeRead, executeRosTopicRead, executeRosServiceRead, executeRosConnect } from "tensorfleet-tools";

// Import schema definitions from tensorfleet-tools
import { entityReadSchema, rosNodeReadSchema, rosTopicReadSchema, rosServiceReadSchema, rosConnectSchema } from "tensorfleet-tools";

// Helper function to wrap executor with try-catch and return JSON error on failure
function withErrorHandling<T extends any[]>(
  executor: (...args: T) => Promise<{ content: Array<{ type: string; text: string }> }>
) {
  return async (...args: T) => {
    try {
      // throw "dummy error"
      return await executor(...args);
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: true,
            message: error instanceof Error ? error.message : String(error)
          })
        }]
      };
    }
  };
}

interface ToolAPI {
  registerTool(tool: {
    name: string;
    description: string;
    parameters: any;
    execute(id: string, params: any): Promise<{ content: Array<{ type: string; text: string }> }>;
  }): void;
}

export default function (api: ToolAPI) {
  api.registerTool({
    name: "tensorfleet-telemetry-entity-read",
    description: "Read from the parameters of a tensorfleet entity",
    parameters: entityReadSchema,
    execute: withErrorHandling(executeEntityRead),
  });

  api.registerTool({
    name: "tensorfleet-telemetry-ros-node-read",
    description: "Read from the parameters of an ros node",
    parameters: rosNodeReadSchema,
    execute: withErrorHandling(executeRosNodeRead),
  });

  api.registerTool({
    name: "tensorfleet-telemetry-ros-topic-read",
    description: "Subscribe to an ros topic and wait for a publication on the topic",
    parameters: rosTopicReadSchema,
    execute: withErrorHandling(executeRosTopicRead),
  });

  api.registerTool({
    name: "tensorfleet-telemetry-ros-service-read",
    description: "Send a request and receive a response",
    parameters: rosServiceReadSchema,
    execute: withErrorHandling(executeRosServiceRead),
  });

  api.registerTool({
    name: "tensorfleet-telemetry-ros-connect",
    description: "Connect to a ROS 2 network",
    parameters: rosConnectSchema,
    execute: withErrorHandling(executeRosConnect),
  });
}
