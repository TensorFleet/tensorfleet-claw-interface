# Tensorfleet OpenClaw Plugin

This plugin provides integration between OpenClaw and the ROS environment in the Tensorfleet runtime. It also assists users by controlling the VS Code extension's UI.

## Getting Started

1. **Prerequisites**: Ensure you have OpenClaw installed on your system.

2. **Build the Plugin**: Create the minimal OpenClaw install directory:

   ```bash
   bun run build
   ```

3. **Install the Plugin**: Install the built plugin in development mode:

   ```bash
   cd dist
   openclaw plugins install -l .
   ```

   The `dist` directory contains only the runtime bundle, skills, `package.json`, and `openclaw.plugin.json`, so OpenClaw does not audit the source tree.

4. **Update Changes**: After making changes to the plugin code, rebuild and restart the OpenClaw gateway to apply the latest implementation:

   ```bash
   openclaw gateway restart
   ```

   This ensures that OpenClaw uses the most recent version of your plugin.
