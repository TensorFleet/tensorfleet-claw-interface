# Progress Report - Vacuum OpenClaw plugin correction
Current report date: 2026-06-25.

## 1. What changed

- Changed `packages/tensorfleet-openclaw-plugin/src/index.ts` from the legacy `defineToolPlugin` metadata wrapper to the current `definePluginEntry({ register(api) { api.registerTool(...) } })` pattern used by current OpenClaw tool plugins.
- Kept `tensorfleet-vacuum` as a thin OpenClaw plugin facade over `tensorfleet-tools` and the shared vacuum adapter/node runtime.
- Updated the plugin smoke test to verify real runtime registration of `tensorfleet-vacuum`, manifest contract alignment, and the safe `get-supported-actions` discovery response.
- Updated plugin README, skill guidance, `docs/vacuum-tool-implementation.md`, and `/home/shane/docs/vacuum/OPENCLAW_MCP_INTEGRATION.md` to state that MCP is not the primary vacuum integration path.
- Reverted the VS Code MCP detour in `/home/shane/vscode-tensorfleet/src/mcp-server.ts` by restoring the file to the parent of commit `2e28a4a` (`Expose vacuum discovery MCP tool`), removing `vacuum_get_supported_actions` from the MCP server.
- Removed the uncommitted MCP read-tool regression script/package script from the earlier detour and cleared the saved OpenClaw MCP vacuum filter/config. The `tensorfleet` MCP server entry remains for pre-existing MCP use, now without vacuum-specific env or include filters.
- Left unrelated pre-existing VS Code MCP infrastructure and existing `out` to `dist` documentation/config edits untouched.

## 2. Product behavior

- The verified vacuum path is now the OpenClaw plugin tool `tensorfleet-vacuum`.
- The tool still starts with `action: "get-supported-actions"` and an explicit backend such as `backend: "simulation"`.
- `simulation`/`turtlebot4_nav2` normalize to `turtlebot4_nav2`; `real_vacuum`/`valetudo` normalize to `valetudo`.
- Discovery keeps `movementStartCallableTools`, `missionControlCallableTools`, and state-changing callable actions empty, and `canMoveVacuumNow` remains `false`.
- Missing backend/auth/runtime config is reported as structured `invalid_state`, `not_authenticated`, or `unavailable` state by the tool instead of guessing or falling back to localhost.
- OpenClaw `plugins inspect` without `--runtime` is snapshot-only and still shows contracts but empty runtime `tools`; `plugins inspect --runtime` imports the plugin and reports all ten registered TensorFleet tools including `tensorfleet-vacuum`. Built-in tool-only plugins such as `file-transfer` also report `shape: "non-capability"` in this OpenClaw version, so that label is not treated as a vacuum registration failure.

## 3. Still deferred

- No movement-start behavior was added.
- No mission-control write tools were added.
- No real-hardware control was added.
- No raw backend tools, raw ROS/Nav2/Foxglove/Valetudo endpoints, arbitrary HTTP, shell, filesystem, VM private endpoint, token, or URL exposure was added.
- Live simulation state validation against VM Manager remains blocked until a usable VM Manager URL/runtime is selected.
- The `tensorfleet-vacuum` schema still includes the existing `send-command` action, but discovery does not advertise movement-start or mission-control commands as callable in this rollout step.

## 4. Validation

- `bun run --filter tensorfleet-tools build` - completed and produced the `tensorfleet-tools` bundle; nested `tensorfleet-ros`/auth TypeScript build still emitted pre-existing errors, so this is not a clean nested workspace type build.
- `bun run --filter tensorfleet-tools test:vacuum-discovery` - passed; covers supported-action discovery, backend alias normalization, missing backend/config/auth behavior, no secret leakage, forbidden raw tool names, and empty movement-start callable tools.
- `bun run --filter tensorfleet-openclaw-plugin build` - passed with existing esbuild direct-`eval` warnings from bundled dependencies.
- `bunx tsc -p packages/tensorfleet-openclaw-plugin/tsconfig.json --noEmit` - passed.
- `bun run --filter tensorfleet-openclaw-plugin test:discovery-smoke` - passed; verifies runtime `register(api).registerTool(...)` registration and the `tensorfleet-vacuum` discovery response.
- `openclaw plugins list` - passed; `tensorfleet-openclaw-plugin` is enabled from `~/tensorfleet-claw-interface/packages/tensorfleet-openclaw-plugin/dist/dist/index.js`.
- `openclaw plugins inspect tensorfleet-openclaw-plugin --json` - passed in snapshot mode; reports manifest contracts including `tensorfleet-vacuum`, but `imported: false`, `toolNames: []`, and `tools: []` because runtime modules are not loaded.
- `timeout 15s openclaw plugins inspect tensorfleet-openclaw-plugin --runtime --json` plus JSON parsing - emitted complete runtime JSON; parsed result shows `imported: true`, `status: "loaded"`, ten `toolNames`, ten runtime `tools`, no diagnostics, and includes `tensorfleet-vacuum`. The timeout wrapper was needed because the CLI process stayed open after printing JSON.
- `openclaw agent --agent main --session-key agent:main:tensorfleet-vacuum-plugin-smoke-20260625 --message 'Use the OpenClaw plugin tool tensorfleet-vacuum, not MCP, to call get-supported-actions for backend simulation...' --timeout 150 --json` - passed; tool summary shows one call to `tensorfleet-vacuum`, no failures, and the answer kept `canMoveVacuumNow: false`.
- `openclaw mcp set tensorfleet '{"command":"node","args":["dist/mcp-server.js"],"cwd":"/home/shane/vscode-tensorfleet"}'` - passed; removed the vacuum-specific MCP env/filter while keeping the pre-existing server entry.
- `openclaw mcp show tensorfleet` - passed; server now has only command `node`, args `dist/mcp-server.js`, and cwd `/home/shane/vscode-tensorfleet`.
- `bun run build:extension` in `/home/shane/vscode-tensorfleet` - passed after removing the MCP vacuum tool.
- `bunx tsc -p ./ --noEmit` in `/home/shane/vscode-tensorfleet` - passed.
- `env | rg '^TENSORFLEET_(JWT|VM_MANAGER_URL|VALETUDO_RUNTIME_URL)=' || true` - no output in this shell.
- `git diff --check` in `/home/shane/tensorfleet-claw-interface` - passed.
- `git diff --check` in `/home/shane/vscode-tensorfleet` - passed.
