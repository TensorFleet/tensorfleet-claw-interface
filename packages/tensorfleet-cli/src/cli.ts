#!/usr/bin/env node

import { spawn } from "node:child_process";
import { Command } from "commander";
import { createServer } from "node:http";
import { version } from "../package.json";
import { executeRosConnect, executeRosTopicRead, executeEntityRead, executeRosServiceRead, executeVmTool, executeAuthTool, executeDroneTool, executeDroneMissionTool } from "tensorfleet-tools";
import { fetchVmSnapshot, getRegionById, setConfig, startOAuthRedirectFlow } from "tensorfleet-auth";
import { getGlobalAuthInfo, storeAuthTokenOnGlobal } from "tensorfleet-auth";

const program = new Command();
const DEFAULT_AUTH_BACKEND_URL = "https://app.tensorfleet.net/";

async function openUrlInBrowser(url: string): Promise<void> {
  const platform = process.platform;

  let command: string;
  let args: string[];

  if (platform === "darwin") {
    command = "open";
    args = [url];
  } else if (platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
  } else {
    command = "xdg-open";
    args = [url];
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });

    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function handleOAuthBrowserOpen(url: string, shouldOpen: boolean): Promise<void> {
  if (!shouldOpen) {
    console.log(`Open this URL to authenticate:\n${url}`);
    return;
  }

  try {
    await openUrlInBrowser(url);
  } catch {
    console.log(`Open this URL to authenticate:\n${url}`);
  }
}

function redactAuthInfo(authInfo: ReturnType<typeof getGlobalAuthInfo>) {
  if (!authInfo) {
    return null;
  }

  return {
    ...authInfo,
    token: `${authInfo.token.slice(0, 8)}...`,
  };
}

async function runCliAuthLogin(backendUrl: string, open = true) {
  const session = await startOAuthRedirectFlow({
    backendUrl,
    createServer,
    openBrowser: async (url) => {
      await handleOAuthBrowserOpen(url, open);
    },
    onTokenReceived: (token) => {
      storeAuthTokenOnGlobal(token, "oauth");
    },
  });

  await session.tokenPromise;

  const authInfo = getGlobalAuthInfo();
  if (!authInfo) {
    throw new Error("Authentication completed but no auth info was stored");
  }

  return {
    success: true,
    command: "login",
    authInfo: redactAuthInfo(authInfo),
  };
}

type CliConnectionOptions = {
  projectPath?: string;
  region?: string;
  doAuth?: boolean;
  backendUrl: string;
  open: boolean;
};

type CliAuthOptions = {
  doAuth?: boolean;
  backendUrl: string;
  open: boolean;
};

type CliRegionOptions = {
  region?: string;
};

type VmAction = "status" | "start" | "stop";
type VmDiscoveryAction = "list-configs" | "list-regions" | "select-vm";

const VM_ACTIONS = ["status", "start", "stop", "list-configs", "list-regions", "select-vm"] as const;
const VM_DISCOVERY_ACTIONS = ["list-configs", "list-regions", "select-vm"] as const;
const DRONE_ACTIONS = ["get-state", "set-autopilot-state"] as const;
const DRONE_MISSION_ACTIONS = ["status", "set-local", "set-go-to", "set-takeoff", "set-land", "set-return-to-launch"] as const;

function addAuthOptions(command: Command): Command {
  return command
    .option("--do-auth", "Run OAuth authentication first")
    .option("--backend-url <url>", "TensorFleet backend URL for OAuth", DEFAULT_AUTH_BACKEND_URL)
    .option("--no-open", "Print the login URL instead of opening a browser tab");
}

function addRegionOption(command: Command): Command {
  return command.option("--region <id>", "Region (eu, asia, local)");
}

function addProjectPathOption(command: Command): Command {
  return command.option(
    "-p, --project-path <path>",
    "Optional Tensorfleet project directory path for legacy .tensorfleet/.env fallback"
  );
}

function addConnectionOptions(command: Command): Command {
  return addAuthOptions(addRegionOption(addProjectPathOption(command)));
}

function addRegionalAuthOptions(command: Command): Command {
  return addAuthOptions(addRegionOption(command));
}

function isOneOf<const T extends readonly string[]>(value: string, values: T): value is T[number] {
  return values.includes(value as T[number]);
}

async function authenticateForCli(options: {
  backendUrl: string;
  open: boolean;
}): Promise<void> {
  const session = await startOAuthRedirectFlow({
    backendUrl: options.backendUrl,
    createServer,
    openBrowser: async (url) => {
      await handleOAuthBrowserOpen(url, options.open);
    },
    onTokenReceived: (token) => {
      storeAuthTokenOnGlobal(token, "oauth");
    },
  });
  await session.tokenPromise;
}

