import { authTool, type AuthParams } from "./auth";

export async function executeAuthTool(_id: string, params: AuthParams) {
  return await authTool(_id, params);
}
