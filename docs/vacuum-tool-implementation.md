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

The VS Code extension consumes the shared pure modules through local compatibility shims. Extension-local adapter entrypoints remain UI/client code, especially:

- `~/vscode-tensorfleet/panels-standalone/src/vacuum-adapter/useVacuumAdapter.ts`
- `~/vscode-tensorfleet/panels-standalone/src/vacuum-adapter/backends/turtlebot4-nav2/useTurtleBot4Nav2Adapter.ts`
- `~/vscode-tensorfleet/panels-standalone/src/vacuum-adapter/backends/valetudo/useValetudoAdapter.ts`
- `~/vscode-tensorfleet/panels-standalone/src/vacuum-adapter/backends/valetudo/runtimeClient.ts`

## Vacuum Shared-Core Boundary

`tensorfleet-util/vacuum` is the shared vacuum control foundation for tools, agents, and UI clients. It owns shared product-level semantics: commands, capabilities, state, errors, mapGrid, pure backend mappers, normalized runtime contracts, and the Node runtime used by agent/tool flows. It must not depend on the VS Code extension UI, and future backend-neutral vacuum logic should start here.

`vscode-tensorfleet` is one UI client of that foundation, not the owner of vacuum semantics. It owns React hooks, polling, browser fetch runtime clients, webview config, localStorage, VS Code SecretStorage/auth injection, and rendering/presentation. Its pure vacuum modules are compatibility shims to `tensorfleet-util/vacuum`; extension-specific hooks and runtime clients stay local.

`tensorfleet-tools` and `tensorfleet-vacuum` own the agent/tool behavior: OpenClaw schema, tool response shaping, safety gates, Node runtime config/env handling, and command dispatch through the product-level runtime. They must not depend on `vscode-tensorfleet` or extension-local adapter code.

Future development rule:

```text
If the change is product-level vacuum behavior, add it to tensorfleet-util/vacuum first.
If it is OpenClaw-specific response shape or tool policy, add it to tensorfleet-tools.
If it is UI lifecycle/presentation, keep it in vscode-tensorfleet.
```

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

The OpenClaw plugin manifest currently has an empty `configSchema`, so plugin config is not a runtime-value source. In OpenClaw, pass these values as explicit `tensorfleet-vacuum` tool parameters or make them available to the gateway process environment/config-store/global auth before the tool call. The discovery action reports config/auth presence and source without echoing token or URL values. VM Manager routing requires both TensorFleet auth and `TENSORFLEET_VM_MANAGER_URL`; direct real-vacuum routing requires a runtime URL. Missing values are returned as structured `not_authenticated` or `unavailable` results. There is no silent localhost fallback.

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
- `get-navigation-state`
- `get-pose`
- `check-navigation-readiness`
- `check-clean-area-readiness`
- `start-navigation`
- `start-clean-area`
- `pause-mission`
- `resume-mission`
- `cancel-mission`
- `retry-mission-step`
- `skip-mission-step`
- `send-command`

Currently exposed command inputs:

- `start_cleaning`
- `pause`
- `resume`
- `stop`
- `return_to_dock`
- `set_fan_speed`
- `set_water_usage`

The shared command model is broader than the public schema. The schema intentionally exposes explicit, gated simulation writes for navigation start, rectangular Clean Area start, and active mission controls. Room/zone starts, arbitrary waypoint tools, map editing, real-vacuum writes, and raw backend controls remain deferred. `send-command` is retained only for compatibility and returns a structured refusal instead of acting as a backdoor command path.

`get-supported-actions` is the discovery action. It does not open runtime connections or move hardware. It returns:

- selected backend and normalized backend adapter
- runtime/auth/config availability by source, with secrets and URLs omitted
- read-only callable actions
- write-capable but gated actions
- movement-start callable actions: `start-navigation` and `start-clean-area` for the simulation backend, with current blockers
- mission-control callable actions: pause/resume/cancel/retry/skip for the simulation backend, available only when the active mission exposes the matching action
- supported but currently unavailable actions
- deferred actions that are intentionally not callable
- unsupported actions for the selected backend
- `canMoveVacuumNow`, which remains `false` when runtime/config/readiness/snapshot blockers exist even though explicit movement-start actions are present

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

