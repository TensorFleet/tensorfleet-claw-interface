import { Type } from "@sinclair/typebox";
import * as fs from "fs";
import * as path from "path";

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

export default function (api: ToolAPI) {
  // Register tensorfleet-telemetry.entity.read tool
  api.registerTool({
    name: "tensorfleet-telemetry.entity.read",
    description: "Read from the parameters of a tensorfleet entity",
    parameters: loadSchema("tensorfleet-telemetry.entity.read.input.json"),
    async execute(_id: string, params: any) {
      // For now, just return the input back to the user
      return { 
        content: [{ 
          type: "text", 
          text: JSON.stringify(params, null, 2)
        }] 
      };
    },
  });

  // Register tensorfleet-telemetry.ros-node.read tool
  api.registerTool({
    name: "tensorfleet-telemetry.ros-node.read",
    description: "Read from the parameters of an ros node",
    parameters: loadSchema("tensorfleet-telemetry.ros-node.read.input.json"),
    async execute(_id: string, params: any) {
      // For now, just return the input back to the user
      return { 
        content: [{ 
          type: "text", 
          text: JSON.stringify(params, null, 2)
        }] 
      };
    },
  });

  // Register tensorfleet-telemetry.ros-topic.read tool
  api.registerTool({
    name: "tensorfleet-telemetry.ros-topic.read",
    description: "Subscribe to an ros topic and wait for a publication on the topic",
    parameters: loadSchema("tensorfleet-telemetry.ros-topic.read.input.json"),
    async execute(_id: string, params: any) {
      // For now, just return the input back to the user
      return { 
        content: [{ 
          type: "text", 
          text: JSON.stringify(params, null, 2)
        }] 
      };
    },
  });

  // Register tensorfleet-telemetry.ros-service.read tool
  api.registerTool({
    name: "tensorfleet-telemetry.ros-service.read",
    description: "Send a request and receive a response",
    parameters: loadSchema("tensorfleet-telemetry.ros-service.read.input.json"),
    async execute(_id: string, params: any) {
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