async function runRequestedAuth(options: CliAuthOptions): Promise<void> {
  if (!options.doAuth) {
    return;
  }

  await authenticateForCli({
    backendUrl: options.backendUrl,
    open: options.open,
  });
}

function requireAuthInfo(message: string): NonNullable<ReturnType<typeof getGlobalAuthInfo>> {
  const authInfo = getGlobalAuthInfo();
  if (!authInfo) {
    console.error(message);
    exitCli(1);
  }

  return authInfo;
}

function requireRegion(options: CliRegionOptions, usage: string) {
  if (!options.region) {
    console.error(`Error: --region is required ${usage}`);
    exitCli(1);
  }

  const region = getRegionById(options.region, true);
  if (!region) {
    console.error(`Invalid region: ${options.region}. Use \`tensorfleet vm list-regions --dev\` to view available regions.`);
    exitCli(1);
  }

  return region;
}

function parseToolPayload<T = any>(result: any): T | undefined {
  const text = result?.content?.[0]?.text;
  return text ? JSON.parse(text) : undefined;
}

function printToolText(result: any, fallback: string): void {
  if (result?.content?.[0]?.text) {
    console.log(result.content[0].text);
    return;
  }

  console.log(fallback);
}

async function resolveAndSelectVm(regionId: string, token: string, errorContext: string): Promise<string> {
  const statusResult = await executeVmTool("vm-status", {
    action: "status",
    token,
    region: regionId,
  });

  const statusPayload = parseToolPayload(statusResult);
  if (!statusPayload?.success) {
    throw new Error(statusPayload?.error ?? `Failed to resolve VM status for ${errorContext}`);
  }

  const nodeId = statusPayload?.snapshot?.nodeId;
  if (!nodeId) {
    throw new Error(`Unable to determine VM node id for ${errorContext}`);
  }

  const selectVmResult = await executeVmTool("vm-select-vm", {
    action: "select-vm",
    region: regionId,
    nodeId,
  });

  const selectVmPayload = parseToolPayload(selectVmResult);
  if (!selectVmPayload?.success) {
    throw new Error(selectVmPayload?.error ?? `Failed to select VM for ${errorContext}`);
  }

  return nodeId;
}

async function prepareCliRosContext(options: CliConnectionOptions): Promise<void> {
  await runRequestedAuth(options);

  if (options.projectPath) {
    return;
  }

  const region = requireRegion(options, "unless --project-path is provided");
  const authInfo = requireAuthInfo("Not authenticated. Pass --do-auth or provide --project-path with legacy auth config");
  await resolveAndSelectVm(region.id, authInfo.token, "ROS command");
}

function exitCli(code: number): never {
  try {
    process.stdin.pause();
    process.stdin.unref?.();
    process.stdout.end?.();
    process.stderr.end?.();
  } catch {}
  process.exit(code);
}

program
  .name("tensorfleet")
  .description("TensorFleet CLI tool")
  .version(version);

const authCommand = program
  .command("auth")
  .description("Authentication management");

authCommand
  .command("login")
  .description("Perform OAuth authentication and store credentials")
  .option("--backend-url <url>", "TensorFleet backend URL", DEFAULT_AUTH_BACKEND_URL)
  .option("--no-open", "Print the login URL instead of opening a browser tab")
  .action(async (options: { backendUrl: string; open: boolean }) => {
    try {
      const result = await runCliAuthLogin(options.backendUrl, options.open);
      console.log(JSON.stringify(result, null, 2));

      exitCli(0);
    } catch (error) {
      console.error(
        "Login failed:",
        error instanceof Error ? error.message : String(error)
      );
      exitCli(1);
    }
  });

authCommand
  .command("status")
  .description("Check current authentication status")
  .action(async () => {
    try {
      const result = await executeAuthTool("auth-status", {
        command: "status",
      });

      if (result?.content?.[0]?.text) {
        console.log(result.content[0].text);
      } else {
        console.log("No auth status available");
      }

      exitCli(0);
    } catch (error) {
      console.error(
        "Failed to check auth status:",
        error instanceof Error ? error.message : String(error)
      );
      exitCli(1);
    }
  });

authCommand
  .command("logout")
  .description("Clear stored authentication credentials")
  .action(async () => {
    try {
      const result = await executeAuthTool("auth-logout", {
        command: "logout",
      });

      if (result?.content?.[0]?.text) {
        console.log(result.content[0].text);
      } else {
        console.log("Logout completed");
      }

      exitCli(0);
    } catch (error) {
      console.error(
        "Logout failed:",
        error instanceof Error ? error.message : String(error)
      );
      exitCli(1);
    }
  });

