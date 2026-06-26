import { vacuumTool, type VacuumParams } from "./vacuum";
import type { ToolExecutionResult } from "../tool-api";

export async function executeVacuumTool(_id: string, params: VacuumParams): Promise<ToolExecutionResult> {
  return await vacuumTool(_id, params);
}
