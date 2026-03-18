/**
 * Window Mock for Server-Side Execution
 * 
 * This module provides a fake window object that mimics browser window globals
 * for server-side execution of ROS2Bridge. The ROS2Bridge expects proxy configuration
 * via window globals like TENSORFLEET_PROXY_URL, TENSORFLEET_VM_MANAGER_URL, etc.
 */

// Define the structure of the window globals expected by ROS2Bridge
interface TensorfleetWindowGlobals {
  TENSORFLEET_PROXY_URL?: string;
  TENSORFLEET_VM_MANAGER_URL?: string;
  TENSORFLEET_NODE_ID?: string;
  TENSORFLEET_JWT?: string;
  TENSORFLEET_USE_PROXY?: boolean;
  TENSORFLEET_TARGET_PORT?: number;
}

// Extend the Window interface to include our custom properties
declare global {
  interface Window {
    TENSORFLEET_PROXY_URL?: string;
    TENSORFLEET_VM_MANAGER_URL?: string;
    TENSORFLEET_NODE_ID?: string;
    TENSORFLEET_JWT?: string;
    TENSORFLEET_USE_PROXY?: boolean;
    TENSORFLEET_TARGET_PORT?: number;
    WebSocket?: typeof WebSocket;
  }
}

/**
 * Sets up a fake window object with proxy configuration for server-side execution
 * @param config - The loaded .tensorfleet configuration
 */
export function setupWindowMock(config: any): void {
  // Extract proxy configuration from the loaded config
  const proxyConfig = extractProxyConfig(config);
  
  // Create or update the global window object
  if (typeof global.window === 'undefined') {
    // Initialize window object if it doesn't exist
    global.window = {} as Window & typeof globalThis;
  }
  
  // Set the proxy configuration on the window object
  Object.assign(global.window, proxyConfig);
  
  // Set up WebSocket mock
  setupWebSocketMock();
  
  console.log('[WindowMock] Setup complete with proxy configuration:', {
    proxyUrl: proxyConfig.TENSORFLEET_PROXY_URL,
    vmManagerUrl: proxyConfig.TENSORFLEET_VM_MANAGER_URL,
    nodeId: proxyConfig.TENSORFLEET_NODE_ID,
    useProxy: proxyConfig.TENSORFLEET_USE_PROXY,
    targetPort: proxyConfig.TENSORFLEET_TARGET_PORT
  });
}

/**
 * Sets up window mock with validation for ROS2Bridge usage
 * This function is specifically designed to be called before ROS2Bridge initialization
 * @param config - The loaded .tensorfleet configuration
 * @returns True if setup was successful, false otherwise
 */
export function setupWindowMockForROS2Bridge(config: any): boolean {
  try {
    setupWindowMock(config);
    
    // Validate the configuration
    const isValid = validateProxyConfig();
    
    if (!isValid) {
      console.warn('[WindowMock] ROS2Bridge setup failed: Missing required proxy configuration');
      return false;
    }
    
    console.log('[WindowMock] ROS2Bridge setup successful');
    return true;
  } catch (error) {
    console.error('[WindowMock] ROS2Bridge setup failed:', error);
    return false;
  }
}

/**
 * Extracts proxy configuration from the loaded .tensorfleet config
 * Supports both legacy sim_config format and new env format
 * @param config - The loaded .tensorfleet configuration
 * @returns Proxy configuration object
 */
function extractProxyConfig(config: any): TensorfleetWindowGlobals {
  // Default values
  const proxyConfig: TensorfleetWindowGlobals = {
    TENSORFLEET_USE_PROXY: true,
    TENSORFLEET_TARGET_PORT: 8765
  };
  
  // Try new env format first (your JSON structure)
  if (config.env) {
    // Extract proxy URL from env
    if (config.env.proxyUrl) {
      proxyConfig.TENSORFLEET_PROXY_URL = config.env.proxyUrl;
    }
    
    // Extract VM manager URL from env
    if (config.env.vmManagerUrl) {
      proxyConfig.TENSORFLEET_VM_MANAGER_URL = config.env.vmManagerUrl;
    }
    
    // Extract node ID from env
    if (config.env.nodeId) {
      proxyConfig.TENSORFLEET_NODE_ID = config.env.nodeId;
    }
    
    // Extract JWT token from env (look for common patterns)
    if (config.env.jwtToken) {
      proxyConfig.TENSORFLEET_JWT = config.env.jwtToken;
    } else if (config.env.token) {
      proxyConfig.TENSORFLEET_JWT = config.env.token;
    }
    
    // Allow override of use_proxy flag
    if (typeof config.env.useProxy === 'boolean') {
      proxyConfig.TENSORFLEET_USE_PROXY = config.env.useProxy;
    }
    
    // Allow override of target port
    if (typeof config.env.targetPort === 'number') {
      proxyConfig.TENSORFLEET_TARGET_PORT = config.env.targetPort;
    }
  }
  
  // Fallback to legacy sim_config format
  if (config.sim_config) {
    // Extract proxy URL from config
    if (config.sim_config.proxy_url) {
      proxyConfig.TENSORFLEET_PROXY_URL = config.sim_config.proxy_url;
    }
    
    // Extract VM manager URL from config
    if (config.sim_config.vm_manager_url) {
      proxyConfig.TENSORFLEET_VM_MANAGER_URL = config.sim_config.vm_manager_url;
    }
    
    // Extract node ID from config
    if (config.sim_config.node_id) {
      proxyConfig.TENSORFLEET_NODE_ID = config.sim_config.node_id;
    }
    
    // Extract JWT token from config
    if (config.sim_config.jwt_token) {
      proxyConfig.TENSORFLEET_JWT = config.sim_config.jwt_token;
    }
    
    // Allow override of use_proxy flag
    if (typeof config.sim_config.use_proxy === 'boolean') {
      proxyConfig.TENSORFLEET_USE_PROXY = config.sim_config.use_proxy;
    }
    
    // Allow override of target port
    if (typeof config.sim_config.target_port === 'number') {
      proxyConfig.TENSORFLEET_TARGET_PORT = config.sim_config.target_port;
    }
  }
  
  return proxyConfig;
}

