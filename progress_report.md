# Progress Report - Gated room zone simulation starts
Current report date: 2026-06-26.

## 1. What changed

- Added `start-room-cleaning` and `start-zone-cleaning` to the `tensorfleet-vacuum` schema, discovery surface, generated types, OpenClaw plugin smoke coverage, README prompts, and packaged skill guidance.
- Aligned shared command semantics so `start_room_cleaning` and `start_zone_cleaning` carry normalized `VacuumMapTarget` descriptors instead of raw annotation internals.
- Added simulation adapter dispatch for normalized room/zone target commands by converting shared target geometry into the existing VM coverage request route.
- Added `bun run --filter tensorfleet-tools test:vacuum-room-zone-writes` with regression coverage for schema, discovery, missing/not-found/ambiguous/invalid targets, missing runtime, real-vacuum refusal, send-command bypass refusal, secret/raw-name filtering, and successful mocked dispatch.

## 2. Product behavior

- `start-room-cleaning` accepts `room.id` or `room.name`; `start-zone-cleaning` accepts `zone.id` or `zone.name`.
- Both actions are simulation-only writes and reuse shared room/zone readiness before dispatch.
- Missing selectors return `needs_input`; unknown names return `not_found`; duplicate names return `ambiguous_target` with candidates; invalid geometry returns `invalid_target`; stale/unavailable targets return `unavailable`; unsupported backends return `unsupported`.
- Ready simulation targets dispatch exactly one normalized command: `start_room_cleaning` or `start_zone_cleaning`.
- Real-vacuum room/zone target inventory remains readable, but real-vacuum room/zone writes are refused and are not silently redirected to simulation.
- No live runtime dispatch was performed; successful dispatch validation used mocked ROS/VM runtime services only.

## 3. Still deferred

- Map annotation mutation/editing through OpenClaw.
- Real-vacuum room/zone writes.
- Arbitrary waypoint tools and raw backend command tools.
- Raw ROS/Nav2/Foxglove/Valetudo/private endpoint, shell, filesystem, arbitrary HTTP, and MCP vacuum-control paths.
- React hook, browser runtime client, and UI control refactors.

## 4. Validation

- `bun run --filter tensorfleet-tools build` - passed; warning: the optional `tensorfleet-ros` build leg still prints existing TypeScript errors under its `|| true` path before `tensorfleet-tools` completes.
- `bun run --filter tensorfleet-tools test:vacuum-discovery` - passed.
- `bun run --filter tensorfleet-tools test:vacuum-read-preflight` - passed.
- `bun run --filter tensorfleet-tools test:vacuum-write-actions` - passed.
- `bun run --filter tensorfleet-tools test:vacuum-boundary` - passed.
- `bun run --filter tensorfleet-tools test:vacuum-room-zone-writes` - passed.
- `bun run --filter tensorfleet-openclaw-plugin build` - passed; warning: tsup emitted existing direct-`eval` bundler warnings from generated bundled code in `tensorfleet-tools/dist/index.mjs`.
- `bun run --filter tensorfleet-openclaw-plugin test:discovery-smoke` - passed.
- `bunx tsc -p packages/tensorfleet-openclaw-plugin/tsconfig.json --noEmit` - passed.
- `git -C /home/shane/tensorfleet-claw-interface diff --check` - passed.
- `git -C /home/shane/tensorfleet-claw-interface/packages/tensorfleet-tools/packages/tensorfleet-util diff --check` - passed.
- `bun run --cwd /home/shane/vscode-tensorfleet/panels-standalone prepare:tensorfleet-util` - passed.
- `bun run --cwd /home/shane/vscode-tensorfleet test:vacuum-shared-parity` - passed.
- `bun run --cwd /home/shane/vscode-tensorfleet test:vacuum-shared-boundary` - passed.
- `bun run --cwd /home/shane/vscode-tensorfleet/panels-standalone build` - passed; warnings: Vite externalized Node built-ins for browser compatibility, protobufjs `eval`, and large chunk-size warnings.
- `bun run --cwd /home/shane/vscode-tensorfleet compile` - passed; same panel build warnings plus Vite CJS Node API deprecation warning during extension build.
- `bun run --cwd /home/shane/vscode-tensorfleet build:extension` - passed; warning: Vite CJS Node API deprecation warning.
- `git -C /home/shane/vscode-tensorfleet diff --check` - passed.
- Practical OpenClaw task prompts covered in docs/regression: start room by name, start room by id, start zone by id, missing zone refusal, ambiguous room refusal, real-vacuum room-start refusal, and map-edit refusal.
