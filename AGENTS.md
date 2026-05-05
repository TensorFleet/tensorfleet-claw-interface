# TensorFleet CLI / Tools — Value Provenance & Architecture

This document describes where configuration values come from, how they flow between layers, and the migration path away from file-based config.

## Three-Layer Value Hierarchy

```
Layer 1: globalThis (auth-global.ts)  ←  JWT token, user profile
Layer 2: config-store (tensorfleet-util)  ←  VM manager URL, proxy URL, node ID
Layer 3: file-based (config-loader.ts)  ←  LEGACY — .tensorfleet + .env files
```

Each layer overrides the one below it. CLI commands set values in layers 1 & 2, replacing what was previously read from files (layer 3).

---

## Layer 1: `globalThis` — Auth Token & Profile

**Stored by:** `auth-global.ts` → `storeAuthTokenOnGlobal(token, source)`
**Read by:** `getGlobalAuthInfo()` → returns `TensorfleetGlobalAuthInfo`

| Value | Key | Set by |
|---|---|---|
| JWT Token | `token` | `test-auth` OAuth flow, or `TENSORFLEET_JWT` env var |
| User Profile | `userProfile` | Extracted from JWT by `extractUserProfile()` |
| Auth Source | `source` | `"oauth"` or `"process-env"` |
| Expiry | `isExpired` | Checked via `isTokenExpired()` |
| Timestamp | `updatedAt` | ISO string of when stored |

**Symbol key:** `Symbol.for("tensorfleet.auth")` on `globalThis`

**Layer 1 replaces:** `TENSORFLEET_JWT` from `.env` file (legacy config-loader).

---

## Layer 2: `config-store` — Runtime Config (Map)

**Defined in:** `tensorfleet-util/src/config/config-store.ts`
**Set by:** CLI commands (`vm <action>`, future commands)
**Read by:** `tensorfleet-util` consumers (ROS bridge, future tools)

| Key | Description | Set by |
|---|---|---|
| `TENSORFLEET_VM_MANAGER_URL` | Base URL for VM Manager API | `vm status --region` → `setConfig()` |
| `TENSORFLEET_PROXY_URL` | WebSocket proxy URL | *(future command)* |
| `TENSORFLEET_NODE_ID` | VM node identifier | `vm status` (auto-detected) |
| `TENSORFLEET_JWT` | Auth token (also in layer 1) | *(future command)* |

**Config-store replaces:** `vmManagerUrl`, `proxyUrl`, `nodeId` from `.tensorfleet` file (legacy config-loader).

---

## Layer 3: File-based (LEGACY — being replaced)

**Defined in:** `config-loader.ts`
**Reads:** `.tensorfleet` (JSON) + `.env` (dotenv) files from a project directory

This layer is being gradually replaced by CLI commands that set layers 1 & 2 directly.

### Migration Table

| File value | CLI replacement | Status |
|---|---|---|
| `.env` → `TENSORFLEET_JWT` | `tensorfleet test-auth` or `--do-auth` flag | ✅ Done |
| `.tensorfleet` → `env.vmManagerUrl` | `tensorfleet vm status --region <id>` | ✅ Done |
| `.tensorfleet` → `env.proxyUrl` | *(future)* | ⬜ Planned |
| `.tensorfleet` → `env.nodeId` | `tensorfleet vm status` (auto-detected) | ✅ Done |
| `.tensorfleet` → `template` | `tensorfleet vm start --config <id>` | ✅ Done |

---

## Region System

**Defined in:** `tensorfleet-auth/src/regions.ts`

Regions map a short ID to a full configuration including the VM Manager URL, ports, etc.

| Region ID | Name | VM Manager URL | Dev Only |
|---|---|---|---|
| `eu` | EU Central | `https://eu.vm.tensorfleet.net` | ❌ |
| `asia` | Asia | `http://vm-manager-asia-1.tail4f6a7.ts.net` | ✅ |
| `local` | Local Dev | `http://localhost:8080` | ✅ |

**Default:** `eu` (unless `--region` specified, then `local`)

When a CLI command accepts `--region`, it:
1. Resolves the region via `getRegionById(region)`
2. Sets `TENSORFLEET_VM_MANAGER_URL` in config-store
3. Passes the URL (with auth token) to `tensorfleet-util` functions

---

## Auth Flow

```
1. User runs `tensorfleet test-auth`
   → opens browser → OAuth redirect → token received
   → storeAuthTokenOnGlobal(token, "oauth")
   → token + profile stored on globalThis

2. User runs `tensorfleet vm status --region eu`
   → getGlobalAuthInfo() reads token from globalThis
   → if no token: error "Not authenticated. Run test-auth first"
   → OR: pass --do-auth to run OAuth first

3. Alternative: export TENSORFLEET_JWT="..."
   → picked up by resolveProcessAuthInfo() in auth-global.ts
```

---

## Future Roadmap

CLI commands planned (follow the same pattern as `vm-status` and `list-regions`):

| Command | Config-store key set |
|---|---|
| `vm-start` | `TENSORFLEET_NODE_ID` |
| `vm-stop` | — |
| `vm-restart` | `TENSORFLEET_NODE_ID` |
| `vm-proxy` | `TENSORFLEET_PROXY_URL` |

Each command should:
1. Check `getGlobalAuthInfo()` for token (or accept `--do-auth`)
2. Use `getConfig("TENSORFLEET_VM_MANAGER_URL")` or accept `--region`
3. Call the corresponding `tensorfleet-util` client function
4. Side-effect write relevant values to config-store