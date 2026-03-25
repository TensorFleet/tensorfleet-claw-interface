# Tensorfleet OpenClaw Plugin

This plugin provides integration between OpenClaw and the ROS environment in the Tensorfleet runtime. It also assists users by controlling the VS Code extension's UI.

## Configuration

The plugin uses the `.tensorfleet` and `.env` configuration files to establish connections to ROS environments. These files should be placed in your project directory and contains the necessary proxy and connection settings.

## Building the plugin

To build the plugin use the `build` script
```bash
bun run build
```

For a continous watch use the `watch` script
```bash
bun run watch
```