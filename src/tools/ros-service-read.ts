import { Type } from "@sinclair/typebox";
import * as fs from "fs";
import * as path from "path";
import { TensorfleetTelemetryRosServiceRead } from "../schema-types/tensorfleet-telemetry.ros-service.read.input";
import { loadTensorfleetConfig } from "../config-loader";

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

export function registerRosServiceReadTool(api: ToolAPI) {
  api.registerTool({
    name: "tensorfleet-telemetry-ros-service-read",
    description: "Send a request and receive a response",
    parameters: loadSchema("tensorfleet-telemetry.ros-service.read.input.json"),
    async execute(_id: string, params: TensorfleetTelemetryRosServiceRead) {
      // Load and validate .tensorfleet configuration
      await loadTensorfleetConfig(params['config-file']);

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