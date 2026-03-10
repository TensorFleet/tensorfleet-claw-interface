import { Type } from "@sinclair/typebox";
import * as fs from "fs";
import * as path from "path";
import { TensorfleetTelemetryRosTopicRead } from "../schema-types/tensorfleet-telemetry.ros-topic.read.input";

interface ToolAPI {
  registerTool(tool: {
    name: string;
    description: string;
    parameters: any;
    execute(id: string, params: any): Promise<{ content: Array<{ type: string; text: string }> }>;
  }): void;
}

// Helper function to load schema from file
function loadSchema(filename: string) {
  const schemaPath = path.join(__dirname, "../schema", filename);
  const schemaContent = fs.readFileSync(schemaPath, "utf8");
  return JSON.parse(schemaContent);
}

export function registerRosTopicReadTool(api: ToolAPI) {
  api.registerTool({
    name: "tensorfleet-telemetry-ros-topic-read",
    description: "Subscribe to an ros topic and wait for a publication on the topic",
    parameters: loadSchema("tensorfleet-telemetry.ros-topic.read.input.json"),
    async execute(_id: string, params: TensorfleetTelemetryRosTopicRead) {
      // For now, just return the input back to the user
      return { 
        content: [{ 
          type: "text", 
          text: JSON.stringify(params, null, 2)
        }] 
      };
    },
  });
}