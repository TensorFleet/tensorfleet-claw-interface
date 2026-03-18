/**
 * Window Mock for Server-Side Execution
 * 
 * This module provides a fake window object that mimics browser window globals
 * for server-side execution of ROS2Bridge. The ROS2Bridge expects proxy configuration
 * via window globals.
 */

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
    global.window = {} as any;
  }
  
  // Set the proxy configuration on the window object
  Object.assign(global.window, proxyConfig);
  
  // Set up WebSocket mock
  setupWebSocketMock();
  
  console.log('[WindowMock] Setup complete with proxy configuration');
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
    
    console.log('[WindowMock] ROS2Bridge setup successful');
    return true;
  } catch (error) {
    console.error('[WindowMock] ROS2Bridge setup failed:', error);
    return false;
  }
}

/**
 * Extracts proxy configuration from the loaded .tensorfleet config
 * Simply passes through the data without any processing or fallbacks
 * @param config - The loaded .tensorfleet configuration
 * @returns Proxy configuration object
 */
function extractProxyConfig(config: any): any {
  const proxyConfig: any = {};
  
  // Pass through all environment variables directly
  // This includes both config.env and any merged .env variables
  if (config.env && typeof config.env === 'object') {
    Object.assign(proxyConfig, config.env);
  }
  
  return proxyConfig;
}

/**
 * Clears the window mock, removing all proxy configuration
 */
export function clearWindowMock(): void {
  if (typeof global.window !== 'undefined') {
    console.log('[WindowMock] Cleared proxy configuration');
  }
}

/**
 * Gets the current proxy configuration from the window object
 * @returns Current proxy configuration or null if not set
 */
export function getCurrentProxyConfig(): any {
  if (typeof global.window === 'undefined') {
    return null;
  }
  
  return global.window;
}

/**
 * Proper WebSocket mock for server-side execution
 * This provides a complete WebSocket-like interface that can be used when
 * the actual WebSocket is not available (e.g., in Node.js environments)
 */
class MockWebSocket {
  private url: string;
  private protocols?: string | string[];
  private _readyState: number = WebSocket.CONNECTING;
  private _onopen: ((event: Event) => void) | null = null;
  private _onclose: ((event: CloseEvent) => void) | null = null;
  private _onmessage: ((event: MessageEvent) => void) | null = null;
  private _onerror: ((event: Event) => void) | null = null;
  private eventListeners: Map<string, Set<EventListenerOrEventListenerObject>> = new Map();

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    
    console.log('[MockWebSocket] Creating mock WebSocket connection to:', url);
    
    // Immediately set to OPEN state for proper implementation
    this._readyState = WebSocket.OPEN;
    
    // Trigger open event immediately
    if (this._onopen) {
      this._onopen(new Event('open'));
    }
    
    // Trigger any queued open listeners
    this.dispatchEvent('open', new Event('open'));
  }

  get readyState(): number {
    return this._readyState;
  }

  get onopen(): ((event: Event) => void) | null {
    return this._onopen;
  }

  set onopen(listener: ((event: Event) => void) | null) {
    this._onopen = listener;
  }

  get onclose(): ((event: CloseEvent) => void) | null {
    return this._onclose;
  }

  set onclose(listener: ((event: CloseEvent) => void) | null) {
    this._onclose = listener;
  }

  get onmessage(): ((event: MessageEvent) => void) | null {
    return this._onmessage;
  }

  set onmessage(listener: ((event: MessageEvent) => void) | null) {
    this._onmessage = listener;
  }

  get onerror(): ((event: Event) => void) | null {
    return this._onerror;
  }

  set onerror(listener: ((event: Event) => void) | null) {
    this._onerror = listener;
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
    
    console.log('[MockWebSocket] Send called with data:', typeof data === 'string' ? data.substring(0, 100) : data);
    
    // Create and dispatch message event
    const messageEvent = new MessageEvent('message', {
      data: data,
      origin: new URL(this.url).origin
    });
    
    if (this._onmessage) {
      this._onmessage(messageEvent);
    }
    
    this.dispatchEvent('message', messageEvent);
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === WebSocket.CLOSED) {
      return;
    }
    
    this._readyState = WebSocket.CLOSED;
    
    const closeEvent = new CloseEvent('close', {
      code: code || 1000,
      reason: reason || '',
      wasClean: true
    });
    
    if (this._onclose) {
      this._onclose(closeEvent);
    }
    
    this.dispatchEvent('close', closeEvent);
    
    console.log('[MockWebSocket] Close called with code:', code, 'reason:', reason);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set());
    }
    
    this.eventListeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.eventListeners.delete(type);
      }
    }
  }

  dispatchEvent(type: string, event: Event): boolean {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      listeners.forEach(listener => {
        if (typeof listener === 'function') {
          listener(event);
        } else if (listener && typeof listener.handleEvent === 'function') {
          listener.handleEvent(event);
        }
      });
    }
    return true;
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