This rollout step adds gated simulation-only writes for `start-navigation`, `start-clean-area`, `pause-mission`, `resume-mission`, `cancel-mission`, `retry-mission-step`, and `skip-mission-step`. It does not add real-hardware control, room/zone starts, map editing, MCP vacuum tools, or raw backend access.

Readiness checks:

- `check-navigation-readiness` accepts `target: { "x": number, "y": number, "theta": number, "frameId"?: string, "label"?: string }`.
- `check-clean-area-readiness` accepts `area: { "type": "rectangle", "x": number, "y": number, "width": positive number, "height": positive number, "frameId"?: string, "label"?: string }`.
- Missing or malformed inputs return `ready: false` with `status: "needs_input"` or `status: "invalid_request"` and explicit missing/invalid fields.
- Valid inputs check backend selection, config/auth/runtime/source availability, map usability, pose/localization evidence, active mission compatibility, and normalized capability support/current availability.
- Readiness checks never dispatch navigation, coverage, cleaning, or mission-control commands. The explicit start actions call the same readiness logic internally and dispatch only after it reports ready.

## Tool Implementation Flow

`vacuumTool(id, params)` follows this sequence:

1. Hydrate config-store from explicit params.
2. If `action` is `get-supported-actions`, return static discovery plus backend/config/auth status without opening runtime connections.
3. Resolve `VacuumRuntimeConfig`; missing backend returns `invalid_state`.
4. Preflight auth/runtime config; missing auth or VM Manager URL returns structured `not_authenticated` / `unavailable` instead of falling back to localhost.
5. For Valetudo `get-health`, call `readVacuumRuntimeHealth(config)` directly. This avoids requiring a full snapshot when the runtime or source is degraded.
6. Otherwise call `createVacuumAdapter(config, { rosBridge, withRosConnection })`.
7. Convert the requested action into a compact response from the adapter snapshot, run write gates for explicit simulation commands, or return a structured compatibility refusal for `send-command`.
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

Map and snapshot responses are compact by default:

- `includePreview` includes lightweight layered preview data in `get-map-summary`.
- `includeGeometry` includes target geometry in `get-map-summary` and `get-map-targets`.
- Without geometry, targets are returned as identifiers and labels so agents do not receive large shapes unless needed.
- `get-snapshot` uses product-level summaries for robot, battery, map, pose, activity, mission, navigation, fault, and capabilities instead of returning full raw adapter payloads.
- `get-map-summary` reports availability, map identity, dimensions, resolution, cell counts/ratios, annotation counts, target counts, navigation usability, and Clean Area usability without including the full occupancy grid.

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

For Step 4 + Step 5, the skill tells agents to call `get-supported-actions` with an explicit backend before answering capability questions, then use read-only actions, readiness checks, and only the explicit gated simulation write actions. The discovery response remains authoritative for whether movement is possible right now; an action can exist while `canMoveVacuumNow` is `false` because runtime/config/readiness/snapshot blockers still apply.

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

## Direct Plugin Runtime Smoke

The plugin smoke at `packages/tensorfleet-openclaw-plugin/scripts/vacuum-runtime-smoke.test.mjs` validates the registered OpenClaw runtime object, not just private tool imports. It imports the built plugin bundle, calls `plugin.register(api)`, locates the registered `tensorfleet-vacuum` tool, and invokes `tool.execute(toolCallId, params)` with one short action per assertion.

Covered cases:

- write-action enum exposure for navigation, Clean Area, and mission control
- valid `start-navigation` input with missing auth/VM config returns structured `not_authenticated`
- valid `start-clean-area` input with missing auth/VM config returns structured `not_authenticated`
- invalid `start-navigation` target refuses before runtime preflight
- invalid `start-clean-area` rectangle refuses before runtime preflight
- `pause-mission` and `cancel-mission` with missing runtime config refuse without dispatch
- `real_vacuum` `start-navigation` refuses as unsupported and does not switch to simulation
- configured discovery can report tool-param config sources without leaking token or URL values

Each direct plugin call has a short timeout so regressions fail as test errors rather than leaving the process open. This smoke is the fallback validation when `openclaw agent --json` is unreliable because of provider/rate-limit state, gateway stale state, or agent planning latency.

OpenClaw plugin smoke prompt:

