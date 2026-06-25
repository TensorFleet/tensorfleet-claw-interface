# Vacuum Tool Implementation Process

This document records how the OpenClaw-facing TensorFleet vacuum tool was added, how it relates to the shared vacuum adapter code, and what to preserve when extending it. The vacuum tool is intentionally a thin agent-tool layer over the product-level adapter semantics that already exist in the TensorFleet UI work.

## Goals

- Expose a `tensorfleet-vacuum` tool for agents.
- Default to the simulation backend first.
- Support both simulation and real-vacuum paths behind one product-level contract.
- Reuse shared vacuum adapter semantics instead of reimplementing backend normalization in the tool package.
- Follow the existing drone tool shape: schema, executor, package export, OpenClaw plugin registration, and skill guidance.

## Commit Trail

Main repo branch: `feature/tool-vacuum`

- `2c67e85` added the first OpenClaw vacuum tool and schema. This version proved the tool surface but carried much of the adapter and normalization logic directly in `packages/tensorfleet-tools/src/tools/vacuum.ts`.
- `b8bd49f` replaced the embedded normalization with the shared adapter in the `tensorfleet-util` submodule. The tool became a thin facade over `createVacuumAdapter`, `normalizeVacuumBackend`, and `normalizeVacuumTimeout`.
- `85eeb04` fixed Valetudo integration regressions by adding the lightweight `get-health` path and by preserving structured `VacuumCommandResult` success/error handling.

Submodule: `packages/tensorfleet-tools/packages/tensorfleet-util`

- `699f52c` added shared vacuum adapter semantics: common state, commands, capabilities, map types, backend mappers, and a Node runtime adapter.
- `2d85838` fixed Valetudo runtime command dispatch from the shared Node runtime.

The current main repo points the `tensorfleet-util` submodule at `2d85838`.

## Existing Pattern: Drone Tool

The drone tool is the template for adding agent tools:

- `packages/tensorfleet-tools/schema/tensorfleet.drone.input.json` defines the agent-visible JSON schema.
- `packages/tensorfleet-tools/src/tools/drone.ts` hydrates config, opens the ROS connection with `withRosConnection`, calls shared runtime/controller code from `tensorfleet-util`, and returns text JSON.
- `packages/tensorfleet-tools/src/tools/drone-executor.ts` is a thin executor wrapper.
- `packages/tensorfleet-tools/src/index.ts` exports the executor and schema.
- `packages/tensorfleet-openclaw-plugin/src/index.ts` registers the OpenClaw tool.
- `packages/tensorfleet-openclaw-plugin/openclaw.plugin.json` lists the tool contract.
- `packages/tensorfleet-openclaw-plugin/skills/tensorfleet-telemetry-read/SKILL.md` tells agents when and how to use it.

The vacuum tool follows the same public integration path, but differs internally because it has two interchangeable backends instead of one ROS-only controller.

## Shared Adapter Source

The vacuum adapter began in `~/vscode-tensorfleet/panels-standalone/src/vacuum-adapter`. That UI adapter already had the right boundary:

```ts
export type VacuumAdapter = {
  snapshot: VacuumAdapterSnapshot;
  sendCommand: (command: VacuumCommand) => Promise<VacuumCommandResult>;
};
```

The important design choice was to move backend semantics into `tensorfleet-util` rather than copying UI-only mappers into the agent tool. In this repo the shared code now lives under:

- `packages/tensorfleet-tools/packages/tensorfleet-util/src/vacuum/adapter.ts`
- `packages/tensorfleet-tools/packages/tensorfleet-util/src/vacuum/state.ts`
- `packages/tensorfleet-tools/packages/tensorfleet-util/src/vacuum/commands.ts`
- `packages/tensorfleet-tools/packages/tensorfleet-util/src/vacuum/capabilities.ts`
- `packages/tensorfleet-tools/packages/tensorfleet-util/src/vacuum/mapGrid.ts`
- `packages/tensorfleet-tools/packages/tensorfleet-util/src/vacuum/node-runtime.ts`
- `packages/tensorfleet-tools/packages/tensorfleet-util/src/vacuum/backends/turtlebot4-nav2/*`
- `packages/tensorfleet-tools/packages/tensorfleet-util/src/vacuum/backends/valetudo/*`

The UI adapter remains useful reference material, especially:

