# Progress Report - Vacuum OpenClaw runtime smoke
Current report date: 2026-06-25.

## 1. What changed

- Added `packages/tensorfleet-openclaw-plugin/scripts/vacuum-runtime-smoke.test.mjs`, a direct OpenClaw plugin-runtime smoke that imports the built plugin bundle, calls `plugin.register(api)`, locates the registered `tensorfleet-vacuum` tool, and invokes `tool.execute(toolCallId, params)` with one short case per assertion.
- Added `bun run --filter tensorfleet-openclaw-plugin test:vacuum-runtime-smoke`.
- Documented the vacuum runtime config path in the plugin README and implementation doc: explicit tool params first, then gateway process env/config-store/global auth; the OpenClaw plugin `configSchema` is currently empty and there is no localhost fallback.
- Replaced the older mixed OpenClaw prompt list with short, single-action task prompts for `start-navigation`, `start-clean-area`, invalid inputs, mission control, real-vacuum refusal, and raw Nav2 refusal.
- Updated stale docs that still described the simulation surface as read-only. Current docs now describe only the explicit gated simulation writes and the continued refusal of `send-command`/raw/basic backdoor control.

## 2. Product behavior

- Direct registered-tool execution now proves `tensorfleet-vacuum` returns structured safe refusals through the OpenClaw plugin runtime path, not only through private `tensorfleet-tools` imports.
- `start-navigation` with a valid simulation target and missing runtime/auth config returns `success: false`, `status: "not_authenticated"`, backend `simulation`, adapter `turtlebot4_nav2`, missing auth/VM Manager blockers, and no token or URL values.
- `start-clean-area` with a valid rectangle and missing runtime/auth config returns the same structured missing-config refusal.
- `start-navigation` with target `{x:1}` returns `status: "needs_input"`, `missingFields: ["target.y", "target.theta"]`, `commandDispatched: false`, and no runtime preflight object, proving invalid input refuses before runtime dispatch.
- `start-clean-area` with negative width returns `status: "invalid_request"`, `invalidFields: ["area.width"]`, `commandDispatched: false`, and no runtime preflight object.
- `pause-mission` and `cancel-mission` with missing runtime/auth config return structured `not_authenticated` refusals and do not dispatch.
- `real_vacuum` `start-navigation` returns `status: "unsupported"`, backend `real_vacuum`, adapter `valetudo`, `commandDispatched: false`, and does not switch to simulation.
- Configured discovery with tool-param `TENSORFLEET_JWT` and `TENSORFLEET_VM_MANAGER_URL` reports sources as `tool-env-param` and `routeMode: "vm-manager"` without leaking the token or URL. This proves config-source reporting, not live route dispatch.
- No room/zone starts, go-to-location, real-vacuum writes, map mutation, MCP vacuum tools, raw backend access, shell, filesystem, arbitrary HTTP, or safety-gate weakening was added.

## 3. Still deferred

- Live configured simulation dispatch through the OpenClaw agent path. No `TENSORFLEET_JWT`, `TENSORFLEET_VM_MANAGER_URL`, or `TENSORFLEET_VALETUDO_RUNTIME_URL` values were present in this shell, so live dispatch was not attempted.
- Live `openclaw agent --json` confirmation of a movement-start command. The bounded agent run emitted no JSON and timed out before any tool payload was produced.
- Prompt 8 raw-Nav2 refusal remains documented for agent/user testing; it is an agent policy prompt rather than a direct `tensorfleet-vacuum` tool parameter case.
- `go-to-location`, `start-room-cleaning`, `start-zone-cleaning`, room/zone target starts, arbitrary waypoint tools, map annotation mutation/editing, and all real-vacuum write/control remain deferred.

## 4. Validation

