# Vacuum Shared-Core Migration Plan

## 1. Executive Summary

OpenClaw vacuum tools now follow the drone-style package/plugin path:

```text
tensorfleet-openclaw-plugin
  -> tensorfleet-tools
     -> tensorfleet-util/src/vacuum
```

The VS Code extension vacuum UI still uses its own local React-facing adapter under:

```text
/home/shane/vscode-tensorfleet/panels-standalone/src/vacuum-adapter
```

The goal is not to move the whole extension adapter into `tensorfleet-util`. The goal is to make `tensorfleet-util/src/vacuum` the shared source of truth for backend-neutral contract, command/capability/state types, pure mappers, and pure helpers, while keeping React hooks, polling, webview storage, ROS subscriptions, and VS Code config injection inside `vscode-tensorfleet`.

The smallest safe move is to sync the VS Code `tensorfleet-util` submodule to a commit containing `src/vacuum`, without changing extension imports, then add parity tests between the extension-local adapter and shared util. Do not add room/zone OpenClaw vacuum tools before this sync/parity work, because room/zone touches duplicated map annotation, coverage, target, and mission semantics.

## 2. Current Architecture Diagram

```text
OpenClaw vacuum
  -> tensorfleet-openclaw-plugin
     -> tensorfleet-tools/src/tools/vacuum.ts
        -> tensorfleet-util/src/vacuum
           -> vacuum/node-runtime.ts
              -> turtlebot4_nav2 via ros2Bridge + withRosConnection
              -> valetudo via Node HTTP runtime
```

```text
VS Code vacuum UI
  -> src/extension.ts injects window.TENSORFLEET_*
  -> panels-standalone/src/components/VacuumControl/*
     -> panels-standalone/src/vacuum-adapter/useVacuumAdapter.ts
        -> local TurtleBot4/Nav2 React hook + tensorfleet-ros
        -> local Valetudo React hook + browser fetch
```

Current `tensorfleet-util` submodule state from the investigation:

```text
tensorfleet-claw-interface:
  auth  628465d
  ros   17cb799
  util  e8afbe6 feature/vacuum-tool-shared-core

vscode-tensorfleet:
  auth  628465d
  ros   17cb799
  util  97fcb90 feature/drone-operations
```

The VS Code util checkout currently has no `src/vacuum` directory, so OpenClaw shared vacuum changes do not automatically affect the extension UI.

## 3. File Ownership Classification Table

Legend:

- `shared`: should live in `tensorfleet-util`
- `extension`: should stay in `vscode-tensorfleet`
- `node-only`: should stay tool/OpenClaw runtime only
- `review`: mixed concerns; extract carefully

| File | Current location | Proposed owner | Reason | Migration risk |
| ---- | ---------------- | -------------- | ------ | -------------- |
| `adapter.ts` | both | shared | Pure adapter type. | Low |
| `capabilities.ts` | both | shared | Capability descriptors and `createUnsupportedCapabilities()` are backend-neutral. | Low |
| `commands.ts` | both | shared | Shared util adds `VACUUM_COMMAND_NAMES`, making it a better runtime validation source. | Medium |
| `errors.ts` | both | shared | Pure command error/result types. | Low |
| `state.ts` | both | shared | Backend-neutral state model. | Low |
| `mapGrid.ts` | both | shared | Browser-safe pure grid parsing/metadata helper. | Low |
| `index.ts` | both | split | Shared root should export pure contract; extension root should also export hooks. | Medium |
| `messageUtils.ts` | extension | shared or review | Pure ROS-message normalization and duration formatting; not currently in util. | Low |
| `primaryState.ts` | extension | shared | Pure product-state derivation, useful outside UI. | Low |
| `node-runtime.ts` | shared | node-only | Imports Node `http`/`https` and owns Node runtime orchestration. | High if bundled |
| `backends/turtlebot4-nav2/runtimeTypes.ts` | shared | shared | Pure backend runtime shape/constants. | Low |
| `backends/turtlebot4-nav2/capabilityMapper.ts` | both | shared | Pure capability mapping and service/topic constants. | Medium |
| `backends/turtlebot4-nav2/stateMapper.ts` | extension | shared, after review | Pure-ish mapper, but imports Nav2 UI runtime types/helpers. Needs decoupling. | High |
| `backends/turtlebot4-nav2/commandDispatcher.ts` | extension | review | Command dispatch logic is useful, but currently coupled to `Nav2RuntimeState` and UI runtime calls. | High |
| `backends/turtlebot4-nav2/localAnnotationMigration.ts` | extension | extension | Webview `localStorage` migration. | Low |
| `backends/turtlebot4-nav2/useTurtleBot4Nav2Adapter.ts` | extension | extension | React hooks, polling, subscriptions, local state, `tensorfleet-ros`. | High |
| `backends/valetudo/capabilityMapper.ts` | both | shared | Pure Valetudo capability normalization. | Medium |
| `backends/valetudo/commandMapper.ts` | both | shared | Pure command/result mapping. | Medium |
| `backends/valetudo/runtimeCommandMapper.ts` | both | shared | Pure runtime command-name mapping. | Medium |
| `backends/valetudo/runtimeContract.ts` | both | shared | Pure runtime API contract types. | Low |
| `backends/valetudo/stateMapper.ts` | both | shared | Pure snapshot-to-boundary/state mapper. | Medium |
| `backends/valetudo/types.ts` | both | shared | Pure boundary/mapping types. | Low |
| `backends/valetudo/runtimeClient.ts` | extension | extension or later browser-runtime | Browser `fetch` + `window.TENSORFLEET_*`; not Node util. | Medium |
| `backends/valetudo/useValetudoAdapter.ts` | extension | extension | React polling hook. | High |