- `~/vscode-tensorfleet/panels-standalone/src/vacuum-adapter/useVacuumAdapter.ts`
- `~/vscode-tensorfleet/panels-standalone/src/vacuum-adapter/backends/turtlebot4-nav2/useTurtleBot4Nav2Adapter.ts`
- `~/vscode-tensorfleet/panels-standalone/src/vacuum-adapter/backends/valetudo/useValetudoAdapter.ts`
- `~/vscode-tensorfleet/panels-standalone/src/vacuum-adapter/backends/valetudo/runtimeClient.ts`

## Backend Model

The agent-facing schema accepts friendly backend names:

- `simulation`
- `real_vacuum`
- `turtlebot4_nav2`
- `valetudo`

`normalizeVacuumBackend` maps those into internal backend ids:

- `simulation`, `turtlebot4-nav2`, and `turtlebot4_nav2` become `turtlebot4_nav2`.
- `real_vacuum`, `real-vacuum`, and `valetudo` become `valetudo`.

Agents should now pass the backend explicitly. `simulation` remains the normal product path for the TurtleBot4/Nav2 VM backend, but omitting the backend returns a structured `invalid_state` result in the discovery/readiness flow instead of silently guessing.

## Runtime Routing

`packages/tensorfleet-tools/src/tools/vacuum.ts` resolves runtime config from tool params first, then config-store/global auth:

- Auth token: `token`, `TENSORFLEET_JWT`, process env `TENSORFLEET_JWT`, config-store `TENSORFLEET_JWT`, then `getGlobalAuthInfo()?.token`.
- VM Manager URL: `vmManagerUrl`, `TENSORFLEET_VM_MANAGER_URL`, process env `TENSORFLEET_VM_MANAGER_URL`, then config-store `TENSORFLEET_VM_MANAGER_URL`.
- Direct runtime URL: `runtimeUrl`, `TENSORFLEET_VALETUDO_RUNTIME_URL`, process env `TENSORFLEET_VALETUDO_RUNTIME_URL`, then config-store `TENSORFLEET_VALETUDO_RUNTIME_URL`.
- Backend: `backend`, `TENSORFLEET_VACUUM_BACKEND`, process env `TENSORFLEET_VACUUM_BACKEND`, then config-store `TENSORFLEET_VACUUM_BACKEND`.
- Timeout: `timeoutMs`, normalized by `normalizeVacuumTimeout`.

`routeMode` defaults to `direct` only when `runtimeUrl` is supplied. Otherwise it defaults to `vm-manager`.

The discovery action reports config/auth presence and source without echoing token or URL values. VM Manager routing requires both TensorFleet auth and `TENSORFLEET_VM_MANAGER_URL`; direct real-vacuum routing requires a runtime URL. Missing values are returned as structured `not_authenticated` or `unavailable` results.

For Valetudo:

- `vm-manager` route calls `<vmManagerUrl>/vms/self/tensorfleet/api/v1/valetudo/{health|snapshot|command}`.
- `direct` route calls `<runtimeUrl>/api/v1/valetudo/{health|snapshot|command}`.

For simulation:

- The shared runtime uses the existing `ros2Bridge`.
- The tool passes `withRosConnection(id, params, fn)` into `createVacuumAdapter` so simulation reads participate in the same connection lifecycle as other TensorFleet ROS tools.

## Agent Tool Surface

Schema: `packages/tensorfleet-tools/schema/tensorfleet.vacuum.input.json`

Supported actions:

- `get-supported-actions`
- `get-health`
- `get-snapshot`
- `get-capabilities`
- `get-map-summary`
- `get-map-targets`
- `get-mission-state`
- `send-command`

Currently exposed command inputs:

- `start_cleaning`
- `pause`
- `resume`
- `stop`
- `return_to_dock`
- `set_fan_speed`
- `set_water_usage`

The shared command model is broader than the public schema. The schema intentionally exposes a smaller command set while map target cleaning and richer mission commands continue to mature.

`get-supported-actions` is the Step 0 + Step 1 discovery/readiness action. It does not open ROS, contact Valetudo, or move hardware. It returns:

- selected backend and normalized backend adapter
- runtime/auth/config availability by source, with secrets and URLs omitted
- read-only callable actions
- write-capable but gated actions
- movement-start callable actions, currently empty in this step
- mission-control callable actions, currently empty in this step
- supported but currently unavailable actions
- deferred actions that are intentionally not callable
- unsupported actions for the selected backend
- `canMoveVacuumNow`, currently `false` unless a future pass adds an explicit safe movement gate

