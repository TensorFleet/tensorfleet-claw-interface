import * as fs from "fs";
import * as path from "path";
import { parse } from "dotenv";
import { TEMPLATE_TO_CONFIG_ID, getConfig, getConfigById, getGlobalAuthInfo } from "tensorfleet-auth";
import { logger } from "tensorfleet-util";

/**
 * Load and validate .tensorfleet configuration from a directory path
 * If projectPath is not provided, returns configuration from in-memory stores only
 * @param projectPath - Optional absolute path to a legacy tensorfleet project directory containing .tensorfleet/.env files
 * @returns Promise resolving to the validated configuration with merged .env variables
 * @throws Error if config files are invalid or missing required fields
 */
export async function loadTensorfleetConfig(projectPath?: string): Promise<any> {
  // If no project path provided, return in-memory configuration only
  if (!projectPath) {
    const authInfo = getGlobalAuthInfo();
    
    return {
      env: {
        TENSORFLEET_JWT: authInfo?.token ?? process.env.TENSORFLEET_JWT,
        TENSORFLEET_VM_MANAGER_URL: getConfig("TENSORFLEET_VM_MANAGER_URL"),
        TENSORFLEET_PROXY_URL: getConfig("TENSORFLEET_PROXY_URL"),
        TENSORFLEET_NODE_ID: getConfig("TENSORFLEET_NODE_ID"),
      }
    };
  }

  // Resolve the directory path
  const resolvedPath = path.resolve(projectPath);
  
  // Check if the directory exists
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Tensorfleet project directory does not exist: ${resolvedPath}`);
  }

  if (!fs.statSync(resolvedPath).isDirectory()) {
    throw new Error(`Path is not a directory: ${resolvedPath}`);
  }

  // Load .tensorfleet configuration
  const tensorfleetPath = path.join(resolvedPath, '.tensorfleet');
  let tensorfleetConfig: any;
  
  try {
    const configContent = fs.readFileSync(tensorfleetPath, 'utf8');
    tensorfleetConfig = JSON.parse(configContent);
    logger.debug(`Loaded .tensorfleet configuration from ${tensorfleetPath}`);
  } catch (error) {
    throw new Error(`Failed to read .tensorfleet file at ${tensorfleetPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  // Load .env configuration
  const envPath = path.join(resolvedPath, '.env');
  let envConfig: any = {};
  
  try {
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const parsedEnv = parse(envContent);
      envConfig = parsedEnv;
      logger.debug(`Loaded .env configuration from ${envPath}`);
    } else {
      logger.warn(`No .env file found at ${envPath}, proceeding with .tensorfleet only`);
    }
  } catch (error) {
    throw new Error(`Failed to read .env file at ${envPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  // Check if this is a full configuration file (has env field)
  // This is the new format that contains proxy settings directly
  if (tensorfleetConfig.env && typeof tensorfleetConfig.env === 'object') {
    logger.debug(`Loaded full configuration file with env settings from ${tensorfleetPath}`);
    // Merge .env variables into the existing env configuration
    const mergedConfig = {
      ...tensorfleetConfig,
      env: {
        ...tensorfleetConfig.env,
        ...envConfig
      }
    };
    return mergedConfig;
  }

  // Handle template-based configuration
  // Validate required template field
  if (!tensorfleetConfig.template) {
    throw new Error(`Config file at ${tensorfleetPath} is missing required 'template' field`);
  }

  // Get configuration based on template
  const configId = TEMPLATE_TO_CONFIG_ID[tensorfleetConfig.template];
  if (!configId) {
    throw new Error(`Unknown template '${tensorfleetConfig.template}' in config file at ${tensorfleetPath}`);
  }

  const config = getConfigById(configId);
  if (!config) {
    throw new Error(`Invalid configuration ID '${configId}' for template '${tensorfleetConfig.template}'`);
  }

  // Merge .env variables into the configuration
  const mergedConfig = {
    ...config,
    env: envConfig
  };

  return mergedConfig;
}
