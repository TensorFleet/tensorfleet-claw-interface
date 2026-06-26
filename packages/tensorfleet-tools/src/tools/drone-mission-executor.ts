import { droneMissionTool, type DroneMissionParams } from "./drone-mission";
import type { ToolExecutionResult } from "../tool-api";

export async function executeDroneMissionTool(_id: string, params: DroneMissionParams): Promise<ToolExecutionResult> {
  return await droneMissionTool(_id, params);
}
