# Tensorfleet OpenClaw Plugin

This plugin provides integration between OpenClaw and the ROS environment in the Tensorfleet runtime. It also assists users by controlling the VS Code extension's UI.

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