## 4. Browser Safety And Export Analysis

Browser-safe shared util files:

```text
adapter.ts
capabilities.ts
commands.ts
errors.ts
state.ts
mapGrid.ts
backends/valetudo/*
backends/turtlebot4-nav2/capabilityMapper.ts
backends/turtlebot4-nav2/runtimeTypes.ts
```

Node-only shared util file:

```text
node-runtime.ts
```

`node-runtime.ts` imports `http` and `https`, defines Node HTTP request behavior, and accepts a ROS runtime context. It must not be pulled into `panels-standalone`.

Extension-local runtime/UI files:

```text
useVacuumAdapter.ts
backends/turtlebot4-nav2/useTurtleBot4Nav2Adapter.ts
backends/turtlebot4-nav2/localAnnotationMigration.ts
backends/valetudo/useValetudoAdapter.ts
backends/valetudo/runtimeClient.ts
```

These files include React hooks, `window.localStorage`, browser `fetch`, webview global config, polling, and `tensorfleet-ros`.

Recommended export split:

```text
tensorfleet-util/vacuum
  -> browser-safe contract/types/mappers/helpers only

tensorfleet-util/vacuum/node-runtime
  -> Node/OpenClaw/runtime-only adapter factory

tensorfleet-util/vacuum/browser-runtime
  -> defer; only add later if multiple browser clients need a shared fetch runtime
```

Do not import `tensorfleet-util/vacuum/node-runtime` from any panel code. For first migration steps, prefer deep imports like:

```ts
import type { VacuumAdapterSnapshot } from "tensorfleet-util/vacuum/state";
import { VACUUM_COMMAND_NAMES } from "tensorfleet-util/vacuum/commands";
```

This reduces bundle risk compared with importing the whole `tensorfleet-util/vacuum` barrel.

## 5. Smallest Safe Sync Plan

### Stage A: Sync only, no import changes

Update `/home/shane/vscode-tensorfleet/panels-standalone/packages/tensorfleet-util` to a commit that contains `src/vacuum`.

Do not change extension imports yet. The extension should still use:

```text
panels-standalone/src/vacuum-adapter/*
```

Validation target:

```sh
bun run --cwd /home/shane/vscode-tensorfleet/panels-standalone prepare:tensorfleet-util
bun run --cwd /home/shane/vscode-tensorfleet/panels-standalone build
bun run --cwd /home/shane/vscode-tensorfleet compile
```

### Stage B: Add parity tests

Add tests comparing extension-local adapter outputs with shared util outputs before replacing imports.

Shared util should be the intended source of truth for:

- command names
- capability names/descriptors
- state model
- errors/result shapes
- map/grid helpers
- pure Valetudo mappers
- pure TurtleBot4 capability mapping

Extension-local should remain source of truth for:

- React hook lifecycle
- polling
- webview state
- local storage migration
- UI presentation and rendering behavior

### Stage C: Switch only pure shared imports

Replace extension local imports for:

```text
commands
capabilities
state
errors
mapGrid
```

Consider `messageUtils` and `primaryState` only after moving or duplicating them into shared util with parity tests.

### Stage D: Keep React hooks and UI runtime local