- `bun run --filter tensorfleet-tools build` - exited 0 and produced the `tensorfleet-tools` bundle/declarations. The nested `tensorfleet-ros build` step still emitted pre-existing TypeScript errors but is behind `|| true` in the package script.
- `bun run --filter tensorfleet-tools test:vacuum-discovery` - passed.
- `bun run --filter tensorfleet-tools test:vacuum-read-preflight` - passed.
- `bun run --filter tensorfleet-tools test:vacuum-write-actions` - passed.
- `bun run --filter tensorfleet-openclaw-plugin build` - passed with existing esbuild direct-`eval` warnings from bundled dependencies.
- `bunx tsc -p packages/tensorfleet-openclaw-plugin/tsconfig.json --noEmit` - passed.
- `bun run --filter tensorfleet-openclaw-plugin test:discovery-smoke` - passed.
- `bun run --filter tensorfleet-openclaw-plugin test:vacuum-runtime-smoke` - passed. Covered write-action enum exposure, missing-config refusals for navigation/Clean Area/pause/cancel, invalid navigation target, invalid Clean Area rectangle, real-vacuum navigation refusal, clean exit behavior, and no secret/raw endpoint leakage.
- `env | rg '^TENSORFLEET_(JWT|VM_MANAGER_URL|VALETUDO_RUNTIME_URL)=' || true` - no output; credentials/runtime config were absent.
- `openclaw gateway restart` - exited 0 and restarted `openclaw-gateway.service`.
- `openclaw plugins list` - exited 0 and showed `tensorfleet-openclaw-plugin` enabled from `packages/tensorfleet-openclaw-plugin/dist/dist/index.js`.
- `timeout 15s openclaw plugins inspect tensorfleet-openclaw-plugin --runtime --json` - printed runtime JSON showing `status: "loaded"`, `imported: true`, and `tensorfleet-vacuum` registered; exited 124 because the CLI remained open after printing JSON.
- `timeout 45s openclaw agent --json --timeout 30 --session-key agent:tensorfleet-vacuum-smoke:nav-missing-config --message 'Use tensorfleet-vacuum with backend simulation. Call start-navigation with target {x:1.0,y:0.5,theta:0.0}. If runtime config is missing, refuse safely and list the missing config. Do not use any other tool.'` - exited 124 with no JSON.
- `journalctl --user -u openclaw-gateway.service --since '15 minutes ago' --no-pager | tail -n 160` - showed model fallback/probing due to `rate_limit`, then an incomplete turn with `payloads=0` and `tools=0`, followed by `Agent couldn't generate a response`; this indicates the tool was not called during the agent smoke.
- `git diff --check` - passed in `/home/shane/tensorfleet-claw-interface`. No submodule files or gitlinks changed in this pass.

Task-style prompt expected/actual:

- Prompt 1, `start-navigation` valid target with missing config: expected safe missing-config refusal. Direct plugin runtime actual passed with `not_authenticated`; live agent actual timed out with no JSON and no tool call.
- Prompt 2, `start-clean-area` valid rectangle with missing config: expected safe missing-config refusal. Direct plugin runtime actual passed with `not_authenticated`; live agent not rerun after prompt 1 timed out.
- Prompt 3, `start-navigation` target `{x:1}`: expected missing `y` and `theta`. Direct plugin runtime actual passed with `missingFields: ["target.y", "target.theta"]`.
- Prompt 4, `start-clean-area` negative width: expected invalid rectangle refusal. Direct plugin runtime actual passed with `invalidFields: ["area.width"]`.
- Prompt 5, `pause-mission`: expected no active mission or missing runtime blocker. Direct plugin runtime actual passed with missing-config `not_authenticated`.
- Prompt 6, `cancel-mission`: expected no active mission or missing runtime blocker. Direct plugin runtime actual passed with missing-config `not_authenticated`.
- Prompt 7, `real_vacuum` `start-navigation`: expected unsupported/refusal without switching to simulation. Direct plugin runtime actual passed with backend `real_vacuum`, adapter `valetudo`, `status: "unsupported"`.
- Prompt 8, raw Nav2 movement: expected refusal because raw Nav2 is not an exposed TensorFleet tool path. Documented in README/docs; not executed through the stalled agent path.

No live movement-start command was actually dispatched or confirmed in this pass.
