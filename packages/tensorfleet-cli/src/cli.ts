#!/usr/bin/env node

import { Command } from "commander";
import { version } from "../package.json";
import { executeRosConnect, executeRosTopicRead, executeEntityRead, executeRosServiceRead } from "tensorfleet-tools";

const program = new Command();

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
      }
    ) => {
      if (!options.topicId) {
        console.error("Error: --topic-id option is required");
        exitCli(1);
      }

      const finalParameters = parameters.length > 0 ? parameters : ["--list"];

      try {
        const result = await executeRosTopicRead("ros-topic-read", {
          topic_id: options.topicId,
          parameters: finalParameters,
          return_type: options.returnType,
          "tensorfleet-project-path": options.projectPath,
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
  .action(
    async (options: {
      projectPath: string;
      entityId: string;
      returnType: string;
      parameters?: string[];
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

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  exitCli(1);
});
