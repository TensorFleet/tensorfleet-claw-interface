import { TensorfleetLogger } from "tensorfleet-util";
import {
  startOAuthRedirectFlow,
  storeAuthTokenOnGlobal,
  getGlobalAuthInfo,
  clearGlobalAuthInfo,
  isTokenExpired,
  isValidJwtShape,
} from "tensorfleet-auth";
import { isBun, isNode } from "std-env";

const logger = new TensorfleetLogger("Tools");
const DEFAULT_AUTH_BACKEND_URL = "https://app.tensorfleet.net/";
const AUTH_CACHE_SERVICE = "tensorfleet";
const AUTH_CACHE_ACCOUNT = "auth-token";

export interface AuthParams {
  command?: "status" | "login" | "logout";
  backendUrl?: string;
  cacheAuth?: boolean;
  forceLogin?: boolean;
}

type CachedAuthResult = {
  token: string;
};

type AuthInfo = NonNullable<ReturnType<typeof getGlobalAuthInfo>>;
type CreateServer = Parameters<typeof startOAuthRedirectFlow>[0]["createServer"];
type KeyringEntry = {
  getPassword?: () => string | Promise<string | null> | null;
  setPassword?: (password: string) => void | Promise<void>;
  deletePassword?: () => boolean | void | Promise<boolean | void>;
};
type KeyringModule = {
  Entry?: new (service: string, account: string) => KeyringEntry;
  Keyring?: new (service: string, account: string) => KeyringEntry;
  default?: {
    Entry?: new (service: string, account: string) => KeyringEntry;
    Keyring?: new (service: string, account: string) => KeyringEntry;
  };
};

function createTextResponse(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2) ?? String(value),
      },
    ],
  };
}

function redactAuthInfo(authInfo: AuthInfo | null | undefined) {
  if (!authInfo) {
    return null;
  }

  return {
    ...authInfo,
    token: `${authInfo.token.slice(0, 8)}...`,
  };
}

function isNodeOrBunRuntime(): boolean {
  return isNode || isBun;
}

async function importOptionalRuntimeDependency(specifier: string): Promise<unknown> {
  const runtimeImport = new Function(
    "specifier",
    "return import(specifier)",
  ) as (specifier: string) => Promise<unknown>;

  return await runtimeImport(specifier);
}

async function getCreateServer(): Promise<CreateServer> {
  if (!isNodeOrBunRuntime()) {
    throw new Error("OAuth redirect login requires a Node-compatible runtime");
  }

  const http = await import("node:http");
  return http.createServer;
}

