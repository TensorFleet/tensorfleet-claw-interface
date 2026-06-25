import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { executeEntityRead, executeRosNodeRead, executeRosTopicRead, executeRosServiceRead, executeRosConnect, executeRosDiagnostics, executeAuthTool, executeVmTool, executeDroneTool, executeVacuumTool } from "tensorfleet-tools";

// Import schema definitions from tensorfleet-tools
import { entityReadSchema, rosNodeReadSchema, rosTopicReadSchema, rosServiceReadSchema, rosConnectSchema, rosDiagnosticsSchema, authSchema, vmSchema, droneSchema, vacuumSchema } from "tensorfleet-tools";

// Helper function to wrap executor with try-catch and return JSON error on failure
function withErrorHandling<T extends any[]>(
  executor: (...args: T) => Promise<{ content: Array<{ type: string; text: string }> }>
) {
  return async (...args: T) => {
    try {
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

type TensorFleetExecutor = (id: string, params: any) => Promise<{ content: Array<{ type: string; text: string }> }>;

type TensorFleetToolDefinition = {
  name: string;
  label: string;
  description: string;
  parameters: any;
  executor: TensorFleetExecutor;
};

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

const TENSORFLEET_TOOLS: TensorFleetToolDefinition[] = [
  {
    name: "tensorfleet-telemetry-entity-read",
    label: "TensorFleet Entity Read",
    description: "Read from the parameters of a tensorfleet entity",
    parameters: entityReadSchema,
    executor: withErrorHandling(executeEntityRead),
  },
  {
    name: "tensorfleet-telemetry-ros-node-read",
    label: "TensorFleet ROS Node Read",
    description: "Read from the parameters of an ros node",
    parameters: rosNodeReadSchema,
    executor: withErrorHandling(executeRosNodeRead),
  },
  {
    name: "tensorfleet-telemetry-ros-topic-read",
    label: "TensorFleet ROS Topic Read",
    description: "Subscribe to an ros topic and wait for a publication on the topic",
    parameters: rosTopicReadSchema,
    executor: withErrorHandling(executeRosTopicRead),
  },
  {
    name: "tensorfleet-telemetry-ros-service-read",
    label: "TensorFleet ROS Service Read",
    description: "Send a request and receive a response",
    parameters: rosServiceReadSchema,
    executor: withErrorHandling(executeRosServiceRead),
  },
  {
    name: "tensorfleet-telemetry-ros-connect",
    label: "TensorFleet ROS Connect",
    description: "Connect to a ROS 2 network",
    parameters: rosConnectSchema,
    executor: withErrorHandling(executeRosConnect),
  },
  {
    name: "tensorfleet-ros-diagnostics",
    label: "TensorFleet ROS Diagnostics",
    description: "Inspect ROS connection internals, mutex state, timer state, and bridge connectivity diagnostics",
    parameters: rosDiagnosticsSchema,
    executor: withErrorHandling(executeRosDiagnostics),
  },
  {
    name: "tensorfleet-auth",
    label: "TensorFleet Auth",
    description: "Authenticate the user's TensorFleet account",
    parameters: authSchema,
    executor: withErrorHandling(executeAuthTool),
  },
  {
    name: "tensorfleet-vm",
    label: "TensorFleet VM",
    description: "Manage TensorFleet virtual machines",
    parameters: vmSchema,
    executor: withErrorHandling(executeVmTool),
  },
  {
    name: "tensorfleet-drone",
    label: "TensorFleet Drone",
    description: "Control a MAVROS-backed drone through the TensorFleet drone controller",
    parameters: droneSchema,
    executor: withErrorHandling(executeDroneTool),
  },
  {
    name: "tensorfleet-vacuum",
    label: "TensorFleet Vacuum",
    description: "Discover and read product-level TensorFleet vacuum capabilities/state through an explicitly selected simulation or real-vacuum backend",
    parameters: vacuumSchema,
    executor: withErrorHandling(executeVacuumTool),
  },
];

export const tensorfleetToolNames = TENSORFLEET_TOOLS.map((tool) => tool.name);

function registerTensorFleetTool(api: any, definition: TensorFleetToolDefinition): void {
  api.registerTool({
    name: definition.name,
    label: definition.label,
    description: definition.description,
    parameters: definition.parameters,
    execute: (toolCallId: string, params: any) => runTensorFleetTool(definition.executor, toolCallId, params),
  });
}

export default definePluginEntry({
  id: "tensorfleet-openclaw-plugin",
  name: "tensorfleet-openclaw-plugin",
  description: "OpenClaw plugin for TensorFleet telemetry, auth, and product-level vacuum discovery tools",
  register(api) {
    for (const definition of TENSORFLEET_TOOLS) {
      registerTensorFleetTool(api, definition);
    }
  },
});