Keep these extension-local:

```text
useVacuumAdapter.ts
useTurtleBot4Nav2Adapter.ts
useValetudoAdapter.ts
runtimeClient.ts
localAnnotationMigration.ts
```

### Stage E: Replace backend mappers gradually

Start with Valetudo because its mapper files are pure and already exist in both trees.

TurtleBot4 state mapping needs more care because the extension mapper imports `Nav2RuntimeState` and `nav2RuntimeUtils`. Extract a shared, backend-neutral mapper input before replacing it.

## 6. Parity Test Plan

Existing extension test anchor:

```text
/home/shane/vscode-tensorfleet/scripts/vacuum-adapter-regression.ts
```

Recommended new parity test:

```text
/home/shane/vscode-tensorfleet/scripts/vacuum-shared-parity.ts
```

Recommended fixture directory:

```text
/home/shane/vscode-tensorfleet/scripts/fixtures/vacuum/
  turtlebot4-runtime-state.json
  turtlebot4-mission-snapshot.json
  turtlebot4-map-message.json
  valetudo-runtime-online.json
  valetudo-runtime-stale.json
  valetudo-runtime-offline.json
  valetudo-command-results.json
```

Test cases:

- `VACUUM_COMMAND_NAMES` covers all extension-local command names.
- `VacuumCommandResult` success/error shapes match.
- `VACUUM_CAPABILITY_NAMES` matches extension-local names.
- `createUnsupportedCapabilities()` outputs match.
- `buildVacuumMapMetadata()` outputs match.
- `parseVacuumMapGrid()` outputs match.
- Valetudo `mapValetudoCapabilities()` outputs match.
- Valetudo `mapVacuumCommandToValetudoRequest()` outputs match.
- Valetudo `mapValetudoRuntimeCommandResult()` outputs match.
- Valetudo `mapVacuumCommandToValetudoRuntimeCommandName()` outputs match.
- Valetudo `mapValetudoRuntimeSnapshotToBoundary()` and `mapValetudoState()` outputs match.
- Real-vacuum stale/offline/unavailable snapshots produce the same readiness/source/fault/activity summaries.
- TurtleBot4 `mapTurtleBot4Nav2Capabilities()` outputs match.
- TurtleBot4 state mapping parity after extracting or normalizing mapper input.
- Mission state, `activeMission`, `missions.recent`, available actions, readiness blockers match.
- Map targets and preview mapping match when layered map fixtures are present.
- Unsupported command behavior matches for both backends.

Suggested validation commands after test implementation:

```sh
bun run test:vacuum-adapter
bun run --cwd panels-standalone build
bun run compile
```

OpenClaw/tools regression commands after shared util changes:

```sh
bun run --filter tensorfleet-tools build
bun run --filter tensorfleet-tools test:vacuum-discovery
bun run --filter tensorfleet-tools test:vacuum-read-preflight
bun run --filter tensorfleet-tools test:vacuum-write-actions
bun run --filter tensorfleet-openclaw-plugin test:vacuum-runtime-smoke
```

## 7. Submodule Sync Mechanics

If VS Code util is advanced from:

```text
97fcb906444eaf7817794cfc62109624d418967b
```

to:

```text
e8afbe6677dfa898ed7d51496227da5c3c8dd09c
```

expected new files include:

```text
panels-standalone/packages/tensorfleet-util/src/vacuum/*
panels-standalone/packages/tensorfleet-util/src/vacuum/node-runtime.ts
panels-standalone/packages/tensorfleet-util/src/vacuum/backends/*
```

The newer util `package.json` also adds an explicit export:

```json
"./vacuum/node-runtime": {
  "types": "./dist/vacuum/node-runtime.d.ts",
  "import": "./dist/vacuum/node-runtime.js",
  "default": "./dist/vacuum/node-runtime.js"
}
```

`panels-standalone` generates `.generated/tensorfleet-util` from the submodule:

```text
panels-standalone/package.json
  prepare:tensorfleet-util
    typia generate --input packages/tensorfleet-util/src
      --output .generated/tensorfleet-util
      --project packages/tensorfleet-util/tsconfig.json
```

Vite alias:

```text
panels-standalone/vite.config.ts
  /^tensorfleet-util(\/.*)?$/ -> .generated/tensorfleet-util$1
```

Potential breakage:

