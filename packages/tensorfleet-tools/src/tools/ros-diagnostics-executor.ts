import { rosDiagnosticsTool, type RosDiagnosticsParams } from "./ros-diagnostics";

export async function executeRosDiagnostics(_id: string, params: RosDiagnosticsParams) {
  return await rosDiagnosticsTool(_id, params);
}