Ask OpenClaw what TensorFleet vacuum actions are available by calling:

```json
{
  "action": "get-supported-actions",
  "backend": "simulation"
}
```

For the real-vacuum integration path, call:

```json
{
  "action": "get-supported-actions",
  "backend": "real_vacuum"
}
```

This rollout step is discovery/readiness only. It does not add new movement-start commands or new real-hardware control behavior.

## Tool Implementation Flow

`vacuumTool(id, params)` follows this sequence:

1. Hydrate config-store from explicit params.
2. If `action` is `get-supported-actions`, return static discovery plus backend/config/auth status without opening runtime connections.
3. Resolve `VacuumRuntimeConfig`; missing backend returns `invalid_state`.
4. Preflight auth/runtime config; missing auth or VM Manager URL returns structured `not_authenticated` / `unavailable` instead of falling back to localhost.
5. For Valetudo `get-health`, call `readVacuumRuntimeHealth(config)` directly. This avoids requiring a full snapshot when the runtime or source is degraded.
6. Otherwise call `createVacuumAdapter(config, { rosBridge, withRosConnection })`.
7. Convert the requested action into a response from the adapter snapshot, or build a `VacuumCommand` and call `adapter.sendCommand`.
8. Return OpenClaw-compatible text content containing formatted JSON.
9. On errors, return structured JSON with `success: false`, `action`, `error`, and `timestamp`.

The key implementation rule is that `vacuum.ts` should select and shape the tool response, not own backend semantics. Backend-specific behavior belongs in the shared adapter.

## Response Shaping

The tool adds a small backend label to every successful response:

- Simulation responses report `backend: "simulation"`, `backendAdapter: "turtlebot4_nav2"`, `backendLabel: "Simulation"`.
- Real-vacuum responses report `backend: "real_vacuum"`, `backendAdapter: "valetudo"`, `backendLabel: "Real vacuum"`.

Diagnostics are opt-in:

- `includeDiagnostics` includes normalized diagnostics.
- `includeRawDiagnostics` keeps raw backend diagnostics when diagnostics are already included.
- By default, snapshot responses omit diagnostics to keep agent context smaller.

Map responses are also compact by default:

- `includePreview` includes lightweight layered preview data in `get-map-summary`.
- `includeGeometry` includes target geometry in `get-map-summary` and `get-map-targets`.
- Without geometry, targets are returned as identifiers and labels so agents do not receive large shapes unless needed.

## Simulation Backend

The simulation backend is `turtlebot4_nav2`.

The Node runtime reads from ROS and normalizes the result into the shared snapshot:

- Available topics/services from `ros2Bridge`.
- `/map` occupancy grid.
- `/battery_state` or `/battery`.
- `/vacuum_mission/get_snapshot` when advertised.
- `/vacuum_map_annotations/get_snapshot` when advertised.

Simulation command dispatch currently returns explicit unsupported command results for the public basic vacuum commands. This is intentional: the first agent tool surface is read-oriented for simulation, while command semantics are guarded by capabilities.

## Valetudo Backend

The real-vacuum backend is `valetudo`.

The shared runtime:

- Reads health from `GET /health`.
- Reads full state from `GET /snapshot`.
- Dispatches commands to `POST /command`.
- Maps Valetudo runtime snapshots into the same `VacuumAdapterSnapshot` shape used by simulation.
- Maps runtime command failures into structured `VacuumCommandError` codes such as `unsupported`, `unavailable`, `invalid_state`, `stale_source`, `runtime_offline`, `source_unreachable`, and `backend_error`.

The Valetudo command regression fix matters because command names differ across the runtime boundary. For example, `resume` may map to `resume` when the runtime advertises it, otherwise it maps to `start_cleaning`. Mission-level aliases such as `pause_mission`, `resume_mission`, and `cancel_mission` are also mapped to basic Valetudo commands when appropriate.

## OpenClaw Registration

Adding the tool required three OpenClaw/plugin changes:

- Export `executeVacuumTool` and `vacuumSchema` from `packages/tensorfleet-tools/src/index.ts`.
- Register `tensorfleet-vacuum` in `packages/tensorfleet-openclaw-plugin/src/index.ts`.
- Add `tensorfleet-vacuum` to `packages/tensorfleet-openclaw-plugin/openclaw.plugin.json`.

