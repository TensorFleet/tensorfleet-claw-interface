# Window Mock for ROS2Bridge Proxy Configuration

This implementation provides a fake "window" object for server-side execution of ROS2Bridge, allowing it to use proxy configuration from `.tensorfleet` config files.

## Overview

The ROS2Bridge expects proxy configuration via browser window globals:
- `window.TENSORFLEET_PROXY_URL`
- `window.TENSORFLEET_VM_MANAGER_URL`
- `window.TENSORFLEET_NODE_ID`
- `window.TENSORFLEET_JWT`
- `window.TENSORFLEET_USE_PROXY`
- `window.TENSORFLEET_TARGET_PORT`

For server-side execution, we create a fake window object that provides these globals.

## Files Created/Modified

### `src/window-mock.ts` (New)
- Provides `setupWindowMock()` function to create fake window object
- Includes `MockWebSocket` class for server-side WebSocket functionality
- Extracts proxy configuration from `.tensorfleet` config files
- Validates required proxy configuration fields

### `src/tools/ros-node-read.ts` (Modified)
- Now calls `setupWindowMock()` with loaded config
- Validates proxy configuration before proceeding

### `src/tools/ros-service-read.ts` (Modified)
- Same integration as ros-node-read.ts

### `src/tools/ros-topic-read.ts` (Modified)
- Same integration as ros-node-read.ts

### `src/tools/entity-read.ts` (Modified)
- Same integration as ros-node-read.ts

## Usage

### 1. Load Config File
```typescript
import { loadTensorfleetConfig } from "./config-loader";
import { setupWindowMock, validateProxyConfig } from "./window-mock";

// Load .tensorfleet configuration
const config = await loadTensorfleetConfig("/path/to/.tensorfleet");

// Set up window mock with proxy configuration
setupWindowMock(config);

// Validate configuration
if (!validateProxyConfig()) {
  throw new Error("Proxy configuration is incomplete");
}
```

### 2. Expected .tensorfleet Format
```json
{
  "template": "px4",
  "sim_config": {
    "config_version": "0.0.1",
    "world_components": "static_bodies_01",
    "gazebo_px4_enabled": "true",
    // Proxy configuration
    "proxy_url": "wss://eu.vm.tensorfleet.net/ws",
    "vm_manager_url": "https://eu.vm.tensorfleet.net",
    "node_id": "test-node-123",
    "jwt_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test-token",
    "use_proxy": true,
    "target_port": 8765
  }
}
```

### 3. How It Works
1. Tools load the `.tensorfleet` config file using `loadTensorfleetConfig()`
2. `setupWindowMock()` extracts proxy settings and creates fake window object
3. `MockWebSocket` provides WebSocket-like interface for server-side execution
4. ROS2Bridge can now access proxy configuration via window globals
5. Connection proceeds as if running in a browser environment

## Benefits

- **No package modifications**: Works with existing ROS2Bridge code
- **Server-side compatible**: Provides browser-like environment for Node.js
- **Config-driven**: Uses existing `.tensorfleet` configuration format
- **WebSocket mock**: Handles WebSocket connections in server environment
- **Validation**: Ensures required proxy configuration is present

## Integration Points

The window mock is automatically set up in all ROS tools:
- `ros-node-read.ts`
- `ros-service-read.ts` 
- `ros-topic-read.ts`
- `entity-read.ts`

Each tool now:
1. Loads the `.tensorfleet` config file
2. Sets up the window mock with proxy configuration
3. Validates the configuration
4. Proceeds with normal operation

This allows ROS2Bridge to connect to Foxglove Bridge via the vm-manager proxy using configuration from the `.tensorfleet` file, even when running in a server-side environment.