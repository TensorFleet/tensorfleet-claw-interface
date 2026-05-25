import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { executeEntityRead, executeRosNodeRead, executeRosTopicRead, executeRosServiceRead, executeRosConnect, executeAuthTool, executeVmTool, executeDroneTool } from "tensorfleet-tools";

// Import schema definitions from tensorfleet-tools
import { entityReadSchema, rosNodeReadSchema, rosTopicReadSchema, rosServiceReadSchema, rosConnectSchema, authSchema, vmSchema, droneSchema } from "tensorfleet-tools";

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

async function runTensorFleetTool(
  executor: (id: string, params: any) => Promise<{ content: Array<{ type: string; text: string }> }>,
  toolCallId: string,
  params: any
) {
  const result = await executor(toolCallId, params);
  if (result.content.length === 1 && result.content[0]?.type === "text") {
    return result.content[0].text;
  }
  return result;
}

export default defineToolPlugin({
  id: "tensorfleet-openclaw-plugin",
  name: "tensorfleet-openclaw-plugin",
  description: "OpenClaw plugin for TensorFleet telemetry and auth tools",
  tools: (tool: any) => [
    tool({
      name: "tensorfleet-telemetry-entity-read",
      description: "Read from the parameters of a tensorfleet entity",
      parameters: entityReadSchema,
      execute: (params: any, _config: unknown, context: { toolCallId: string }) => runTensorFleetTool(withErrorHandling(executeEntityRead), context.toolCallId, params),
    }),

    tool({
      name: "tensorfleet-telemetry-ros-node-read",
      description: "Read from the parameters of an ros node",
      parameters: rosNodeReadSchema,
      execute: (params: any, _config: unknown, context: { toolCallId: string }) => runTensorFleetTool(withErrorHandling(executeRosNodeRead), context.toolCallId, params),
    }),

    tool({
      name: "tensorfleet-telemetry-ros-topic-read",
      description: "Subscribe to an ros topic and wait for a publication on the topic",
      parameters: rosTopicReadSchema,
      execute: (params: any, _config: unknown, context: { toolCallId: string }) => runTensorFleetTool(withErrorHandling(executeRosTopicRead), context.toolCallId, params),
    }),

    tool({
      name: "tensorfleet-telemetry-ros-service-read",
      description: "Send a request and receive a response",
      parameters: rosServiceReadSchema,
      execute: (params: any, _config: unknown, context: { toolCallId: string }) => runTensorFleetTool(withErrorHandling(executeRosServiceRead), context.toolCallId, params),
    }),

    tool({
      name: "tensorfleet-telemetry-ros-connect",
      description: "Connect to a ROS 2 network",
      parameters: rosConnectSchema,
      execute: (params: any, _config: unknown, context: { toolCallId: string }) => runTensorFleetTool(withErrorHandling(executeRosConnect), context.toolCallId, params),
    }),

    tool({
      name: "tensorfleet-auth",
      description: "Authenticate the user's TensorFleet account",
      parameters: authSchema,
      execute: (params: any, _config: unknown, context: { toolCallId: string }) => runTensorFleetTool(withErrorHandling(executeAuthTool), context.toolCallId, params),
    }),

    tool({
      name: "tensorfleet-vm",
      description: "Manage TensorFleet virtual machines",
      parameters: vmSchema,
      execute: (params: any, _config: unknown, context: { toolCallId: string }) => runTensorFleetTool(withErrorHandling(executeVmTool), context.toolCallId, params),
    }),

    tool({
      name: "tensorfleet-drone",
      description: "Control a MAVROS-backed drone through the TensorFleet drone controller",
      parameters: droneSchema,
      execute: (params: any, _config: unknown, context: { toolCallId: string }) => runTensorFleetTool(withErrorHandling(executeDroneTool), context.toolCallId, params),
    }),
  ],
});