async function getKeyringEntry(): Promise<KeyringEntry | null> {
  if (!isNodeOrBunRuntime()) {
    return null;
  }

  try {
    const keyring = (await importOptionalRuntimeDependency("@napi-rs/keyring")) as KeyringModule;
    const Entry =
      keyring.Entry ??
      keyring.Keyring ??
      keyring.default?.Entry ??
      keyring.default?.Keyring;

    return Entry ? new Entry(AUTH_CACHE_SERVICE, AUTH_CACHE_ACCOUNT) : null;
  } catch (error) {
    logger.debug(
      "Auth keyring unavailable, falling back to file cache:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

async function getAuthCacheFilePath(): Promise<string | null> {
  if (!isNodeOrBunRuntime()) {
    return null;
  }

  const [{ homedir }, path] = await Promise.all([
    import("node:os"),
    import("node:path"),
  ]);
  const home = homedir();

  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    return path.join(appData, "TensorFleet", "auth.json");
  }

  return path.join(home, ".tensorfleet", "auth.json");
}

async function readTokenFromKeyring(): Promise<string | null> {
  try {
    const entry = await getKeyringEntry();

    if (!entry?.getPassword) {
      return null;
    }

    const token = await entry.getPassword();
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch (error) {
    logger.debug(
      "Auth keyring read failed, falling back to file cache:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

async function writeTokenToKeyring(token: string): Promise<boolean> {
  try {
    const entry = await getKeyringEntry();

    if (!entry?.setPassword) {
      return false;
    }

    await entry.setPassword(token);
    return true;
  } catch (error) {
    logger.debug(
      "Auth keyring write failed, falling back to file cache:",
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}

async function deleteTokenFromKeyring(): Promise<boolean> {
  try {
    const entry = await getKeyringEntry();

    if (!entry?.deletePassword) {
      return false;
    }

    await entry.deletePassword();
    return true;
  } catch (error) {
    logger.debug(
      "Auth keyring delete failed:",
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}

async function readTokenFromFileCache(): Promise<string | null> {
  const cachePath = await getAuthCacheFilePath();

  if (!cachePath) {
    return null;
  }

  try {
    const { readFile } = await import("node:fs/promises");
    const rawCache = await readFile(cachePath, "utf8");
    const cache = JSON.parse(rawCache) as { token?: unknown };
    return typeof cache.token === "string" && cache.token.length > 0 ? cache.token : null;
  } catch {
    return null;
  }
}

async function writeTokenToFileCache(token: string): Promise<void> {
  const cachePath = await getAuthCacheFilePath();

  if (!cachePath) {
    return;
  }

  const [{ mkdir, writeFile }, { dirname }] = await Promise.all([
    import("node:fs/promises"),
    import("node:path"),
  ]);
  const cacheContent = JSON.stringify(
    { token, updatedAt: new Date().toISOString() },
    null,
    2,
  ) ?? "";

  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(
    cachePath,
    cacheContent,
    { encoding: "utf8", mode: 0o600 },
  );
}

async function deleteTokenFromFileCache(): Promise<void> {
  const cachePath = await getAuthCacheFilePath();

  if (!cachePath) {
    return;
  }

  const { rm } = await import("node:fs/promises");
  await rm(cachePath, { force: true });
}

async function tryLoadAndVerifyAuthTokenFromCache(): Promise<CachedAuthResult | null> {
  const keyringToken = await readTokenFromKeyring();

  if (keyringToken && isUsableCachedToken(keyringToken)) {
    return { token: keyringToken };
  }

  const token = await readTokenFromFileCache();

  if (token && isUsableCachedToken(token)) {
    // TODO: Call backend verification here when auth cache validation has backend context.
    return { token };
  }

  return null;
}

async function cacheAuthToken(token: string): Promise<void> {
  const didWriteKeyring = await writeTokenToKeyring(token);

  if (!didWriteKeyring) {
    if (isNodeOrBunRuntime()) {
      await writeTokenToFileCache(token);
    }
    return;
  }

  await deleteTokenFromFileCache();
}

async function clearCachedAuthToken(): Promise<void> {
  await deleteTokenFromKeyring();
  await deleteTokenFromFileCache();
}

function isUsableCachedToken(token: string): boolean {
  return isValidJwtShape(token) && !isTokenExpired(token);
}

function getUsableGlobalAuthInfo(): AuthInfo | null {
  const authInfo = getGlobalAuthInfo();

  if (!authInfo || authInfo.isExpired || !authInfo.isValidJwtShape) {
    return null;
  }

  return authInfo;
}

async function loadUsableCachedAuthInfo(): Promise<AuthInfo | null> {
  const cachedAuth = await tryLoadAndVerifyAuthTokenFromCache();

  if (!cachedAuth || !isUsableCachedToken(cachedAuth.token)) {
    return null;
  }

  return storeAuthTokenOnGlobal(cachedAuth.token, "oauth");
}

export async function authTool(_id: string, params: AuthParams) {
  try {
    // Default to 'login' for backward compatibility
    const command = params.command ?? "login";
    const useCache = params.cacheAuth ?? true;
    const forceLogin = params.forceLogin ?? false;

    if (command === "status") {
      const authInfo =
        getUsableGlobalAuthInfo() ??
        (useCache && !forceLogin ? await loadUsableCachedAuthInfo() : null);

      return createTextResponse({
        success: true,
        command: "status",
        authenticated: !!authInfo,
        authInfo: redactAuthInfo(authInfo),
      });
    }

    if (command === "logout") {
      clearGlobalAuthInfo();
      await clearCachedAuthToken();

      return createTextResponse({
        success: true,
        command: "logout",
        message: "Successfully logged out",
        timestamp: new Date().toISOString(),
      });
    }

    // Default: login command
    const existingAuthInfo = forceLogin ? null : getUsableGlobalAuthInfo();
    const cachedAuthInfo =
      existingAuthInfo ??
      (useCache && !forceLogin ? await loadUsableCachedAuthInfo() : null);

    if (cachedAuthInfo) {
      return createTextResponse({
        success: true,
        command: "login",
        status: "authenticated",
        authInfo: redactAuthInfo(cachedAuthInfo),
        message: existingAuthInfo ? "Already authenticated." : "Using cached authentication.",
      });
    }

    const backendUrl = params.backendUrl ?? DEFAULT_AUTH_BACKEND_URL;

    const session = await startOAuthRedirectFlow({
      backendUrl,
      createServer: await getCreateServer(),
      openBrowser: async () => {},
      onTokenReceived: async (token) => {
        storeAuthTokenOnGlobal(token, "oauth");
        if (useCache) {
          await cacheAuthToken(token);
        }
      },
    });

    session.tokenPromise.catch((error) => {
      logger.error(
        "Auth callback failed:",
        error instanceof Error ? error.message : String(error),
      );
    });

    return createTextResponse({
      success: true,
      command: "login",
      status: "pending",
      authUrl: session.finalAuthUrl,
      message: "Open this URL to authenticate, then continue after authentication completes.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error occurred";

    logger.error("Auth failed:", message);

    return createTextResponse({
      success: false,
      error: message,
      timestamp: new Date().toISOString(),
    });
  }
}