- `typia generate` may now process `node-runtime.ts`.
- Accidental panel import of `tensorfleet-util/vacuum/node-runtime` would pull Node `http`/`https`.
- Importing the `tensorfleet-util/vacuum` barrel may include more mapper code than needed.
- Generated import suffixes may need verification in Vite/browser builds.
- Lockfiles may update if package metadata or dependency graph changes.

Read-only preflight commands:

```sh
git -C /home/shane/vscode-tensorfleet/panels-standalone/packages/tensorfleet-util fetch
git -C /home/shane/vscode-tensorfleet/panels-standalone/packages/tensorfleet-util log --oneline --decorate -20
git -C /home/shane/tensorfleet-claw-interface/packages/tensorfleet-tools/packages/tensorfleet-util rev-parse HEAD
git -C /home/shane/vscode-tensorfleet/panels-standalone/packages/tensorfleet-util rev-parse HEAD
```

Mutating sync commands for later only:

```sh
git -C /home/shane/vscode-tensorfleet/panels-standalone/packages/tensorfleet-util checkout e8afbe6677dfa898ed7d51496227da5c3c8dd09c
git -C /home/shane/vscode-tensorfleet status --short
bun run --cwd /home/shane/vscode-tensorfleet/panels-standalone prepare:tensorfleet-util
bun run --cwd /home/shane/vscode-tensorfleet/panels-standalone build
```

Rollback command for later only:

```sh
git -C /home/shane/vscode-tensorfleet/panels-standalone/packages/tensorfleet-util checkout 97fcb906444eaf7817794cfc62109624d418967b
```

## 8. Auth And VM Config Recommendation

Do not unify auth/VM runtime config now.

Keep these separate for now:

```text
OpenClaw/tools
  -> explicit params
  -> process env
  -> tensorfleet-auth config-store
  -> global auth
```

```text
VS Code extension
  -> VS Code SecretStorage
  -> extension-local VM polling/state
  -> webview window.TENSORFLEET_* injection
```

`tensorfleet-auth` is already the correct shared layer for OAuth core, regions, and VM manager client helpers. VS Code SecretStorage behavior should remain extension-local because it depends on VS Code APIs and UX. Moving it into shared code now would either contaminate shared packages with VS Code-specific imports or force a storage abstraction before there is enough demand.

Safe shared auth/config candidates:

- auth types
- region definitions
- VM manager client request/response helpers
- token shape/expiry helpers

Host-specific behavior:

- VS Code SecretStorage
- browser opening
- OpenClaw global auth cache
- process env/config-store precedence
- webview global injection

## 9. Drone Comparison And Lessons

Drone is cleaner today because both OpenClaw tools and extension UI already consume drone-related shared util code:

```text
tensorfleet-util/drone/drone-state-model
tensorfleet-util/drone/mission-control/drone-controller
tensorfleet-util/ros/*
```

OpenClaw drone uses:

```text
DroneStateModel
DroneController
ros2Bridge
withRosConnection
```

The extension drone path also imports `DroneStateModel`, `DroneController`, and ROS types/helpers from `tensorfleet-util`.

Vacuum is behind drone in shared-core adoption because its adapter was built in the extension first and then copied/derived into shared util for OpenClaw. The lesson from drone is: shared util should own robotics semantics and normalized contracts; host packages should own lifecycle, UI, process config, and presentation.

For vacuum, apply that lesson as:

```text
shared:
  types
  capabilities
  commands
  state
  pure mappers
  pure helpers

extension:
  React hooks
  polling
  localStorage
  webview config
  rendering

OpenClaw/tools:
  tool schema
  response shaping
  runtime preflight
  Node runtime config
```

## 10. Design Judgment

Pause room/zone OpenClaw feature work until shared-core sync and parity tests exist.

Current duplication is acceptable for narrow read/preflight maintenance or bug fixes. It is not a good base for adding room/zone tools, map edits, arbitrary waypoint tools, or real-vacuum writes because those changes would likely be implemented twice and reconciled later.

Room/zone tools are especially risky before sync because they depend on:

- map annotations
- map target geometry
- coverage areas
- active mission state
- mission control availability
- capability gates
- adapter-level command names

Best next engineering task:

```text
Sync VS Code tensorfleet-util to the shared vacuum-core commit, keep imports unchanged, and add parity tests.
```

## 11. Recommended Next Steps

### P0

- Sync VS Code `tensorfleet-util` to the vacuum-core commit in a dedicated branch.
- Verify `prepare:tensorfleet-util`, panel build, and extension compile.
- Add parity tests comparing local adapter and shared util for pure contracts/mappers.
- Keep extension imports unchanged until parity is green.