```text
What is the vacuum status?
Where is the robot?
Is there a map?
Is there an active mission?
What is the navigation state?
Can you move the vacuum right now?
```

Practical OpenClaw task prompts for this rollout:

```text
Use tensorfleet-vacuum with backend simulation. Call start-navigation with target {x:1.0,y:0.5,theta:0.0}. If runtime config is missing, refuse safely and list the missing config. Do not use any other tool.
Use tensorfleet-vacuum with backend simulation. Call start-clean-area with area {type:"rectangle",x:0,y:0,width:1.0,height:0.75}. If runtime config is missing, refuse safely and list the missing config. Do not use any other tool.
Use tensorfleet-vacuum with backend simulation. Call start-navigation with target {x:1}. It must refuse and list missing y and theta. Do not invent values.
Use tensorfleet-vacuum with backend simulation. Call start-clean-area with area {type:"rectangle",x:0,y:0,width:-1,height:1}. It must refuse because the rectangle is invalid.
Use tensorfleet-vacuum with backend simulation. Call pause-mission. If no active mission or runtime config is unavailable, explain the blocker.
Use tensorfleet-vacuum with backend simulation. Call cancel-mission. If no active mission or runtime config is unavailable, explain the blocker.
Use tensorfleet-vacuum with backend real_vacuum. Call start-navigation with target {x:1,y:1,theta:0}. It must refuse and must not switch to simulation.
Use tensorfleet-vacuum with backend simulation. Try to move using raw Nav2. It must refuse because raw Nav2 is not an exposed TensorFleet tool path.
```

Expected no-credential answer:

- selected backend is `simulation` when the agent/tool call passes `backend: "simulation"`
- auth/runtime status reports missing `TENSORFLEET_JWT` and `TENSORFLEET_VM_MANAGER_URL`
- movement may be callable as a gated simulation action, but `canMoveVacuumNow` is false when local auth/runtime/config or readiness blockers are present
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

- Simulation exposes only the explicit gated writes in this rollout: `start-navigation`, `start-clean-area`, and active mission controls. Legacy `send-command` and generic/basic vacuum commands are still refused as a backdoor control path.
- Discovery reports explicit simulation movement-start and mission-control actions as gated, but does not advertise deferred room/zone/raw actions as callable.
- Targeted room, segment, and zone cleaning are present in shared command semantics but intentionally not exposed in the current public schema.
- Navigation and Clean Area readiness actions are read-only preflight checks. They do not start navigation or coverage; only `start-navigation` and `start-clean-area` can dispatch after reusing those gates.
- Direct Valetudo runtime use requires an explicit `runtimeUrl` or configured runtime URL.
- `get-health` has a lightweight Valetudo-only path; simulation health comes from the adapter snapshot and therefore opens the ROS connection.

## Extension Guidance

Keep future product-level additions inside `tensorfleet-util/vacuum` first. The OpenClaw tool should stay small: validate public inputs, resolve config, call the shared runtime, and shape compact responses for agents. If a new backend field is useful to agents or UI clients, normalize it into `VacuumAdapterSnapshot` or `VacuumCommandResult` before exposing it through the tool.

## Historical Pre-6C Notes

The following fenced block is retained as old analysis. It is superseded by the shared-core boundary above: the extension now consumes shared pure vacuum modules through shims, while hooks/runtime clients remain extension-local.

