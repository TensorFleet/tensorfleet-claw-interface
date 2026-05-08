import { vmTool } from "./vm";

export async function executeVmTool(_id: string, params: { action: "status" | "start" | "stop"; token?: string; vmManagerUrl?: string; region?: string; configId?: string }) {
  return await vmTool(_id, params);
}