### P1

- Switch extension imports for `capabilities`, `commands`, `errors`, `state`, and `mapGrid`.
- Add `messageUtils` and `primaryState` to shared util if parity confirms they are host-neutral.
- Replace Valetudo pure mapper imports with shared util imports.

### P2

- Extract TurtleBot4 pure state mapping from extension-local `Nav2RuntimeState`.
- Consider a browser-runtime entrypoint for Valetudo fetch only if multiple browser clients need it.
- Resume room/zone OpenClaw tools after shared map/mission/capability parity is established.

## 12. Files Inspected

Main repo:

```text
/home/shane/tensorfleet-claw-interface/packages/tensorfleet-tools/packages/tensorfleet-util/src/vacuum/*
/home/shane/tensorfleet-claw-interface/packages/tensorfleet-tools/package.json
/home/shane/tensorfleet-claw-interface/packages/tensorfleet-tools/scripts/vacuum-capability-discovery.test.mjs
/home/shane/tensorfleet-claw-interface/packages/tensorfleet-tools/scripts/vacuum-read-preflight.test.mjs
```

VS Code repo:

```text
/home/shane/vscode-tensorfleet/panels-standalone/src/vacuum-adapter/*
/home/shane/vscode-tensorfleet/panels-standalone/package.json
/home/shane/vscode-tensorfleet/panels-standalone/vite.config.ts
/home/shane/vscode-tensorfleet/scripts/vacuum-adapter-regression.ts
```

## 13. Commands Run And Results

Read-only commands from the planning pass:

```sh
find packages/tensorfleet-tools/packages/tensorfleet-util/src/vacuum -type f -maxdepth 4 | sort
```

Result: shared util has vacuum contract files, Valetudo mappers, TurtleBot4 capability/runtime files, and `node-runtime.ts`.

```sh
find /home/shane/vscode-tensorfleet/panels-standalone/src/vacuum-adapter -type f -maxdepth 4 | sort
```

Result: extension has local contract files plus React hooks, browser runtime client, command dispatcher, state mapper, local annotation migration, `messageUtils`, and `primaryState`.

```sh
rg -n "^import|^export|from ['\"]|require\\(|node:|fs|http|https|process|window|localStorage|React|use[A-Z]|tensorfleet-ros|ros2Bridge" packages/tensorfleet-tools/packages/tensorfleet-util/src/vacuum
```

Result: `node-runtime.ts` is the shared util vacuum file with Node core `http`/`https` imports.

```sh
rg -n "^import|^export|from ['\"]|require\\(|node:|fs|http|https|process|window|localStorage|React|use[A-Z]|tensorfleet-ros|ros2Bridge" /home/shane/vscode-tensorfleet/panels-standalone/src/vacuum-adapter
```

Result: React, `window`, `localStorage`, `tensorfleet-ros`, and `ros2Bridge` appear in extension-local runtime/hook files.

```sh
diff -u packages/tensorfleet-tools/packages/tensorfleet-util/src/vacuum/commands.ts /home/shane/vscode-tensorfleet/panels-standalone/src/vacuum-adapter/commands.ts
```

Result: shared util has `VACUUM_COMMAND_NAMES`; extension local uses a union type only.

```sh
diff -u packages/tensorfleet-tools/packages/tensorfleet-util/src/vacuum/capabilities.ts /home/shane/vscode-tensorfleet/panels-standalone/src/vacuum-adapter/capabilities.ts
```

Result: no content differences found.

```sh
diff -u packages/tensorfleet-tools/packages/tensorfleet-util/src/vacuum/state.ts /home/shane/vscode-tensorfleet/panels-standalone/src/vacuum-adapter/state.ts
```

Result: only import suffix difference.

```sh
diff -u packages/tensorfleet-tools/packages/tensorfleet-util/src/vacuum/errors.ts /home/shane/vscode-tensorfleet/panels-standalone/src/vacuum-adapter/errors.ts
```

Result: only import suffix difference.

```sh
diff -u packages/tensorfleet-tools/packages/tensorfleet-util/src/vacuum/mapGrid.ts /home/shane/vscode-tensorfleet/panels-standalone/src/vacuum-adapter/mapGrid.ts
```

Result: only import suffix difference.

```sh
git status --short
```

Result during planning: `docs/vacuum-tool-implementation.md` was already modified before this planning/write-up task. This plan did not depend on changing it.