// Keep test-auth for backward compatibility
program
  .command("test-auth")
  .description("Deprecated: Use 'tensorfleet auth login' instead")
  .option("--backend-url <url>", "TensorFleet backend URL", DEFAULT_AUTH_BACKEND_URL)
  .option("--no-open", "Print the login URL instead of opening a browser tab")
  .action(async (options: { backendUrl: string; open: boolean }) => {
    console.warn("Warning: 'test-auth' is deprecated. Use 'auth login' instead.");
    try {
      const result = await runCliAuthLogin(options.backendUrl, options.open);
      console.log(JSON.stringify(result, null, 2));

      exitCli(0);
    } catch (error) {
      console.error(
        "Auth test failed:",
        error instanceof Error ? error.message : String(error)
      );
      exitCli(1);
    }
  });

addConnectionOptions(program
  .command("ros-connect")
  .description("Test ROS connection using in-memory config or an optional tensorfleet project directory"))
  .action(async (options: {
    projectPath?: string;
    region?: string;
    doAuth: boolean;
    backendUrl: string;
    open: boolean;
  }) => {
    try {
      await prepareCliRosContext(options);

      await executeRosConnect("ros-connect", {
        "tensorfleet-project-path": options.projectPath,
      });
      console.log("ROS connection test completed successfully");
      exitCli(0);
    } catch (error) {
      console.error(
        "ROS connection test failed:",
        error instanceof Error ? error.message : String(error)
      );
      exitCli(1);
    }
  });

addConnectionOptions(program
  .command("ros-topic-read")
  .description("Read from a ROS topic and wait for one publication"))
  .option(
    "--topic-id <topic>",
    "ROS global topic path to read from"
  )
  .option(
    "-r, --return-type <type>",
    "Return type for the response",
    "JSON"
  )
  .option(
    "--regex-filter <regex>",
    "Regex filter to apply to the output"
  )
  .argument(
    "[parameters...]",
    'List of parameters to read from the topic. Use "--list" to return the full message'
  )
  .action(
    async (
      parameters: string[] = [],
      options: {
        projectPath?: string;
        topicId?: string;
        returnType: string;
        regexFilter?: string;
        region?: string;
        doAuth: boolean;
        backendUrl: string;
        open: boolean;
      }
    ) => {
      if (!options.topicId) {
        console.error("Error: --topic-id option is required");
        exitCli(1);
      }

      try {
        await prepareCliRosContext(options);

        const result = await executeRosTopicRead("ros-topic-read", {
          topic_id: options.topicId,
          return_type: options.returnType,
          "tensorfleet-project-path": options.projectPath,
          regex_filter: options.regexFilter,
        });

        if (result?.content?.[0]?.text) {
          console.log(result.content[0].text);
        } else {
          console.log("No data received");
        }

        exitCli(0);
      } catch (error) {
        console.error(
          "ROS topic read failed:",
          error instanceof Error ? error.message : String(error)
        );
        exitCli(1);
      }
    }
  );

addConnectionOptions(program
  .command("entity-read")
  .description("Read from a featured entity in the ROS environment"))
  .requiredOption(
    "--entity-id <entity>",
    "Entity ID to read from. Use --list to get available entities"
  )
  .option(
    "-r, --return-type <type>",
    "Return type for the response",
    "JSON"
  )
  .option(
    "--parameters <params...>",
    'List of parameters to read from the entity. Use "--list" to return available parameters'
  )
  .option(
    "--regex-filter <regex>",
    "Regex filter to apply to the output"
  )
  .action(
    async (options: {
      projectPath?: string;
      entityId: string;
      returnType: string;
      parameters?: string[];
      regexFilter?: string;
      region?: string;
      doAuth: boolean;
      backendUrl: string;
      open: boolean;
    }) => {
      const finalParameters = options.parameters && options.parameters.length > 0 
        ? options.parameters 
        : ["--list"];

      try {
        await prepareCliRosContext(options);

        const result = await executeEntityRead("entity-read", {
          entity_id: options.entityId,
          parameters: finalParameters,
          return_type: options.returnType,
          "tensorfleet-project-path": options.projectPath,
          regex_filter: options.regexFilter,
        });

        if (result?.content?.[0]?.text) {
          console.log(result.content[0].text);
        } else {
          console.log("No data received");
        }

        exitCli(0);
      } catch (error) {
        console.error(
          "Entity read failed:",
          error instanceof Error ? error.message : String(error)
        );
        exitCli(1);
      }
    }
  );

