#!/usr/bin/env node

import { Command } from "commander";
import { createServer } from "node:http";
import { version } from "../package.json";
import { executeRosConnect, executeRosTopicRead, executeEntityRead, executeRosServiceRead, executeVmTool, executeAuthTool, executeDroneTool } from "tensorfleet-tools";
import { fetchVmSnapshot, getRegionById, setConfig, startOAuthRedirectFlow } from "tensorfleet-auth";
import { getGlobalAuthInfo, storeAuthTokenOnGlobal } from "tensorfleet-auth";

const program = new Command();
const DEFAULT_AUTH_BACKEND_URL = "https://app.tensorfleet.net/";

function redactAuthInfo(authInfo: ReturnType<typeof getGlobalAuthInfo>) {
  if (!authInfo) {
    return null;
  }

  return {
    ...authInfo,
    token: `${authInfo.token.slice(0, 8)}...`,
  };
}

async function runCliAuthLogin(backendUrl: string) {
  const session = await startOAuthRedirectFlow({
    backendUrl,
    createServer,
    openBrowser: async (url) => {
      console.log(`Open this URL to authenticate:\n${url}`);
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
  .action(async (options: { backendUrl: string }) => {
    try {
      const result = await runCliAuthLogin(options.backendUrl);
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
  .action(async (options: { backendUrl: string }) => {
    console.warn("Warning: 'test-auth' is deprecated. Use 'auth login' instead.");
    try {
      const result = await runCliAuthLogin(options.backendUrl);
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

program
  .command("ros-connect")
  .description("Test ROS connection using in-memory config or an optional tensorfleet project directory")
  .option(
    "-p, --project-path <path>",
    "Optional Tensorfleet project directory path for legacy .tensorfleet/.env fallback"
  )
  .action(async (options: { projectPath?: string }) => {
    try {
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

program
  .command("ros-topic-read")
  .description("Read from a ROS topic and wait for one publication")
  .option(
    "-p, --project-path <path>",
    "Optional Tensorfleet project directory path for legacy .tensorfleet/.env fallback"
  )
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
      }
    ) => {
      if (!options.topicId) {
        console.error("Error: --topic-id option is required");
        exitCli(1);
      }

      try {
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

program
  .command("entity-read")
  .description("Read from a featured entity in the ROS environment")
  .option(
    "-p, --project-path <path>",
    "Optional Tensorfleet project directory path for legacy .tensorfleet/.env fallback"
  )
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
    }) => {
      const finalParameters = options.parameters && options.parameters.length > 0 
        ? options.parameters 
        : ["--list"];

      try {
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

program
  .command("ros-service-read")
  .description("Read from a ROS service by calling it with arguments")
  .option(
    "-p, --project-path <path>",
    "Optional Tensorfleet project directory path for legacy .tensorfleet/.env fallback"
  )
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
      }
    ) => {
      if (!options.serviceId) {
        console.error("Error: --service-id option is required");
        exitCli(1);
      }

      // For --list, pass ["--list"] for arguments
      const finalArguments = args.length > 0 && args[0] === "--list" ? ["--list"] : args;

      try {
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

program
  .command("vm")
  .description("Manage VMs: status, start, stop, list-configs, list-regions, select-vm. Uses stored auth token or runs OAuth flow.")
  .argument("<action>", "Action to perform: status, start, stop, list-configs, list-regions, select-vm")
  .option("--region <id>", "Region (eu, asia, local)")
  .option("--vm-id <id>", "VM/node id for select-vm")
  .option("--config <id>", "VM config for start: px4, ardupilot, simple_robot, lerobot")
  .option("--timeout <seconds>", "Optional wait timeout in seconds for start/stop to reach the target state")
  .option("--dev", "Include development-only regions for list-regions")
  .option("--do-auth", "Run OAuth authentication first")
  .option("--backend-url <url>", "TensorFleet backend URL for OAuth", DEFAULT_AUTH_BACKEND_URL)
  .option("--no-open", "Deprecated: login URLs are always printed during --do-auth")
  .action(async (action: string, options: { region?: string; vmId?: string; config?: string; timeout?: string; dev?: boolean; doAuth: boolean; backendUrl: string; open: boolean }) => {
    try {
      // Validate action
      if (!["status", "start", "stop", "list-configs", "list-regions", "select-vm"].includes(action)) {
        console.error(`Invalid action: ${action}. Use: status, start, stop, list-configs, list-regions, or select-vm`);
        exitCli(1);
      }

      if (action === "list-configs" || action === "list-regions" || action === "select-vm") {
        if (action === "select-vm" && !options.region) {
          console.error("Error: --region is required for select-vm");
          exitCli(1);
        }
        if (action === "select-vm" && !options.vmId) {
          console.error("Error: --vm-id is required for select-vm");
          exitCli(1);
        }

        const result = await executeVmTool(`vm-${action}`, {
          action: action as "list-configs" | "list-regions" | "select-vm",
          includeDev: options.dev ?? false,
          region: options.region,
          nodeId: options.vmId,
        });

        if (result?.content?.[0]?.text) {
          console.log(result.content[0].text);
        } else {
          console.log("No VM discovery data received");
        }

        exitCli(0);
      }

      const timeout =
        options.timeout != undefined ? Number(options.timeout) : undefined;
      if (timeout != undefined && (!Number.isFinite(timeout) || timeout < 0)) {
        console.error("--timeout must be a non-negative number of seconds");
        exitCli(1);
      }

      // Run OAuth if requested
      if (options.doAuth) {
        const session = await startOAuthRedirectFlow({
          backendUrl: options.backendUrl,
          createServer,
          openBrowser: async (url) => {
            console.log(`Open this URL to authenticate:\n${url}`);
          },
          onTokenReceived: (token) => {
            storeAuthTokenOnGlobal(token, "oauth");
          },
        });
        await session.tokenPromise;
      }

      // Check for stored auth
      const authInfo = getGlobalAuthInfo();
      if (!authInfo) {
        console.error("Not authenticated. Run `tensorfleet test-auth` first or pass --do-auth");
        exitCli(1);
      }

      let vmManagerUrl: string | undefined;
      if (options.region) {
        const region = getRegionById(options.region, true);
        if (!region) {
          console.error(`Invalid region: ${options.region}. Use \`tensorfleet vm list-regions --dev\` to view available regions.`);
          exitCli(1);
        }
        vmManagerUrl = region.vmManagerUrl;
      }

      const result = await executeVmTool(`vm-${action}`, {
        action: action as "status" | "start" | "stop",
        token: authInfo.token,
        vmManagerUrl,
        region: options.region,
        configId: options.config,
        timeout,
      });

      if (result?.content?.[0]?.text) {
        console.log(result.content[0].text);
      } else {
        console.log("No data received");
      }

      exitCli(0);
    } catch (error) {
      console.error(
        `VM ${action} failed:`,
        error instanceof Error ? error.message : String(error)
      );
      exitCli(1);
    }
  });

program
  .command("drone")
  .description("Get drone state or set autopilot state")
  .argument("<action>", "Action to perform: get-state, set-autopilot-state")
  .option(
    "-p, --project-path <path>",
    "Optional Tensorfleet project directory path for legacy .tensorfleet/.env fallback"
  )
  .option("--region <id>", "Region (eu, asia, local)")
  .option("--do-auth", "Run OAuth authentication first")
  .option("--backend-url <url>", "TensorFleet backend URL for OAuth", DEFAULT_AUTH_BACKEND_URL)
  .option("--no-open", "Deprecated: login URLs are always printed during --do-auth")
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
      if (!["get-state", "set-autopilot-state"].includes(action)) {
        console.error(`Invalid action: ${action}. Use: get-state or set-autopilot-state`);
        exitCli(1);
      }

      if (!options.region) {
        console.error("Error: --region is required for drone");
        exitCli(1);
      }

      if (!options.projectPath && !options.doAuth) {
        console.error("Error: provide either --project-path or --do-auth");
        exitCli(1);
      }

      const region = getRegionById(options.region, true);
      if (!region) {
        console.error(`Invalid region: ${options.region}. Use \`tensorfleet vm list-regions --dev\` to view available regions.`);
        exitCli(1);
      }

      setConfig("TENSORFLEET_REGION", region.id);
      setConfig("TENSORFLEET_VM_MANAGER_URL", region.vmManagerUrl);

      if (options.doAuth) {
        const session = await startOAuthRedirectFlow({
          backendUrl: options.backendUrl,
          createServer,
          openBrowser: async (url) => {
            console.log(`Open this URL to authenticate:\n${url}`);
          },
          onTokenReceived: (token) => {
            storeAuthTokenOnGlobal(token, "oauth");
            setConfig("TENSORFLEET_JWT", token);
          },
        });
        await session.tokenPromise;
      }

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
        action: action as any,
        "tensorfleet-project-path": options.projectPath,
        token: authInfo?.token,
        vmManagerUrl: region.vmManagerUrl,
        nodeId,
        region: region.id,
        ...(autoStatePayload as object),
      });

      if (result?.content?.[0]?.text) {
        console.log(result.content[0].text);
      } else {
        console.log("No drone data received");
      }

      exitCli(0);
    } catch (error) {
      console.error(
        `Drone ${action} failed:`,
        error instanceof Error ? error.message : String(error)
      );
      exitCli(1);
    }
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  exitCli(1);
});
