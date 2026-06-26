import { droneLogsTool, type DroneLogsParams } from "./drone-logs";
import type { ToolExecutionResult } from "../tool-api";

export async function executeDroneLogsTool(_id: string, params: DroneLogsParams): Promise<ToolExecutionResult> {
  return await droneLogsTool(_id, params);
}
