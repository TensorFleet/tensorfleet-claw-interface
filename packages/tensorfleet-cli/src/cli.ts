#!/usr/bin/env node

import { Command } from 'commander';
import { version } from '../package.json';
import { executeRosConnect } from 'tensorfleet-tools';
import { executeRosTopicRead } from 'tensorfleet-tools';

const program = new Command();

program
  .name('tensorfleet')
  .description('TensorFleet CLI tool')
  .version(version);

// Global option that applies to all commands
program.option('-p, --project-path <path>', 'Tensorfleet project directory path (required for all commands)');

program
  .command('ros-connect')
  .description('Test ROS connection for a specific tensorfleet project directory')
  .action(async (cmd) => {
    const options = cmd.opts();
    const projectPath = options.projectPath;
    if (!projectPath) {
      console.error('Error: --project-path option is required');
      process.exit(1);
    }

    try {
      await executeRosConnect("ros-connect", { 'tensorfleet-project-path': projectPath });
      console.log('ROS connection test completed successfully');
    } catch (error) {
      console.error('ROS connection test failed:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('ros-topic-read')
  .description('Read from a ROS topic and wait for one publication')
  .argument('<topic-id>', 'ROS global topic path to read from. Use "--list" to list available topics')
  .argument('<parameters...>', 'List of parameters to read from the topic')
  .option('-r, --return-type <type>', 'Return type for the response (JSON)', 'JSON')
  .action(async (topicId, parameters, cmd) => {
    const options = cmd.opts();
    const projectPath = options.projectPath;
    if (!projectPath) {
      console.error('Error: --project-path option is required');
      process.exit(1);
    }

    try {
      const params = {
        topic_id: topicId,
        parameters: parameters,
        return_type: options.returnType,
        'tensorfleet-project-path': projectPath
      };

      const result = await executeRosTopicRead("ros-topic-read", params);
      
      // Extract and display the result text
      if (result && result.content && result.content[0] && result.content[0].text) {
        console.log(result.content[0].text);
      } else {
        console.log('No data received');
      }
    } catch (error) {
      console.error('ROS topic read failed:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program.parse();
