import * as fs from "fs";
import { TEMPLATE_TO_CONFIG_ID, getConfigById } from "../packages/tensorfleet-util/src/config/vm-config";

/**
 * Load and validate .tensorfleet configuration from a file path
 * @param configPath - Absolute path to the .tensorfleet file
 * @returns Promise resolving to the validated VM configuration
 * @throws Error if config file is invalid or missing required fields
 */
export async function loadTensorfleetConfig(configPath: string): Promise<any> {
  // Validate config-file parameter
  if (!configPath) {
    throw new Error('config-file parameter is required');
  }

  // Load and validate .tensorfleet configuration from provided path
  let configContent: string;
  
  try {
    configContent = fs.readFileSync(configPath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read config file at ${configPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  let configData: any;
  try {
    configData = JSON.parse(configContent);
  } catch (error) {
    throw new Error(`Invalid JSON in config file at ${configPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  // Validate required template field
  if (!configData.template) {
    throw new Error(`Config file at ${configPath} is missing required 'template' field`);
  }

  // Get configuration based on template
  const configId = TEMPLATE_TO_CONFIG_ID[configData.template];
  if (!configId) {
    throw new Error(`Unknown template '${configData.template}' in config file at ${configPath}`);
  }

  const config = getConfigById(configId);
  if (!config) {
    throw new Error(`Invalid configuration ID '${configId}' for template '${configData.template}'`);
  }

  return config;
}