Agent guidance also needed to be updated in `packages/tensorfleet-openclaw-plugin/skills/tensorfleet-telemetry-read/SKILL.md` so agents prefer `tensorfleet-vacuum` over raw ROS when handling product-level vacuum requests.

For Step 0 + Step 1, the skill tells agents to call `get-supported-actions` with an explicit backend before answering capability or movement-readiness questions. The discovery response is the authoritative way to answer whether the agent can move the vacuum right now.

## OpenClaw Tool/Plugin Read-State Alignment

The active TensorFleet vacuum integration path is the OpenClaw plugin tool `tensorfleet-vacuum`, not OpenClaw-managed MCP. The vacuum tool should follow the same package shape as the existing drone tool:

- JSON schema in `packages/tensorfleet-tools/schema/tensorfleet.vacuum.input.json`.
- Tool executor in `packages/tensorfleet-tools/src/tools/vacuum-executor.ts`.
- Product behavior in `packages/tensorfleet-tools/src/tools/vacuum.ts`, delegated to the shared vacuum adapter/node runtime.
- Package exports from `packages/tensorfleet-tools/src/index.ts`.
- Plugin runtime registration in `packages/tensorfleet-openclaw-plugin/src/index.ts`.
- Manifest contract in `packages/tensorfleet-openclaw-plugin/openclaw.plugin.json`.
- Skill guidance that tells agents to use `tensorfleet-vacuum` before raw telemetry.

The MCP detour was reverted for this rollout. The VS Code MCP server can continue to exist for unrelated pre-existing MCP functionality, but new vacuum discovery/read-state behavior should not be added or validated through MCP for this step.

OpenClaw plugin smoke prompt:

```text
What is the vacuum status?
Where is the robot?
Is there a map?
Is there an active mission?
What is the navigation state?
Can you move the vacuum right now?
```

Expected no-credential answer:

- selected backend is `simulation` when the agent/tool call passes `backend: "simulation"`
- auth/runtime status reports missing `TENSORFLEET_JWT` and `TENSORFLEET_VM_MANAGER_URL`
- movement is not available
- `tensorfleet-vacuum` returns structured `not_authenticated`, `invalid_state`, or `unavailable` responses instead of guessing or falling back to localhost
- no token, URL, private IP, or endpoint value is printed

## TypeScript Path Note

`packages/tensorfleet-tools/tsconfig.json` adds a path mapping for:

```json
"tensorfleet-util/vacuum/node-runtime": [
  "packages/tensorfleet-util/src/vacuum/node-runtime.ts"
]
```

This lets the tool import the Node-specific adapter entrypoint without changing the public root exports for all `tensorfleet-util` consumers.

## Implementation Checklist

Use this order when repeating or extending the pattern:

1. Define or update shared product-level types in `tensorfleet-util/src/vacuum`.
2. Put backend-specific mapping and command translation under `backends/<backend>`.
3. Expose one Node runtime factory that returns `VacuumAdapter`.
4. Add the tool schema in `packages/tensorfleet-tools/schema`.
5. Add the tool implementation in `packages/tensorfleet-tools/src/tools`.
6. Add the executor wrapper.
7. Export executor and schema from `packages/tensorfleet-tools/src/index.ts`.
8. Register the OpenClaw tool in plugin source and manifest.
9. Update the agent skill instructions with default backend, auth/VM expectations, and write-safety rules.
10. Bump and verify submodule commits.

## Current Limitations

- Simulation is read-oriented for agent use; basic cleaning commands return explicit unsupported results from the TurtleBot4/Nav2 adapter.
- Discovery reports movement availability as false in Step 0 + Step 1 and does not advertise deferred actions as callable.
- Targeted room, segment, and zone cleaning are present in shared command semantics but intentionally not exposed in the current public schema.
- Direct Valetudo runtime use requires an explicit `runtimeUrl` or configured runtime URL.
- `get-health` has a lightweight Valetudo-only path; simulation health comes from the adapter snapshot and therefore opens the ROS connection.

## Extension Guidance

Keep future additions inside the shared adapter first. The tool should stay small: validate public inputs, resolve config, call the adapter, and shape compact responses for agents. If a new backend field is useful to agents, normalize it into `VacuumAdapterSnapshot` or `VacuumCommandResult` before exposing it through the tool.