current state :
```

• 1. Executive Summary
  tensorfleet-vacuum is not a standalone package. It is an OpenClaw tool registered by tensorfleet-openclaw-plugin and implemented in tensorfleet-tools.

  Current OpenClaw path is:

  OpenClaw plugin
    -> tensorfleet-tools
       -> tensorfleet-auth
       -> tensorfleet-ros
       -> tensorfleet-util
          -> vacuum/node-runtime
             -> turtlebot4_nav2 simulation via ROS
             -> valetudo via HTTP runtime

  The VS Code extension is not on the same vacuum implementation yet. It still uses its own local React-facing adapter at /home/shane/vscode-tensorfleet/panels-standalone/src/vacuum-adapter. The shared tensorfleet-util/src/vacuum implementation appears derived from that UI adapter, but the extension has not been refactored to consume it.

  2. Repository Relationship Diagram
  OpenClaw/tool repo:

  /home/shane/tensorfleet-claw-interface
    -> packages/tensorfleet-openclaw-plugin
       -> imports tensorfleet-tools
          -> imports tensorfleet-auth
          -> imports tensorfleet-ros
          -> imports tensorfleet-util
             -> drone controller/state
             -> vacuum adapter/node-runtime

  VS Code extension repo:

  /home/shane/vscode-tensorfleet
    -> extension host src/*
       -> tensorfleet-auth only
       -> VS Code SecretStorage / regions / webview injection
    -> panels-standalone
       -> tensorfleet-ros
       -> tensorfleet-util for drone/ROS/entity helpers
       -> local src/vacuum-adapter for vacuum UI

  3. Drone Tool Implementation Pattern
  Drone follows the established tool pattern:

  - Schema: packages/tensorfleet-tools/schema/tensorfleet.drone.input.json
  - Tool: packages/tensorfleet-tools/src/tools/drone.ts:1
  - Executor: packages/tensorfleet-tools/src/tools/drone-executor.ts:1
  - Export: packages/tensorfleet-tools/src/index.ts:9
  - Plugin registration: packages/tensorfleet-openclaw-plugin/src/index.ts:108
  - Runtime: DroneStateModel + DroneController from tensorfleet-util, ros2Bridge from tensorfleet-ros, withRosConnection.

  Drone is ROS-only and relatively thin: hydrate config, open ROS, run controller, return JSON text.

  4. Vacuum Tool Implementation Pattern
  Vacuum follows the same public pattern:

  - Schema: packages/tensorfleet-tools/schema/tensorfleet.vacuum.input.json
  - Tool: packages/tensorfleet-tools/src/tools/vacuum.ts:1
  - Executor: packages/tensorfleet-tools/src/tools/vacuum-executor.ts:1
  - Export: packages/tensorfleet-tools/src/index.ts:10
  - Plugin registration: packages/tensorfleet-openclaw-plugin/src/index.ts:115
  - Runtime: createVacuumAdapter, normalizeVacuumBackend, readVacuumRuntimeHealth from tensorfleet-util/vacuum/node-runtime.

  Vacuum intentionally diverges internally: it has backend selection, discovery, preflight, read shaping, real-vacuum refusal/gating, and simulation-only writes.

  5. Drone Vs Vacuum Table

   Layer                  Drone                            Vacuum                                                          Same?              Notes
  ━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Schema                 tensorfleet.drone.input.json     tensorfleet.vacuum.input.json                                   Yes                Vacuum schema is much broader.
  ─────────────────────  ───────────────────────────────  ──────────────────────────────────────────────────────────────  ─────────────────  ───────────────────────────────────────────────────────────────
   Executor               Thin wrapper                     Thin wrapper                                                    Yes                Both just call tool function.
  ─────────────────────  ───────────────────────────────  ──────────────────────────────────────────────────────────────  ─────────────────  ───────────────────────────────────────────────────────────────
   Tool file              drone.ts                         vacuum.ts                                                       Partly             Vacuum owns product gating/read shaping.
  ─────────────────────  ───────────────────────────────  ──────────────────────────────────────────────────────────────  ─────────────────  ───────────────────────────────────────────────────────────────
   Package export         executeDroneTool, droneSchema    executeVacuumTool, vacuumSchema                                 Yes                packages/tensorfleet-tools/src/index.ts:1.
  ─────────────────────  ───────────────────────────────  ──────────────────────────────────────────────────────────────  ─────────────────  ───────────────────────────────────────────────────────────────
   Plugin registration    tensorfleet-drone                tensorfleet-vacuum                                              Yes                Same array in plugin source.
  ─────────────────────  ───────────────────────────────  ──────────────────────────────────────────────────────────────  ─────────────────  ───────────────────────────────────────────────────────────────
   Manifest               Listed contract                  Listed contract                                                 Yes                packages/tensorfleet-openclaw-plugin/openclaw.plugin.json:17.
  ─────────────────────  ───────────────────────────────  ──────────────────────────────────────────────────────────────  ─────────────────  ───────────────────────────────────────────────────────────────
   Skill guidance         Drone section                    Vacuum section                                                  Yes                Same skill doc.
  ─────────────────────  ───────────────────────────────  ──────────────────────────────────────────────────────────────  ─────────────────  ───────────────────────────────────────────────────────────────
   Config/auth            Params -> config-store           Params/env/config-store/global auth                             Similar            Vacuum has more explicit source reporting.
  ─────────────────────  ───────────────────────────────  ──────────────────────────────────────────────────────────────  ─────────────────  ───────────────────────────────────────────────────────────────
   Runtime connection     withRosConnection always         ROS for simulation; HTTP for Valetudo                           Diverges           Healthy due multiple backends.
  ─────────────────────  ───────────────────────────────  ──────────────────────────────────────────────────────────────  ─────────────────  ───────────────────────────────────────────────────────────────
   Shared utility         Drone model/controller           Vacuum adapter/node-runtime                                     Yes                Both depend on tensorfleet-util.
  ─────────────────────  ───────────────────────────────  ──────────────────────────────────────────────────────────────  ─────────────────  ───────────────────────────────────────────────────────────────
   Tests                  Not obvious in current pass      Vacuum discovery/read/preflight/write + plugin smoke scripts    Vacuum stronger    See package scripts.
  ─────────────────────  ───────────────────────────────  ──────────────────────────────────────────────────────────────  ─────────────────  ───────────────────────────────────────────────────────────────
   Docs                   Basic README/skill               Dedicated implementation docs                                   Vacuum stronger    Docs reflect recent rollout.
  ─────────────────────  ───────────────────────────────  ──────────────────────────────────────────────────────────────  ─────────────────  ───────────────────────────────────────────────────────────────
   Smoke validation       Plugin registers tool            Plugin runtime smoke exists                                     Vacuum stronger    No live movement confirmed.

  6. Submodule Usage And Impact
  Current submodule pins:

  tensorfleet-claw-interface:
    auth  628465d
    ros   17cb799
    util  e8afbe6 feature/vacuum-tool-shared-core

  vscode-tensorfleet:
    auth  628465d
    ros   17cb799
    util  97fcb90 feature/drone-operations

  So auth and ROS match across repos. tensorfleet-util does not. The VS Code util checkout has no src/vacuum directory; the OpenClaw/tools util checkout does.

  If tensorfleet-util changes in tensorfleet-claw-interface, immediate users are tensorfleet-tools and then tensorfleet-openclaw-plugin after rebuild. Build chain is visible in packages/tensorfleet-tools/package.json:9: build util, build ros, generate schema types, bundle tools. Plugin also needs rebuild because it bundles/imports tensorfleet-tools.

  7. Extension Impact Analysis
  vscode-tensorfleet does import submodules directly, but split by host:

  - Extension host imports tensorfleet-auth only: /home/shane/vscode-tensorfleet/src/auth.ts:17, /home/shane/vscode-tensorfleet/src/vm-manager.ts:6.
  - Panels import tensorfleet-ros and tensorfleet-util: aliases in /home/shane/vscode-tensorfleet/panels-standalone/vite.config.ts:93.
  - Panels generate a .generated/tensorfleet-util mirror before build: /home/shane/vscode-tensorfleet/panels-standalone/package.json:11.

  Vacuum UI does not use tensorfleet-util/vacuum. It imports local files from ../../vacuum-adapter; selection happens in /home/shane/vscode-tensorfleet/panels-standalone/src/vacuum-adapter/useVacuumAdapter.ts:36.

  Therefore tensorfleet-util vacuum changes do not automatically benefit the extension UI today.

  8. Auth / VM / Runtime Config
  OpenClaw tools:

  - Auth stores token on globalThis through tensorfleet-auth.
  - Tool params hydrate tensorfleet-auth config-store.
  - ROS config path uses params/config-loader/config-store in packages/tensorfleet-tools/src/tools/ros-connect.ts:92.
  - Vacuum resolves backend/token/VM/runtime URL from params, env, config-store, global auth in packages/tensorfleet-tools/src/tools/vacuum.ts:254.

  VS Code extension:

  - Token lives in VS Code SecretStorage, not globalThis: /home/shane/vscode-tensorfleet/src/auth.ts:133.
  - VM state uses shared tensorfleet-auth VM helpers, but extension-local state and polling: /home/shane/vscode-tensorfleet/src/vm-manager.ts:295.
  - Webviews receive injected window.TENSORFLEET_* values: /home/shane/vscode-tensorfleet/src/extension.ts:2057.

  So there are two runtime config/state systems. That is acceptable for now, but it means OpenClaw and VS Code do not automatically share live credentials or selected VM state.

  9. Duplication / Source-Of-Truth Risks
  Duplication exists here:

  OpenClaw/shared:
    tensorfleet-util/src/vacuum/*

  Extension UI:
    panels-standalone/src/vacuum-adapter/*

  diff -qr showed many corresponding files differ, plus UI-only files (useVacuumAdapter, React hooks, runtimeClient, local annotation migration) and Node-only file (node-runtime.ts).

  Source of truth today is split:

  - OpenClaw vacuum source of truth: tensorfleet-util/src/vacuum.
  - Extension vacuum UI source of truth: panels-standalone/src/vacuum-adapter.

  10. Design Assessment
  Good foundation because OpenClaw vacuum now uses tensorfleet-tools and tensorfleet-util, matching the drone tool’s shared-runtime pattern while keeping OpenClaw plugin registration thin.

  Risk because vacuum semantics are duplicated across shared util and extension UI. Capability names, state shapes, mission behavior, and Valetudo command mapping can drift.

  Do not refactor everything yet because the extension adapter is React-hook based and includes UI/runtime behavior that should not be moved wholesale into Node utilities. The right split is shared pure contract/mappers/types in tensorfleet-util, with extension-local hooks and presentation state staying in the extension.

  Recommended architectural target: tensorfleet-util owns backend-neutral vacuum types, mappers, command semantics, runtime client contracts, and Node/browser-neutral helpers; extension owns React hooks, local storage, rendering, and operator workflow UI.

  11. Recommended Next Steps

  1. Sync vscode-tensorfleet’s panels-standalone/packages/tensorfleet-util to the OpenClaw util commit or branch only after reviewing browser build impact.
  2. Refactor extension vacuum imports gradually: start with shared types/commands/capabilities/state, not hooks.
  3. Keep node-runtime.ts tool/runtime-only.
  4. Keep useVacuumAdapter, polling hooks, local UI storage, and rendering extension-local.
  5. Add a small parity test comparing local extension adapter outputs against shared mapper fixtures before deleting local mapper copies.
  6. Rebuild in order after submodule changes: tensorfleet-util, tensorfleet-tools, tensorfleet-openclaw-plugin; for extension, run panel prepare/build because Vite consumes generated util.

  12. Files Inspected
  Key files inspected included:

  - packages/tensorfleet-openclaw-plugin/src/index.ts:1
  - packages/tensorfleet-openclaw-plugin/openclaw.plugin.json:1
  - packages/tensorfleet-tools/src/index.ts:1
  - packages/tensorfleet-tools/src/tools/drone.ts:1
  - packages/tensorfleet-tools/src/tools/vacuum.ts:1
  - packages/tensorfleet-tools/packages/tensorfleet-util/src/vacuum/node-runtime.ts:1
  - /home/shane/vscode-tensorfleet/panels-standalone/src/vacuum-adapter/useVacuumAdapter.ts:1
  - /home/shane/vscode-tensorfleet/src/auth.ts:1
  - /home/shane/vscode-tensorfleet/src/vm-manager.ts:1
  - /home/shane/vscode-tensorfleet/panels-standalone/vite.config.ts:1

  13. Commands Run And Results
  Read-only commands only. No files modified, no submodules synced, no tests run.

  Important results:

  git submodule status
  # claw-interface: auth 628465d, ros 17cb799, util e8afbe6
  # vscode-tensorfleet: auth 628465d, ros 17cb799, util 97fcb90

  git -C .../tensorfleet-util status --short
  # no output in both repos; submodule worktrees clean

  find /home/shane/vscode-tensorfleet/panels-standalone/packages/tensorfleet-util/src -maxdepth 2 -type f
  # no src/vacuum directory in VS Code util submodule

  diff -qr claw-interface/.../tensorfleet-util/src/vacuum vscode-tensorfleet/.../src/vacuum-adapter
  # many differing/copied counterparts; shared has node-runtime.ts, extension has React hooks/UI runtime files
  ```
