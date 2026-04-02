import { loadTensorfleetConfig } from "../config-loader";
import { setConfig, getConfig, clearConfig } from "tensorfleet-util";
import { TensorfleetLogger } from "tensorfleet-util";
// Simple mutex implementation to prevent parallel ROS connections
class SimpleMutex {
  private locked = false;
  private waitQueue: Array<() => void> = [];

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      if (!this.locked) {
        this.locked = true;
        resolve(() => this.release());
      } else {
        this.waitQueue.push(() => {
          this.locked = true;
          resolve(() => this.release());
        });
      }
    });
  }

  private release(): void {
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift();
      if (next) next();
    } else {
      this.locked = false;
    }
  }
}

const rosConnectionMutex = new SimpleMutex();
const logger = new TensorfleetLogger('Tools');

// Global timer for auto-disconnect/reconnect
let autoReconnectTimer: number | null = null;
let lastRosConnectTime: number = 0;
const AUTO_RECONNECT_DELAY = 2 * 60 * 1000; // 2 minutes in milliseconds

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

export async function rosConnect(_id: string, params: any): Promise<() => void> {
  // Pause timer when mutex is locked (connection in progress)
  pauseAutoReconnectTimer();
  
  const releaseLock = await rosConnectionMutex.acquire();
  try {
    logger.debug('Starting ROS connection process...');
    
    // Load and validate .tensorfleet configuration
    const config = await loadTensorfleetConfig(params['tensorfleet-project-path']);
    logger.debug('Configuration loaded successfully');

    // Set up config store with proxy configuration for ROS2Bridge
    const env = config?.env ?? {};
    if (env.proxyUrl != null) setConfig("TENSORFLEET_PROXY_URL", env.proxyUrl);
    if (env.vmManagerUrl != null) setConfig("TENSORFLEET_VM_MANAGER_URL", env.vmManagerUrl);
    if (env.nodeId != null) setConfig("TENSORFLEET_NODE_ID", env.nodeId);
    if (env.token != null) setConfig("TENSORFLEET_JWT", env.token);
    else if (env.TENSORFLEET_JWT != null) setConfig("TENSORFLEET_JWT", env.TENSORFLEET_JWT);
    logger.debug('Config store setup complete');

    // Import and initialize ROS2Bridge
    const { ros2Bridge } = await import("tensorfleet-ros");
    
    // Wait for connection to be established
    logger.debug('Waiting for ROS connection to be established...');
    
    const connectionTimeout = 10000; // 30 seconds timeout
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
  } finally {
    // The release function will be called by the caller
  }
  
  // Return the release function for the caller to call when done
  return releaseLock;
}

export async function rosConnectTool(_id: string, params: any) {
  try {
    // Use the new rosConnect function which handles the mutex
    await rosConnect(_id, params);
    
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
