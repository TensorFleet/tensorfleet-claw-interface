# Tensorfleet OpenClaw Plugin

This plugin provides integration between OpenClaw and the ROS environment in the Tensorfleet runtime. It also assists users by controlling the VS Code extension's UI.

## Configuration

The plugin uses a `.tensorfleet` configuration file to establish connections to ROS environments. This file should be placed in your project directory and contains the necessary proxy and connection settings.

### Configuration File Format

Create a `.tensorfleet` file in your project root with the following structure:

```json
{
  "env": {
    "TENSORFLEET_PROXY_URL": "ws://localhost:8080",
    "TENSORFLEET_VM_MANAGER_URL": "http://localhost:3000",
    "TENSORFLEET_NODE_ID": "your-node-id"
  }
}
```

### Environment Variables

Alternatively, you can set these environment variables directly:

- `TENSORFLEET_PROXY_URL`: WebSocket URL for the proxy connection
- `TENSORFLEET_VM_MANAGER_URL`: URL for the VM manager
- `TENSORFLEET_NODE_ID`: Unique identifier for your node

## Getting Started

1. **Prerequisites**: Ensure you have OpenClaw installed on your system.

2. **Install the Plugin**: Install the plugin in development mode to link the source code:

   ```bash
   openclaw plugins install -l .
   ```

   This command links the plugin's source code instead of copying it, allowing for real-time development.

3. **Update Changes**: After making changes to the plugin code, restart the OpenClaw gateway to apply the latest implementation:

   ```bash
   openclaw gateway restart
   ```

   This ensures that OpenClaw uses the most recent version of your plugin.

## Tools

The plugin provides the following tools for interacting with ROS:

- `tensorfleet-telemetry-entity-read`: Read from the parameters of a tensorfleet entity
- `tensorfleet-telemetry-ros-node-read`: Read from the parameters of an ROS node
- `tensorfleet-telemetry-ros-topic-read`: Subscribe to an ROS topic and wait for a publication
- `tensorfleet-telemetry-ros-service-read`: Send a request and receive a response from an ROS service
- `tensorfleet-telemetry-ros-connect`: Establish a connection to ROS2 via Foxglove Bridge

All tools require the `tensorfleet-project-path` parameter to specify the path to your project directory containing the `.tensorfleet` configuration file.

