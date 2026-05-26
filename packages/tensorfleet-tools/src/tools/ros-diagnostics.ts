import { getRosConnectionDiagnostics } from "./ros-connect";

export interface RosDiagnosticsParams {
  "tensorfleet-project-path"?: string;
}

export async function rosDiagnosticsTool(_id: string, params: RosDiagnosticsParams) {
  try {
    const diagnostics = await getRosConnectionDiagnostics(params);

    return {
      content: [{
        type: "text",
        text: JSON.stringify(diagnostics, null, 2) || ""
      }]
    };
  } catch (error) {
    const errorText = JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      timestamp: new Date().toISOString()
    }, null, 2);

    return {
      content: [{
        type: "text",
        text: errorText || ""
      }]
    };
  }
}
