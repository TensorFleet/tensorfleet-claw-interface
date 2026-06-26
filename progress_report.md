# Progress Report - Vacuum room zone target read preflight
Current report date: 2026-06-26.

## 1. What changed

- Added shared target semantics in `tensorfleet-util/vacuum`: normalized room/segment/zone target types, source metadata, readiness statuses, geometry validation, annotation-to-target mapping, runtime target mapping, and read-only target readiness helpers.
- Valetudo runtime target normalization now delegates to the shared target mapper, and simulation snapshots now derive room/zone targets from normalized map annotations.
- Added OpenClaw read-only actions: `get-room-targets`, `get-zone-targets`, `check-room-cleaning-readiness`, and `check-zone-cleaning-readiness`; existing `get-map-targets` now sits beside the room/zone inventory actions.
- Updated the vacuum schema, generated schema types, OpenClaw plugin discovery smoke, runtime smoke schema checks, plugin description, README prompts, and skill guidance.

## 2. Product behavior

- Agents can list normalized map targets, room/segment targets, and zone targets without starting cleaning.
- Agents can preflight a requested room or zone by id/name and receive structured blockers for missing, ambiguous, stale/unavailable, unsupported, invalid-geometry, or not-callable targets.
- Room/zone preflight is read-only and always reports `canDispatchCommand: false`; `start-room-cleaning`, `start-zone-cleaning`, and map annotation mutation remain deferred.
- Real-vacuum behavior remains conservative: target inventory is readable, but real-vacuum room/zone writes are blocked until normalized write support is explicitly enabled.
- Simulation target inventory comes from shared annotation semantics, not raw backend APIs.

## 3. Still deferred

- `start-room-cleaning` and `start-zone-cleaning`.
- Map annotation mutation/editing through OpenClaw.
- Real-vacuum write/control behavior for room/zone targets.
- Arbitrary waypoint tools and raw ROS/Nav2/Foxglove/Valetudo tool paths.
- MCP vacuum tools as a primary integration path.
- Live robot validation was not performed or claimed.

## 4. Validation

- `bun run --filter tensorfleet-tools build` - passed; the script still prints existing `tensorfleet-ros` TypeScript errors under its `|| true` build leg before completing `tensorfleet-tools`.
- `bun run --filter tensorfleet-tools test:vacuum-discovery` - passed.
- `bun run --filter tensorfleet-tools test:vacuum-read-preflight` - passed.
- `bun run --filter tensorfleet-tools test:vacuum-write-actions` - passed.
- `bun run --filter tensorfleet-tools test:vacuum-boundary` - passed.
- `bun run --filter tensorfleet-openclaw-plugin test:discovery-smoke` - passed after rebuilding the plugin bundle.
- `bun run --filter tensorfleet-openclaw-plugin build` - passed; tsup still emitted existing direct-`eval` bundler warnings from `tensorfleet-tools/dist/index.mjs`.
- `bunx tsc -p packages/tensorfleet-openclaw-plugin/tsconfig.json --noEmit` - passed.
- `git -C /home/shane/tensorfleet-claw-interface diff --check` - passed.
- Practical prompts covered by regression/docs: list map/room/zone targets, list real-vacuum room inventory, check Kitchen room readiness, check real-vacuum segment support, missing zone readiness, room-cleaning start refusal, map-edit refusal, and normalized shared-state provenance.
