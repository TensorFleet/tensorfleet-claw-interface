import { executeEntityRead, executeRosNodeRead, executeRosTopicRead, executeRosServiceRead, logger } from "tensorfleet-tools";

// Import schema definitions from tensorfleet-tools
import { entityReadSchema, rosNodeReadSchema, rosTopicReadSchema, rosServiceReadSchema } from "tensorfleet-tools";

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
    async execute(_id: string, params: any) {
      return executeEntityRead(params);
    },
  });

  api.registerTool({
    name: "tensorfleet-telemetry-ros-node-read",
    description: "Read from the parameters of an ros node",
    parameters: rosNodeReadSchema,
    async execute(_id: string, params: any) {
      return executeRosNodeRead(params);
    },
  });

  api.registerTool({
    name: "tensorfleet-telemetry-ros-topic-read",
    description: "Subscribe to an ros topic and wait for a publication on the topic",
    parameters: rosTopicReadSchema,
    async execute(_id: string, params: any) {
      return executeRosTopicRead(params);
    },
  });

  api.registerTool({
    name: "tensorfleet-telemetry-ros-service-read",
    description: "Send a request and receive a response",
    parameters: rosServiceReadSchema,
    async execute(_id: string, params: any) {
      return executeRosServiceRead(params);
    },
  });
}
