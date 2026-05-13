import { vmTool } from "./vm";

export async function executeVmTool(_id: string, params: { action: "status" | "start" | "stop" | "list-configs" | "list-regions"; token?: string; vmManagerUrl?: string; region?: string; configId?: string; includeDev?: boolean }) {
  return await vmTool(_id, params);
}
