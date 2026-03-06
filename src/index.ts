import { Type } from "@sinclair/typebox";

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
    name: "my_tool",
    description: "Do a thing",
    parameters: Type.Object({
      input: Type.String(),
    }),
    async execute(_id: string, params: { input: string }) {
      return { content: [{ type: "text", text: params.input }] };
    },
  });
}
