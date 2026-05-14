import { loadTensorfleetConfig } from "../config-loader";
import { setConfig, getConfig } from "tensorfleet-auth";
import { TensorfleetLogger } from "tensorfleet-util";
// Simple mutex implementation to prevent parallel ROS connections
class SimpleMutex {
  private locked = false;
  private waitQueue: Array<{ grant: () => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }> = [];

  async acquire(timeoutMs = 15000): Promise<() => void> {
    return new Promise((resolve, reject) => {
      if (!this.locked) {
        this.locked = true;
        resolve(() => this.release());
      } else {
        const queued = {
          grant: () => {
            clearTimeout(queued.timeout);
            this.locked = true;
            resolve(() => this.release());
          },
          reject,
          timeout: setTimeout(() => {
            const index = this.waitQueue.indexOf(queued);
            if (index >= 0) {
              this.waitQueue.splice(index, 1);
            }
            reject(new Error(`Timed out waiting for ROS connection lock after ${timeoutMs}ms`));
          }, timeoutMs),
        };
        this.waitQueue.push(queued);
      }
    });
  }

  private release(): void {
    const next = this.waitQueue.shift();

    if (next) {
      next.grant();
    } else {
      this.locked = false;
    }
  }
}

const rosConnectionMutex = new SimpleMutex();
const logger = new TensorfleetLogger('Tools');

// Global timer for auto-disconnect/reconnect
let autoReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let lastRosConnectTime: number = 0;
const AUTO_RECONNECT_DELAY = 2 * 60 * 1000; // 2 minutes in milliseconds

function pickConfigValue<T>(...values: Array<T | null | undefined>): T | undefined {
  return values.find((value): value is T => value != null);
}

function hydrateConfigStoreFromEnv(env: Record<string, any>): void {
  const proxyUrl = pickConfigValue(env.TENSORFLEET_PROXY_URL, env.proxyUrl);
  const vmManagerUrl = pickConfigValue(env.TENSORFLEET_VM_MANAGER_URL, env.vmManagerUrl);
  const nodeId = pickConfigValue(env.TENSORFLEET_NODE_ID, env.nodeId);
  const token = pickConfigValue(env.TENSORFLEET_JWT, env.token);

  if (proxyUrl != null) setConfig("TENSORFLEET_PROXY_URL", proxyUrl);
  if (vmManagerUrl != null) setConfig("TENSORFLEET_VM_MANAGER_URL", vmManagerUrl);
  if (nodeId != null) setConfig("TENSORFLEET_NODE_ID", nodeId);
  if (token != null) setConfig("TENSORFLEET_JWT", token);
}

function startAutoReconnectTimer(): void {
  // Clear any existing timer
  if (autoReconnectTimer !== null) {
    clearTimeout(autoReconnectTimer);
    autoReconnectTimer = null;
  }

  // Set new timer to disconnect after 2 minutes
  autoReconnectTimer = setTimeout(() => {
    logger.debug('Auto-reconnect timer expired, disconnecting ROS2Bridge');
    const { ros2Bridge } = require("tensorfleet-ros");
    if (ros2Bridge && typeof ros2Bridge.disconnect === "function") {
      ros2Bridge.disconnect();
    }
  }, AUTO_RECONNECT_DELAY);
}

function resetAutoReconnectTimer(): void {
  // Clear existing timer
  if (autoReconnectTimer !== null) {
    clearTimeout(autoReconnectTimer);
    autoReconnectTimer = null;
  }
  
  // Start new timer
  startAutoReconnectTimer();
}

function pauseAutoReconnectTimer(): void {
  // Clear the timer when mutex is locked
  if (autoReconnectTimer !== null) {
    clearTimeout(autoReconnectTimer);
    autoReconnectTimer = null;
  }
}

export async function ensureRosConnected(_id: string, params: any): Promise<void> {
  try {
    logger.debug('Starting ROS connection process...');
    
    // Hydrate config-store from optional project files or the in-memory auth/config layers.
    const config = await loadTensorfleetConfig(params['tensorfleet-project-path']);
    logger.debug('Configuration loaded successfully');

    // Set up config store with proxy configuration for ROS2Bridge
    const env = config?.env ?? {};
    hydrateConfigStoreFromEnv(env);
    logger.debug('Config store setup complete');

    // Import and initialize ROS2Bridge
    const { ros2Bridge } = await import("tensorfleet-ros");
    
    // Wait for connection to be established
    logger.debug('Waiting for ROS connection to be established...');
    
    const connectionTimeout = 10000; // 10 seconds timeout
    const startTime = Date.now();
    
    await new Promise<void>((resolve, reject) => {
      const checkConnection = () => {
        const elapsed = Date.now() - startTime;
        
        if (elapsed > connectionTimeout) {
          reject(new Error(`Connection timeout after ${connectionTimeout}ms. ROS2Bridge failed to connect.`));
          return;
        }
        
        if (ros2Bridge.isConnected()) {
          logger.debug('ROS connection established successfully');
          // Update last connection time and reset auto-reconnect timer
          lastRosConnectTime = Date.now();
          resetAutoReconnectTimer();
          resolve();
        } else {
          // Continue polling
          setTimeout(checkConnection, 500);
        }
      };
      
      // Start checking connection status
      checkConnection();
    });
  } catch (error) {
    logger.error('ROS connection failed:', error);
    throw error;
  }
}

export async function withRosConnection<T>(_id: string, params: any, fn: () => Promise<T>): Promise<T> {
  // Pause timer while an operation is actively acquiring/using the connection.
  pauseAutoReconnectTimer();

  const releaseLock = await rosConnectionMutex.acquire();
  try {
    await ensureRosConnected(_id, params);
    return await fn();
  } finally {
    releaseLock();
  }
}

export async function rosConnect(_id: string, params: any): Promise<() => void> {
  await withRosConnection(_id, params, async () => undefined);
  return () => undefined;
}

export async function rosConnectTool(_id: string, params: any) {
  try {
    await withRosConnection(_id, params, async () => undefined);
    
    // Return the legacy format
    const responseText = JSON.stringify({
      success: true,
      message: "ROS connection established successfully",
      timestamp: new Date().toISOString(),
      connectionDetails: {
        nodeId: getConfig("TENSORFLEET_NODE_ID") || null,
        proxyUrl: getConfig("TENSORFLEET_PROXY_URL") || null,
        vmManagerUrl: getConfig("TENSORFLEET_VM_MANAGER_URL") || null
      }
    }, null, 2);
    
    return {
      content: [{
        type: "text",
        text: responseText || ""
      }]
    };
    
  } catch (error) {
    logger.error('ROS connection failed:', error);
    const errorText = JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      timestamp: new Date().toISOString()
    }, null, 2);
    
    return {
      content: [{
        type: "text",
        text: errorText || ""
      }]
    };
  }
}
