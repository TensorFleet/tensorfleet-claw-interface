import { TensorfleetLogger } from "tensorfleet-util";
import { startOAuthRedirectFlow, storeAuthTokenOnGlobal, getGlobalAuthInfo, clearGlobalAuthInfo } from "tensorfleet-auth";
import { createServer } from "node:http";
import { execFile } from "node:child_process";

const logger = new TensorfleetLogger("Tools");
const DEFAULT_AUTH_BACKEND_URL = "https://app.tensorfleet.net/";

export interface AuthParams {
  command?: "status" | "login" | "logout";
  backendUrl?: string;
}

export async function authTool(_id: string, params: AuthParams) {
  try {
    // Default to 'login' for backward compatibility
    const command = params.command ?? "login";

    if (command === "status") {
      const authInfo = getGlobalAuthInfo();
      const responseText = JSON.stringify(
        {
          success: true,
          command: "status",
          authenticated: !!authInfo,
          authInfo: authInfo ? {
            ...authInfo,
            token: `${authInfo.token.slice(0, 8)}...`,
          } : null,
        },
        null,
        2
      );

      return {
        content: [{ type: "text", text: responseText || "" }],
      };
    }

    if (command === "logout") {
      clearGlobalAuthInfo();
      const responseText = JSON.stringify(
        {
          success: true,
          command: "logout",
          message: "Successfully logged out",
          timestamp: new Date().toISOString(),
        },
        null,
        2
      );

      return {
        content: [{ type: "text", text: responseText || "" }],
      };
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
      const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];

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

    const responseText = JSON.stringify(
      {
        success: true,
        command: "login",
        authInfo: {
          ...authInfo,
          token: `${authInfo.token.slice(0, 8)}...`,
        },
      },
      null,
      2
    );

    return {
      content: [{ type: "text", text: responseText || "" }],
    };
  } catch (error) {
    logger.error(`Auth failed:`, error);
    const errorText = JSON.stringify(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
        timestamp: new Date().toISOString(),
      },
      null,
      2
    );

    return {
      content: [{ type: "text", text: errorText || "" }],
    };
  }
}