addConnectionOptions(program
  .command("ros-service-read")
  .description("Read from a ROS service by calling it with arguments"))
  .requiredOption(
    "--service-id <service>",
    "ROS service path to call. Use --list to get available services"
  )
  .option(
    "-r, --return-type <type>",
    "Return type for the response",
    "JSON"
  )
  .option(
    "--regex-filter <regex>",
    "Regex filter to apply to the output"
  )
  .argument(
    "[arguments...]",
    'List of arguments to pass to the service. Use "--list" to return the full service schema'
  )
  .action(
    async (
      args: string[] = [],
      options: {
        projectPath?: string;
        serviceId: string;
        returnType: string;
        regexFilter?: string;
        region?: string;
        doAuth: boolean;
        backendUrl: string;
        open: boolean;
      }
    ) => {
      if (!options.serviceId) {
        console.error("Error: --service-id option is required");
        exitCli(1);
      }

      // For --list, pass ["--list"] for arguments
      const finalArguments = args.length > 0 && args[0] === "--list" ? ["--list"] : args;

      try {
        await prepareCliRosContext(options);

        const result = await executeRosServiceRead("ros-service-read", {
          service_id: options.serviceId,
          arguments: finalArguments,
          return_type: options.returnType,
          "tensorfleet-project-path": options.projectPath,
          regex_filter: options.regexFilter,
        });

        if (result?.content?.[0]?.text) {
          console.log(result.content[0].text);
        } else {
          console.log("No data received");
        }

        exitCli(0);
      } catch (error) {
        console.error(
          "ROS service read failed:",
          error instanceof Error ? error.message : String(error)
        );
        exitCli(1);
      }
    }
  );

addRegionalAuthOptions(program
  .command("vm")
  .description("Manage VMs: status, start, stop, list-configs, list-regions, select-vm. Uses stored auth token or runs OAuth flow.")
  .argument("<action>", "Action to perform: status, start, stop, list-configs, list-regions, select-vm"))
  .option("--vm-id <id>", "VM/node id for select-vm")
  .option("--config <id>", "VM config for start: px4, ardupilot, simple_robot, lerobot")
  .option("--timeout <seconds>", "Optional wait timeout in seconds for start/stop to reach the target state")
  .option("--dev", "Include development-only regions for list-regions")
  .action(async (action: string, options: { region?: string; vmId?: string; config?: string; timeout?: string; dev?: boolean; doAuth: boolean; backendUrl: string; open: boolean }) => {
    try {
      if (!isOneOf(action, VM_ACTIONS)) {
        console.error(`Invalid action: ${action}. Use: status, start, stop, list-configs, list-regions, or select-vm`);
        exitCli(1);
      }

      if (isOneOf(action, VM_DISCOVERY_ACTIONS)) {
        if (action === "select-vm" && !options.region) {
          console.error("Error: --region is required for select-vm");
          exitCli(1);
        }
        if (action === "select-vm" && !options.vmId) {
          console.error("Error: --vm-id is required for select-vm");
          exitCli(1);
        }

        const result = await executeVmTool(`vm-${action}`, {
          action: action as VmDiscoveryAction,
          includeDev: options.dev ?? false,
          region: options.region,
          nodeId: options.vmId,
        });

        printToolText(result, "No VM discovery data received");

        exitCli(0);
      }

      const timeout =
        options.timeout != undefined ? Number(options.timeout) : undefined;
      if (timeout != undefined && (!Number.isFinite(timeout) || timeout < 0)) {
        console.error("--timeout must be a non-negative number of seconds");
        exitCli(1);
      }

      await runRequestedAuth(options);
      const authInfo = requireAuthInfo("Not authenticated. Run `tensorfleet test-auth` first or pass --do-auth");

      let vmManagerUrl: string | undefined;
      if (options.region) {
        const region = requireRegion(options, "for this VM action");
        vmManagerUrl = region.vmManagerUrl;
      }

      const result = await executeVmTool(`vm-${action}`, {
        action: action as VmAction,
        token: authInfo.token,
        vmManagerUrl,
        region: options.region,
        configId: options.config,
        timeout,
      });

      printToolText(result, "No data received");

      exitCli(0);
    } catch (error) {
      console.error(
        `VM ${action} failed:`,
        error instanceof Error ? error.message : String(error)
      );
      exitCli(1);
    }
  });

