import { droneTool, type DroneParams } from "./drone";
import type { ToolExecutionResult } from "../tool-api";

export async function executeDroneTool(_id: string, params: DroneParams): Promise<ToolExecutionResult> {
  return await droneTool(_id, params);
}
