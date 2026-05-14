import { vmTool } from "./vm";

export async function executeVmTool(_id: string, params: { action: "status" | "start" | "stop" | "list-configs" | "list-regions" | "select-vm"; token?: string; vmManagerUrl?: string; region?: string; nodeId?: string; vmId?: string; configId?: string; includeDev?: boolean; timeout?: number }) {
  return await vmTool(_id, params);
}
