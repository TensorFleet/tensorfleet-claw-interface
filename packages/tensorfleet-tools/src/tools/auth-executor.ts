import { authTool } from "./auth";

export async function executeAuthTool(_id: string, params: { backendUrl?: string }) {
  return await authTool(_id, params);
}