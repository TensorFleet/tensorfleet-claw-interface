import { executeEntityRead } from "tensorfleet-tools/src/tools/entity-read-executor";
import { executeRosNodeRead } from "tensorfleet-tools/src/tools/ros-node-read-executor";
import { executeRosTopicRead } from "tensorfleet-tools/src/tools/ros-topic-read-executor";
import { executeRosServiceRead } from "tensorfleet-tools/src/tools/ros-service-read-executor";
import { logger } from "tensorfleet-tools/src/logger";

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
    parameters: {
      type: "object",
      properties: {
        "config-file": {
          type: "string",
          description: "Path to the .tensorfleet configuration file"
        }
      },
      required: ["config-file"]
    },
    async execute(_id: string, params: any) {
      return executeEntityRead(params);
    },
  });

  api.registerTool({
    name: "tensorfleet-telemetry-ros-node-read",
    description: "Read from the parameters of an ros node",
    parameters: {
      type: "object",
      properties: {
        "config-file": {
          type: "string",
          description: "Path to the .tensorfleet configuration file"
        }
      },
      required: ["config-file"]
    },
    async execute(_id: string, params: any) {
      return executeRosNodeRead(params);
    },
  });

  api.registerTool({
    name: "tensorfleet-telemetry-ros-topic-read",
    description: "Subscribe to an ros topic and wait for a publication on the topic",
    parameters: {
      type: "object",
      properties: {
        "config-file": {
          type: "string",
          description: "Path to the .tensorfleet configuration file"
        }
      },
      required: ["config-file"]
    },
    async execute(_id: string, params: any) {
      return executeRosTopicRead(params);
    },
  });

  api.registerTool({
    name: "tensorfleet-telemetry-ros-service-read",
    description: "Send a request and receive a response",
    parameters: {
      type: "object",
      properties: {
        "config-file": {
          type: "string",
          description: "Path to the .tensorfleet configuration file"
        }
      },
      required: ["config-file"]
    },
    async execute(_id: string, params: any) {
      return executeRosServiceRead(params);
    },
  });
}
