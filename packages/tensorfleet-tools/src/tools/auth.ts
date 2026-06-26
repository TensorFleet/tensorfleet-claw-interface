import { TensorfleetLogger } from "tensorfleet-util";
import {
  startOAuthRedirectFlow,
  storeAuthTokenOnGlobal,
  getGlobalAuthInfo,
  clearGlobalAuthInfo,
  isTokenExpired,
  isValidJwtShape,
} from "tensorfleet-auth";
import { createServer } from "node:http";

const logger = new TensorfleetLogger("Tools");
const DEFAULT_AUTH_BACKEND_URL = "https://app.tensorfleet.net/";

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

async function tryLoadAndVerifyAuthTokenFromCache(): Promise<CachedAuthResult | null> {
  // Placeholder: load and verify the token from durable auth cache.
  // Return null when the cache is missing, invalid, revoked, or expired.
  return null;
}

async function cacheAuthToken(token: string): Promise<void> {
  void token;
  // Placeholder: persist the token in durable auth cache.
}

async function clearCachedAuthToken(): Promise<void> {
  // Placeholder: clear the token from durable auth cache.
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
      createServer,
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