/**
 * Clears the window mock, removing all proxy configuration
 */
export function clearWindowMock(): void {
  if (typeof global.window !== 'undefined') {
    // Remove proxy-related properties
    delete global.window.TENSORFLEET_PROXY_URL;
    delete global.window.TENSORFLEET_VM_MANAGER_URL;
    delete global.window.TENSORFLEET_NODE_ID;
    delete global.window.TENSORFLEET_JWT;
    delete global.window.TENSORFLEET_USE_PROXY;
    delete global.window.TENSORFLEET_TARGET_PORT;
    
    console.log('[WindowMock] Cleared proxy configuration');
  }
}

/**
 * Gets the current proxy configuration from the window object
 * @returns Current proxy configuration or null if not set
 */
export function getCurrentProxyConfig(): TensorfleetWindowGlobals | null {
  if (typeof global.window === 'undefined') {
    return null;
  }
  
  return {
    TENSORFLEET_PROXY_URL: global.window.TENSORFLEET_PROXY_URL,
    TENSORFLEET_VM_MANAGER_URL: global.window.TENSORFLEET_VM_MANAGER_URL,
    TENSORFLEET_NODE_ID: global.window.TENSORFLEET_NODE_ID,
    TENSORFLEET_JWT: global.window.TENSORFLEET_JWT,
    TENSORFLEET_USE_PROXY: global.window.TENSORFLEET_USE_PROXY,
    TENSORFLEET_TARGET_PORT: global.window.TENSORFLEET_TARGET_PORT
  };
}

/**
 * Simple WebSocket mock for server-side execution
 * This provides a basic WebSocket-like interface that can be used when
 * the actual WebSocket is not available (e.g., in Node.js environments)
 */
class MockWebSocket {
  private url: string;
  private protocols?: string | string[];
  private readyState: number = WebSocket.CONNECTING;
  private onopen: ((event: Event) => void) | null = null;
  private onclose: ((event: CloseEvent) => void) | null = null;
  private onmessage: ((event: MessageEvent) => void) | null = null;
  private onerror: ((event: Event) => void) | null = null;

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    
    console.log('[MockWebSocket] Creating mock WebSocket connection to:', url);
    
    // Simulate connection delay
    setTimeout(() => {
      this.readyState = WebSocket.OPEN;
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
    }, 100);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    console.log('[MockWebSocket] Send called with data:', typeof data === 'string' ? data.substring(0, 100) : data);
  }

  close(code?: number, reason?: string): void {
    console.log('[MockWebSocket] Close called with code:', code, 'reason:', reason);
    this.readyState = WebSocket.CLOSED;
    if (this.onclose) {
      const closeEvent = new CloseEvent('close', {
        code: code || 1000,
        reason: reason || '',
        wasClean: true
      });
      this.onclose(closeEvent);
    }
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    switch (type) {
      case 'open':
        this.onopen = listener as (event: Event) => void;
        break;
      case 'close':
        this.onclose = listener as (event: CloseEvent) => void;
        break;
      case 'message':
        this.onmessage = listener as (event: MessageEvent) => void;
        break;
      case 'error':
        this.onerror = listener as (event: Event) => void;
        break;
    }
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    switch (type) {
      case 'open':
        if (this.onopen === listener) this.onopen = null;
        break;
      case 'close':
        if (this.onclose === listener) this.onclose = null;
        break;
      case 'message':
        if (this.onmessage === listener) this.onmessage = null;
        break;
      case 'error':
        if (this.onerror === listener) this.onerror = null;
        break;
    }
  }
}

/**
 * Sets up the WebSocket mock on the window object
 */
export function setupWebSocketMock(): void {
  if (typeof global.window !== 'undefined') {
    global.window.WebSocket = MockWebSocket as any;
    console.log('[WindowMock] WebSocket mock setup complete');
  }
}

/**
 * Validates that the required proxy configuration is present
 * @returns True if all required fields are present, false otherwise
 */
export function validateProxyConfig(): boolean {
  const config = getCurrentProxyConfig();
  
  if (!config) {
    console.warn('[WindowMock] No proxy configuration found');
    return false;
  }
  
  const requiredFields = [
    'TENSORFLEET_PROXY_URL',
    'TENSORFLEET_VM_MANAGER_URL', 
    'TENSORFLEET_NODE_ID'
  ];
  
  // JWT is required for authentication but we'll warn instead of failing
  // since some environments might not need it
  const optionalFields = ['TENSORFLEET_JWT'];
  
  const missingRequiredFields = requiredFields.filter(field => !config[field as keyof TensorfleetWindowGlobals]);
  
  if (missingRequiredFields.length > 0) {
    console.warn('[WindowMock] Missing required proxy configuration fields:', missingRequiredFields);
    return false;
  }
  
  const missingOptionalFields = optionalFields.filter(field => !config[field as keyof TensorfleetWindowGlobals]);
  if (missingOptionalFields.length > 0) {
    console.warn('[WindowMock] Missing optional proxy configuration fields (may cause connection failures):', missingOptionalFields);
  }
  
  return true;
}
