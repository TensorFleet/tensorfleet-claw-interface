import { loadTensorfleetConfig } from "../config-loader";
import { setConfig, getConfig } from "tensorfleet-auth";
import { TensorfleetLogger } from "tensorfleet-util";
// Simple mutex implementation to prevent parallel ROS connections
class SimpleMutex {
  private locked = false;
  private waitQueue: Array<{ grant: () => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout>; settled: boolean }> = [];

  async acquire(timeoutMs = 15000): Promise<() => void> {
    return new Promise((resolve, reject) => {
      if (!this.locked) {
        this.locked = true;
        resolve(() => this.release());
      } else {
        const queued = {
          grant: () => {
            if (queued.settled) {
              return;
            }
            queued.settled = true;
            clearTimeout(queued.timeout);
            this.locked = true;
            resolve(() => this.release());
          },
          reject: (error: Error) => {
            if (queued.settled) {
              return;
            }
            queued.settled = true;
            reject(error);
          },
          timeout: setTimeout(() => {
            const index = this.waitQueue.indexOf(queued);
            if (index >= 0) {
              this.waitQueue.splice(index, 1);
            }
            queued.reject(new Error(`Timed out waiting for ROS connection lock after ${timeoutMs}ms`));
          }, timeoutMs),
          settled: false,
        };
        this.waitQueue.push(queued);
      }
    });
  }

  private release(): void {
    this.locked = false;

    while (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift();

      if (!next || next.settled) {
        continue;
      }

      next.grant();
      return;
    }
  }

  getDiagnostics() {
    return {
      locked: this.locked,
      waitQueueLength: this.waitQueue.length,
      unsettledWaiters: this.waitQueue.filter((entry) => !entry.settled).length,
    };
  }
}

const rosConnectionMutex = new SimpleMutex();
const logger = new TensorfleetLogger('Tools');

// Global timer for auto-disconnect/reconnect
let autoReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let lastRosConnectTime: number = 0;
let activeRosOperations = 0;
let rosConnectAttempts = 0;
let rosConnectSuccesses = 0;
let rosConnectFailures = 0;
let lastRosConnectAttemptAt: string | null = null;
let lastRosConnectSuccessAt: string | null = null;
let lastRosConnectFailureAt: string | null = null;
let lastRosConnectError: string | null = null;
let lastRosOperationStartedAt: string | null = null;
let lastRosOperationFinishedAt: string | null = null;
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
    rosConnectAttempts += 1;
    lastRosConnectAttemptAt = new Date().toISOString();
    lastRosConnectError = null;
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
          lastRosConnectSuccessAt = new Date().toISOString();
          rosConnectSuccesses += 1;
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
    rosConnectFailures += 1;
    lastRosConnectFailureAt = new Date().toISOString();
    lastRosConnectError = error instanceof Error ? error.message : 'Unknown error occurred';
    logger.error('ROS connection failed:', error);
    throw error;
  }
}

export async function withRosConnection<T>(_id: string, params: any, fn: () => Promise<T>): Promise<T> {
  // Pause timer while an operation is actively acquiring/using the connection.
  pauseAutoReconnectTimer();
  activeRosOperations += 1;
  lastRosOperationStartedAt = new Date().toISOString();

  const releaseLock = await rosConnectionMutex.acquire();
  try {
    await ensureRosConnected(_id, params);
    return await fn();
  } finally {
    releaseLock();
    activeRosOperations = Math.max(0, activeRosOperations - 1);
    lastRosOperationFinishedAt = new Date().toISOString();
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

export async function getRosConnectionDiagnostics(params: any = {}) {
  const authInfo = await loadTensorfleetConfig(params['tensorfleet-project-path']);
  const env = authInfo?.env ?? {};

  let rosBridgeDiagnostics: Record<string, unknown> = {
    imported: false,
    connected: false,
  };

  try {
    const { ros2Bridge } = await import("tensorfleet-ros");
    rosBridgeDiagnostics = {
      imported: true,
      connected: typeof ros2Bridge?.isConnected === "function" ? ros2Bridge.isConnected() : false,
      hasDisconnect: typeof ros2Bridge?.disconnect === "function",
      availableTopicsCount: typeof ros2Bridge?.getAvailableTopics === "function" ? ros2Bridge.getAvailableTopics().length : null,
      availableServicesCount: typeof ros2Bridge?.getAvailableServices === "function" ? ros2Bridge.getAvailableServices().length : null,
    };
  } catch (error) {
    rosBridgeDiagnostics = {
      imported: false,
      connected: false,
      importError: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }

  return {
    success: true,
    timestamp: new Date().toISOString(),
    rosConnectInternals: {
      mutex: rosConnectionMutex.getDiagnostics(),
      activeRosOperations,
      autoReconnectTimerActive: autoReconnectTimer !== null,
      autoReconnectDelayMs: AUTO_RECONNECT_DELAY,
      lastRosConnectTime,
      lastRosConnectAttemptAt,
      lastRosConnectSuccessAt,
      lastRosConnectFailureAt,
      lastRosConnectError,
      lastRosOperationStartedAt,
      lastRosOperationFinishedAt,
      rosConnectAttempts,
      rosConnectSuccesses,
      rosConnectFailures,
    },
    config: {
      tensorfleetProjectPath: params['tensorfleet-project-path'] ?? null,
      envProxyUrl: env.TENSORFLEET_PROXY_URL ?? env.proxyUrl ?? null,
      envVmManagerUrl: env.TENSORFLEET_VM_MANAGER_URL ?? env.vmManagerUrl ?? null,
      envNodeId: env.TENSORFLEET_NODE_ID ?? env.nodeId ?? null,
      storeProxyUrl: getConfig("TENSORFLEET_PROXY_URL") || null,
      storeVmManagerUrl: getConfig("TENSORFLEET_VM_MANAGER_URL") || null,
      storeNodeId: getConfig("TENSORFLEET_NODE_ID") || null,
      hasStoredJwt: Boolean(getConfig("TENSORFLEET_JWT")),
    },
    rosBridge: rosBridgeDiagnostics,
  };
}
