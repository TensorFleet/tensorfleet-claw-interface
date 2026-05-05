import { vmStatusTool } from "./vm-status";

export async function executeVmStatus(_id: string, params: { token: string; vmManagerUrl: string; region?: string }) {
  return await vmStatusTool(_id, params);
}