# Progress Report - Vacuum shared-core refactor closeout
Current report date: 2026-06-26.

## 1. What changed

- Completed the vacuum shared-core refactor track: OpenClaw and future agents can use `tensorfleet-tools` plus `tensorfleet-util/vacuum` without depending on `vscode-tensorfleet` extension code.
- Kept extension-specific hooks, runtime clients, auth injection, polling, rendering, and UI lifecycle local to `vscode-tensorfleet`; pure extension adapter modules remain shared-util re-export shims.
- Added and smoke-validated OpenClaw/tool room and zone target read/preflight plus gated simulation-only writes: `get-room-targets`, `get-zone-targets`, `check-room-cleaning-readiness`, `check-zone-cleaning-readiness`, `start-room-cleaning`, and `start-zone-cleaning`.
- Tightened the registered OpenClaw plugin runtime smoke so it accepts current OpenClaw text-content results and directly covers room/zone discovery/refusal cases at the plugin boundary.

## 2. Product behavior

- OpenClaw/agents can list normalized map, room, and zone targets.
- OpenClaw/agents can preflight room and zone cleaning with shared readiness gates.
- OpenClaw/agents can start room and zone cleaning for simulation only.
- Simulation room/zone starts accept `room.id` / `room.name` and `zone.id` / `zone.name`, reuse shared target readiness, and dispatch normalized `start_room_cleaning` / `start_zone_cleaning` commands only after gates pass.
- Missing, unknown, ambiguous, invalid, stale/unavailable, unsupported, and real-vacuum write cases fail closed with structured refusals.
- No live runtime dispatch was performed; successful dispatch validation used mocked ROS/VM runtime services.

## 3. Still deferred

- Real-vacuum room/zone writes.
- Map annotation mutation/editing.
- Live robot validation.
- Arbitrary waypoint/raw backend tools.
- MCP as the primary vacuum control path.
- UI controls and workflow changes beyond the shared-core parity needed for this refactor.

## 4. Validation

- Practical OpenClaw/plugin smoke: registered `tensorfleet-vacuum` discovery for `simulation`; registered discovery for `real_vacuum` confirming room/zone write actions are not advertised; missing `start-zone-cleaning` selector returns `needs_input`; real-vacuum `start-room-cleaning` returns `unsupported`; `send-command` cannot bypass plugin runtime/auth gates; configured discovery omits token and URL values.
- Mocked runtime smoke/regression: tool tests validated successful room and zone dispatch with exactly one normalized command path, `send-command` bypass refusal after authenticated mocked runtime setup, real-vacuum refusal, and no secret/private endpoint/raw service leakage.
- `bun run --filter tensorfleet-tools build` - passed; non-blocking warning: the optional `tensorfleet-ros` build leg still prints existing TypeScript errors under its `|| true` path before `tensorfleet-tools` completes.
- `bun run --filter tensorfleet-tools test:vacuum-discovery` - passed.
- `bun run --filter tensorfleet-tools test:vacuum-read-preflight` - passed.
- `bun run --filter tensorfleet-tools test:vacuum-write-actions` - passed.
- `bun run --filter tensorfleet-tools test:vacuum-boundary` - passed.
- `bun run --filter tensorfleet-tools test:vacuum-room-zone-writes` - passed.
- `bun run --filter tensorfleet-openclaw-plugin build` - passed; non-blocking warning: tsup emitted existing direct-`eval` bundler warnings from generated bundled code in `tensorfleet-tools/dist/index.mjs`.
- `bun run --filter tensorfleet-openclaw-plugin test:discovery-smoke` - passed.
- `bun run --filter tensorfleet-openclaw-plugin test:vacuum-runtime-smoke` - passed.
- `bunx tsc -p packages/tensorfleet-openclaw-plugin/tsconfig.json --noEmit` - passed.
- `git -C /home/shane/tensorfleet-claw-interface diff --check` - passed.
- VS Code validation was rerun because shared util/vendored util had changed earlier in the refactor: prepare, parity, boundary, panel build, compile, extension build, and diff-check passed with only existing Vite/protobuf/chunk-size/CJS API warnings.

The vacuum shared-core refactor is complete. Future work should be treated as product/tool feature work, with product-level semantics starting in tensorfleet-util/vacuum, OpenClaw policy in tensorfleet-tools, and UI lifecycle in vscode-tensorfleet.
