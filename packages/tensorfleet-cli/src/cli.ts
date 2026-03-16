#!/usr/bin/env node

import { Command } from 'commander';
import { version } from '../package.json';

const program = new Command();

program
  .name('tensorfleet')
  .description('TensorFleet CLI tool')
  .version(version);

program.parse();