import { setConfig, fetchVmSnapshot } from "tensorfleet-util";
import { TensorfleetLogger } from "tensorfleet-util";

const logger = new TensorfleetLogger("Tools");

export interface VmStatusParams {
  token: string;
  vmManagerUrl: string;
  region?: string;
}

export async function vmStatusTool(_id: string, params: VmStatusParams) {
  try {
    const { token, vmManagerUrl, region } = params;

    logger.debug(`Using VM Manager URL: ${vmManagerUrl}`);

    // Store the VM manager URL into config-store for future commands
    setConfig("TENSORFLEET_VM_MANAGER_URL", vmManagerUrl);

    // Fetch VM snapshot from the VM Manager API
    const snapshot = await fetchVmSnapshot({
      baseUrl: vmManagerUrl,
      token,
    });

    // Also attempt to auto-detect nodeId and store it
    if (snapshot.nodeId) {
      setConfig("TENSORFLEET_NODE_ID", snapshot.nodeId);
    }

    const responseText = JSON.stringify(
      {
        success: true,
        region: region ?? "local",
        vmManagerUrl,
        snapshot: {
          connection: snapshot.connection,
          vmState: snapshot.vmState,
          nodeId: snapshot.nodeId ?? null,
          ipAddress: snapshot.ipAddress ?? null,
          provider: snapshot.provider ?? null,
          region: snapshot.region ?? null,
          uptimeSeconds: snapshot.uptimeSeconds ?? null,
          timestamp: snapshot.timestamp,
          error: snapshot.error ?? null,
        },
      },
      null,
      2
    );

    return {
      content: [
        {
          type: "text",
          text: responseText || "",
        },
      ],
    };
  } catch (error) {
    logger.error("VM status check failed:", error);
    const errorText = JSON.stringify(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
        timestamp: new Date().toISOString(),
      },
      null,
      2
    );

    return {
      content: [
        {
          type: "text",
          text: errorText || "",
        },
      ],
    };
  }
}