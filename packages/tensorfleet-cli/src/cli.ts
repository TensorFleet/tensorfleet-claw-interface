#!/usr/bin/env node

import { Command } from 'commander';
import { version } from '../package.json';
import { executeRosConnect } from 'tensorfleet-tools';

const program = new Command();

program
  .name('tensorfleet')
  .description('TensorFleet CLI tool')
  .version(version);

program
  .command('ros-connect')
  .description('Test ROS connection for a specific tensorfleet project directory')
  .argument('<path>', 'Path to the tensorfleet project directory containing .tensorfleet and .env files')
  .action(async (path) => {
    try {
      await executeRosConnect({ 'tensorfleet-project-path': path });
      console.log('ROS connection test completed successfully');
    } catch (error) {
      console.error('ROS connection test failed:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program.parse();
