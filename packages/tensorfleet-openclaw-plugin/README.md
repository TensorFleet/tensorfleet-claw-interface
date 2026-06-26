# Tensorfleet OpenClaw Plugin

This plugin provides integration between OpenClaw and the ROS environment in the Tensorfleet runtime. It also assists users by controlling the VS Code extension's UI.

For product-level vacuum discovery, state inspection, readiness preflight, and gated simulation-only writes, use the OpenClaw plugin tool `tensorfleet-vacuum` with:

```json
{ "action": "get-supported-actions", "backend": "simulation" }
```

This vacuum surface is intentionally a thin facade over `tensorfleet-tools` and the shared vacuum adapter/node runtime. The OpenClaw-managed MCP server is not the primary vacuum integration path for this plugin rollout.

Useful read/preflight actions include `get-snapshot`, `get-map-summary`, `get-map-targets`, `get-room-targets`, `get-zone-targets`, `get-mission-state`, `get-navigation-state`, `get-pose`, `check-navigation-readiness`, `check-clean-area-readiness`, `check-room-cleaning-readiness`, and `check-zone-cleaning-readiness`. Simulation-only write actions are `start-navigation`, `start-clean-area`, `start-room-cleaning`, `start-zone-cleaning`, `pause-mission`, `resume-mission`, `cancel-mission`, `retry-mission-step`, and `skip-mission-step`; all are gated by runtime/config/readiness/capability/active-mission checks. Real-vacuum writes, map edits, raw ROS/Nav2/Foxglove/Valetudo, shell, filesystem, arbitrary HTTP, and MCP vacuum control remain unsupported.

## Getting Started

1. **Prerequisites**: Ensure you have OpenClaw installed on your system.

2. **Build the Plugin**: Create the minimal OpenClaw install directory:

   ```bash
   bun run build
   bun run test:discovery-smoke
   bun run test:vacuum-runtime-smoke
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

## Vacuum Runtime Config

`tensorfleet-vacuum` does not use OpenClaw plugin config settings yet; the plugin manifest has an empty `configSchema`. Runtime values reach the tool through explicit tool parameters first, then process environment/config-store/global auth visible to the OpenClaw gateway process:

- `backend` or `TENSORFLEET_VACUUM_BACKEND`
- `token` or `TENSORFLEET_JWT`
- `vmManagerUrl` or `TENSORFLEET_VM_MANAGER_URL`
- `runtimeUrl` or `TENSORFLEET_VALETUDO_RUNTIME_URL`

For the simulation backend, use the VM Manager route with both auth and `TENSORFLEET_VM_MANAGER_URL` configured. For the real-vacuum direct route, use `runtimeUrl` only when that runtime URL was provided by the user/development environment. Missing config returns structured `not_authenticated` or `unavailable` JSON with source labels only; token and URL values are intentionally omitted, and the tool does not silently fall back to localhost.

After rebuilding the plugin, restart the gateway before treating OpenClaw agent results as current:

```bash
openclaw gateway restart
openclaw plugins list
timeout 15s openclaw plugins inspect tensorfleet-openclaw-plugin --runtime --json
```

The inspect command may print valid runtime JSON and still exit on the outer timeout if the CLI process remains open; use the printed `status`, `imported`, and registered tool list as the useful evidence.

## Vacuum Agent Smoke Prompts

Use short, one-action prompts when validating the agent path:

```text
Use tensorfleet-vacuum with backend simulation. Call start-navigation with target {x:1.0,y:0.5,theta:0.0}. If runtime config is missing, refuse safely and list the missing config. Do not use any other tool.
Use tensorfleet-vacuum with backend simulation. Call start-clean-area with area {type:"rectangle",x:0,y:0,width:1.0,height:0.75}. If runtime config is missing, refuse safely and list the missing config. Do not use any other tool.
Use tensorfleet-vacuum with backend simulation and list all known map targets, rooms, or zones. Do not start cleaning.
Use tensorfleet-vacuum with backend real_vacuum and list room/segment targets as read-only inventory. Do not start cleaning.
Use tensorfleet-vacuum with backend simulation and check whether room cleaning for Kitchen is ready. Do not start cleaning. If Kitchen is unknown, say so.
Use tensorfleet-vacuum with backend simulation and start cleaning room Kitchen. First check readiness internally. If Kitchen is unknown or not ready, refuse and explain blockers.
Use tensorfleet-vacuum with backend simulation and start cleaning room target id room-kitchen. First check readiness internally, then dispatch only if ready.
Use tensorfleet-vacuum with backend simulation and start zone cleaning for zone id zone-desk. First check readiness internally, then dispatch only if ready.
Use tensorfleet-vacuum with backend simulation and start zone cleaning without giving a zone. It should refuse and ask for the missing zone.
Use tensorfleet-vacuum with backend simulation and start room cleaning for an ambiguous room name. It should refuse and list matching candidates.
Use tensorfleet-vacuum with backend real_vacuum and start room cleaning for segment 3. It should refuse because real-vacuum room/zone writes are still disabled.
Use tensorfleet-vacuum with backend real_vacuum and check whether segment cleaning for segment 3 is supported. Do not start cleaning.
Use tensorfleet-vacuum with backend simulation and check whether zone cleaning is ready without giving a zone. It should ask for the missing zone instead of guessing.
Use tensorfleet-vacuum with backend simulation. Call start-navigation with target {x:1}. It must refuse and list missing y and theta. Do not invent values.
Use tensorfleet-vacuum with backend simulation. Call start-clean-area with area {type:"rectangle",x:0,y:0,width:-1,height:1}. It must refuse because the rectangle is invalid.
Use tensorfleet-vacuum with backend simulation. Call pause-mission. If no active mission or runtime config is unavailable, explain the blocker.
Use tensorfleet-vacuum with backend simulation. Call cancel-mission. If no active mission or runtime config is unavailable, explain the blocker.
Use tensorfleet-vacuum with backend real_vacuum. Call start-navigation with target {x:1,y:1,theta:0}. It must refuse and must not switch to simulation.
Use tensorfleet-vacuum with backend simulation and edit the map annotation for Kitchen. It should refuse because map mutation is still deferred.
Use tensorfleet-vacuum with backend simulation and explain whether target data came from normalized shared vacuum state, not raw backend APIs.
Use tensorfleet-vacuum with backend simulation. Try to move using raw Nav2. It must refuse because raw Nav2 is not an exposed TensorFleet tool path.
```

If `openclaw agent --json` stalls because of provider limits or gateway state, validate the registered plugin path with `bun run test:vacuum-runtime-smoke` and restart the gateway before retrying the agent prompts.
