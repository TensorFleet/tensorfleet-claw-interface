#!/usr/bin/env node

import { Command } from "commander";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { version } from "../package.json";
import { executeRosConnect, executeRosTopicRead, executeEntityRead, executeRosServiceRead, executeVmTool, executeListRegions, executeAuthTool } from "tensorfleet-tools";
import { getRegionById } from "tensorfleet-auth";
import { getGlobalAuthInfo } from "./auth-global";

const program = new Command();
const DEFAULT_AUTH_BACKEND_URL = "https://app.tensorfleet.net/";

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

program
  .command("test-auth")
  .description("Test TensorFleet authentication and store auth info on globalThis")
  .option("--backend-url <url>", "TensorFleet backend URL", DEFAULT_AUTH_BACKEND_URL)
  .action(async (options: { backendUrl: string }) => {
    try {
      const result = await executeAuthTool("test-auth", {
        backendUrl: options.backendUrl,
      });

      if (result?.content?.[0]?.text) {
        console.log(result.content[0].text);
      } else {
        console.log("No auth data received");
      }

      exitCli(0);
    } catch (error) {
      console.error(
        "Auth test failed:",
        error instanceof Error ? error.message : String(error)
      );
      exitCli(1);
    }
  });

function openBrowser(url: string): Promise<void> {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];

  return new Promise((resolve, reject) => {
    const child = execFile(command, args, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });

    child.unref();
  });
}

program
  .command("ros-connect")
  .description("Test ROS connection for a specific tensorfleet project directory")
  .requiredOption(
    "-p, --project-path <path>",
    "Tensorfleet project directory path"
  )
  .action(async (options: { projectPath: string }) => {
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
  .requiredOption(
    "-p, --project-path <path>",
    "Tensorfleet project directory path"
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
        projectPath: string;
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
  .requiredOption(
    "-p, --project-path <path>",
    "Tensorfleet project directory path"
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
      projectPath: string;
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
  .requiredOption(
    "-p, --project-path <path>",
    "Tensorfleet project directory path"
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
        projectPath: string;
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
  .description("Manage VMs: status, start, stop. Uses stored auth token or runs OAuth flow.")
  .argument("<action>", "Action to perform: status, start, stop")
  .option("--region <id>", "Region (eu, asia, local). Defaults to local", "local")
  .option("--config <id>", "VM config for start: px4, ardupilot, simple_robot, lerobot")
  .option("--do-auth", "Run OAuth authentication first")
  .option("--backend-url <url>", "TensorFleet backend URL for OAuth", DEFAULT_AUTH_BACKEND_URL)
  .option("--no-open", "Print the login URL instead of opening a browser during --do-auth")
  .action(async (action: string, options: { region: string; config?: string; doAuth: boolean; backendUrl: string; open: boolean }) => {
    try {
      // Validate action
      if (!["status", "start", "stop"].includes(action)) {
        console.error(`Invalid action: ${action}. Use: status, start, or stop`);
        exitCli(1);
      }

      // Run OAuth if requested
      if (options.doAuth) {
        const session = await startOAuthRedirectFlow({
          backendUrl: options.backendUrl,
          createServer,
          openBrowser: async (url) => {
            if (!options.open) {
              console.log(`Open this URL to authenticate:\n${url}`);
              return;
            }
            await openBrowser(url);
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

      // Resolve region to get VM Manager URL
      const region = getRegionById(options.region, true);
      const vmManagerUrl = region.vmManagerUrl;

      const result = await executeVmTool(`vm-${action}`, {
        action: action as "status" | "start" | "stop",
        token: authInfo.token,
        vmManagerUrl,
        region: options.region,
        configId: options.config,
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
  .command("list-regions")
  .description("List available TensorFleet regions")
  .option("--dev", "Include development-only regions")
  .action(async (options: { dev: boolean }) => {
    try {
      const result = await executeListRegions("list-regions", {
        includeDev: options.dev ?? false,
      });

      if (result?.content?.[0]?.text) {
        console.log(result.content[0].text);
      } else {
        console.log("No region data received");
      }

      exitCli(0);
    } catch (error) {
      console.error(
        "Listing regions failed:",
        error instanceof Error ? error.message : String(error)
      );
      exitCli(1);
    }
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  exitCli(1);
});
