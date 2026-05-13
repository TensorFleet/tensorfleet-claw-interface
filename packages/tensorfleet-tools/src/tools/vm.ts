import { DEFAULT_CONFIG_ID, fetchVmSnapshot, getAllConfigOptions, getConfig, getConfigById, getDefaultConfig, getRegionOrDefault, setConfig, startVm, stopVm } from "tensorfleet-auth";
import { TensorfleetLogger } from "tensorfleet-util";
import { getAvailableRegions, getGlobalAuthInfo } from "tensorfleet-auth";
import type { VMConfig } from "tensorfleet-auth";

const logger = new TensorfleetLogger("Tools");

export type VmAction = "status" | "start" | "stop" | "list-configs" | "list-regions";

export interface VmParams {
  action: VmAction;
  token?: string;
  vmManagerUrl?: string;
  region?: string;
  configId?: string;
  includeDev?: boolean;
}

export async function vmTool(_id: string, params: VmParams) {
  try {
    const { action, region } = params;

    if (action === "list-configs") {
      const configs = getAllConfigOptions().map(({ id, label, description, config }) => ({
        id,
        name: label,
        description,
        isDefault: id === DEFAULT_CONFIG_ID,
        simConfig: config.sim_config,
      }));

      const responseText = JSON.stringify(
        {
          success: true,
          action,
          defaultConfigId: DEFAULT_CONFIG_ID,
          configs,
        },
        null,
        2
      );

      return {
        content: [{ type: "text", text: responseText || "" }],
      };
    }

    if (action === "list-regions") {
      const regions = Object.entries(getAvailableRegions(params.includeDev ?? false)).map(([, config]) => ({
        id: config.id,
        name: config.name,
        description: config.description,
        vmManagerUrl: config.vmManagerUrl,
        devOnly: config.devOnly ?? false,
      }));

      const responseText = JSON.stringify(
        {
          success: true,
          action,
          regions,
        },
        null,
        2
      );

      return {
        content: [{ type: "text", text: responseText || "" }],
      };
    }

    const token = params.token ?? getGlobalAuthInfo()?.token;

    if (!token) {
      throw new Error("Not authenticated. Run tensorfleet-auth login first.");
    }

    const vmManagerUrl =
      params.vmManagerUrl ??
      (region ? getRegionOrDefault(region, true).vmManagerUrl : undefined) ??
      getConfig<string>("TENSORFLEET_VM_MANAGER_URL") ??
      getRegionOrDefault(undefined, true).vmManagerUrl;

    // Always store the VM manager URL in config-store
    setConfig("TENSORFLEET_VM_MANAGER_URL", vmManagerUrl);

    let result: any;

    switch (action) {
      case "status": {
        logger.debug(`Checking VM status at ${vmManagerUrl}`);
        const snapshot = await fetchVmSnapshot({ baseUrl: vmManagerUrl, token });
        if (snapshot.nodeId) {
          setConfig("TENSORFLEET_NODE_ID", snapshot.nodeId);
        }
        result = {
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
        };
        break;
      }

      case "start": {
        const config: VMConfig = params.configId
          ? (getConfigById(params.configId) ?? getDefaultConfig())
          : getDefaultConfig();
        logger.debug(`Starting VM at ${vmManagerUrl} with config: ${config.name} (${config.id})`);
        const startResult = await startVm({ baseUrl: vmManagerUrl, token }, config);
        result = {
          config: { id: config.id, name: config.name },
          result: startResult,
        };
        break;
      }

      case "stop": {
        logger.debug(`Stopping VM at ${vmManagerUrl}`);
        const stopResult = await stopVm({ baseUrl: vmManagerUrl, token });
        result = { result: stopResult };
        break;
      }

      default:
        throw new Error(`Unknown VM action: ${action}`);
    }

    const responseText = JSON.stringify(
      {
        success: true,
        action,
        region: region ?? "local",
        vmManagerUrl,
        ...result,
      },
      null,
      2
    );

    return {
      content: [{ type: "text", text: responseText || "" }],
    };
  } catch (error) {
    logger.error(`VM ${params.action} failed:`, error);
    const errorText = JSON.stringify(
      {
        success: false,
        action: params.action,
        error: error instanceof Error ? error.message : "Unknown error occurred",
        timestamp: new Date().toISOString(),
      },
      null,
      2
    );

    return {
      content: [{ type: "text", text: errorText || "" }],
    };
  }
}