addConnectionOptions(program
  .command("drone")
  .description("Get drone state or set autopilot state")
  .argument("<action>", "Action to perform: get-state, set-autopilot-state"))
  .option("--auto-state <json>", "Target state payload JSON for set-autopilot-state, containing exactly one of landed or airborne_position_local.")
  .action(async (action: string, options: {
    projectPath?: string;
    region?: string;
    doAuth: boolean;
    backendUrl: string;
    open: boolean;
    autoState?: string;
  }) => {
    try {
      if (!isOneOf(action, DRONE_ACTIONS)) {
        console.error(`Invalid action: ${action}. Use: get-state or set-autopilot-state`);
        exitCli(1);
      }

      const region = requireRegion(options, "for drone");

      if (!options.projectPath && !options.doAuth) {
        console.error("Error: provide either --project-path or --do-auth");
        exitCli(1);
      }

      setConfig("TENSORFLEET_REGION", region.id);
      setConfig("TENSORFLEET_VM_MANAGER_URL", region.vmManagerUrl);

      await runRequestedAuth(options);

      const authInfo = getGlobalAuthInfo();
      if (!options.projectPath) {
        if (!authInfo) {
          console.error("Not authenticated. Pass --do-auth or provide --project-path with legacy auth config");
          exitCli(1);
        }
      }

      let nodeId: string | undefined;
      if (authInfo?.token) {
        const snapshot = await fetchVmSnapshot({
          baseUrl: region.vmManagerUrl,
          token: authInfo.token,
        });
        nodeId = snapshot.nodeId ?? undefined;
        if (nodeId) {
          setConfig("TENSORFLEET_NODE_ID", nodeId);
        }
      }

      const autoStatePayload = options.autoState ? JSON.parse(options.autoState) : {};

      const result = await executeDroneTool(`drone-${action}`, {
        action: action as (typeof DRONE_ACTIONS)[number],
        "tensorfleet-project-path": options.projectPath,
        token: authInfo?.token,
        vmManagerUrl: region.vmManagerUrl,
        nodeId,
        region: region.id,
        ...(autoStatePayload as object),
      });

      printToolText(result, "No drone data received");

      exitCli(0);
    } catch (error) {
      console.error(
        `Drone ${action} failed:`,
        error instanceof Error ? error.message : String(error)
      );
      exitCli(1);
    }
  });

addConnectionOptions(program
  .command("drone-mission")
  .description("Read or set the MAVROS drone mission")
  .requiredOption("--action <action>", "Action to perform: status, set-local, set-go-to, set-takeoff, set-land, set-return-to-launch")
  .option("--points <points>", "Mission sequence: x1,y1,z1;x2,y2,z2;...;return-to-launch"))
  .action(async (options: {
    projectPath?: string;
    region?: string;
    doAuth: boolean;
    backendUrl: string;
    open: boolean;
    action: string;
    points?: string;
  }) => {
    try {
      const action = options.action;
      if (!isOneOf(action, DRONE_MISSION_ACTIONS)) {
        console.error(`Invalid action: ${action}. Use: status, set-local, set-go-to, set-takeoff, set-land, or set-return-to-launch`);
        exitCli(1);
      }

      const region = requireRegion(options, "for drone-mission");

      if (!options.projectPath && !options.doAuth) {
        console.error("Error: provide either --project-path or --do-auth");
        exitCli(1);
      }

      setConfig("TENSORFLEET_REGION", region.id);
      setConfig("TENSORFLEET_VM_MANAGER_URL", region.vmManagerUrl);

      await runRequestedAuth(options);

      const authInfo = getGlobalAuthInfo();
      if (!options.projectPath && !authInfo) {
        console.error("Not authenticated. Pass --do-auth or provide --project-path with legacy auth config");
        exitCli(1);
      }

      let nodeId: string | undefined;
      if (authInfo?.token) {
        const snapshot = await fetchVmSnapshot({
          baseUrl: region.vmManagerUrl,
          token: authInfo.token,
        });
        nodeId = snapshot.nodeId ?? undefined;
        if (nodeId) {
          setConfig("TENSORFLEET_NODE_ID", nodeId);
        }
      }

      const result = await executeDroneMissionTool(`drone-mission-${action}`, {
        action,
        points: options.points,
        "tensorfleet-project-path": options.projectPath,
        token: authInfo?.token,
        vmManagerUrl: region.vmManagerUrl,
        nodeId,
        region: region.id,
      });

      printToolText(result, "No drone mission data received");

      exitCli(0);
    } catch (error) {
      console.error(
        "Drone mission failed:",
        error instanceof Error ? error.message : String(error)
      );
      exitCli(1);
    }
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  exitCli(1);
});
