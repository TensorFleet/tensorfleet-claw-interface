import { registerEntityReadTool } from "./tools/entity-read";
import { registerRosNodeReadTool } from "./tools/ros-node-read";
import { registerRosTopicReadTool } from "./tools/ros-topic-read";
import { registerRosServiceReadTool } from "./tools/ros-service-read";
import { logger } from "./logger";

interface ToolAPI {
  registerTool(tool: {
    name: string;
    description: string;
    parameters: any;
    execute(id: string, params: any): Promise<{ content: Array<{ type: string; text: string }> }>;
  }): void;
}

export default function (api: ToolAPI) {
  registerEntityReadTool(api);
  registerRosNodeReadTool(api);
  registerRosTopicReadTool(api);
  registerRosServiceReadTool(api);
}
