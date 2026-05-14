import { TensorfleetLogger } from "tensorfleet-util";
import {
  startOAuthRedirectFlow,
  storeAuthTokenOnGlobal,
  getGlobalAuthInfo,
  clearGlobalAuthInfo,
} from "tensorfleet-auth";
import { createServer } from "node:http";
import { execFile } from "node:child_process";

const logger = new TensorfleetLogger("Tools");
const DEFAULT_AUTH_BACKEND_URL = "https://app.tensorfleet.net/";

export interface AuthParams {
  command?: "status" | "login" | "logout";
  backendUrl?: string;
}

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

function redactAuthInfo(authInfo: ReturnType<typeof getGlobalAuthInfo>) {
  if (!authInfo) {
    return null;
  }

  return {
    ...authInfo,
    token: `${authInfo.token.slice(0, 8)}...`,
  };
}

export async function authTool(_id: string, params: AuthParams) {
  try {
    // Default to 'login' for backward compatibility
    const command = params.command ?? "login";

    if (command === "status") {
      const authInfo = getGlobalAuthInfo();

      return createTextResponse({
        success: true,
        command: "status",
        authenticated: !!authInfo,
        authInfo: redactAuthInfo(authInfo),
      });
    }

    if (command === "logout") {
      clearGlobalAuthInfo();

      return createTextResponse({
        success: true,
        command: "logout",
        message: "Successfully logged out",
        timestamp: new Date().toISOString(),
      });
    }

    // Default: login command
    const backendUrl = params.backendUrl ?? DEFAULT_AUTH_BACKEND_URL;

    function openBrowser(url: string): Promise<void> {
      const command =
          process.platform === "darwin"
              ? "open"
              : process.platform === "win32"
                  ? "cmd"
                  : "xdg-open";

      const args =
          process.platform === "win32"
              ? ["/c", "start", "", url]
              : [url];

      return new Promise((resolve, reject) => {
        const child = execFile(command, args, (error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });

        child.unref();
      });
    }

    const session = await startOAuthRedirectFlow({
      backendUrl,
      createServer,
      openBrowser: async (url) => {
        await openBrowser(url);
      },
      onTokenReceived: (token) => {
        storeAuthTokenOnGlobal(token, "oauth");
      },
    });

    await session.tokenPromise;

    const authInfo = getGlobalAuthInfo();

    if (!authInfo) {
      throw new Error("Authentication completed but no auth info was stored");
    }

    return createTextResponse({
      success: true,
      command: "login",
      authInfo: redactAuthInfo(authInfo),
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
