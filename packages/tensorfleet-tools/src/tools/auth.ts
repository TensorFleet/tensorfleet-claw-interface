import { TensorfleetLogger } from "tensorfleet-util";
import {
  startOAuthRedirectFlow,
  storeAuthTokenOnGlobal,
  getGlobalAuthInfo,
  clearGlobalAuthInfo,
} from "tensorfleet-auth";
import { createServer } from "node:http";

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

    const session = await startOAuthRedirectFlow({
      backendUrl,
      createServer,
      openBrowser: async () => {},
      onTokenReceived: (token) => {
        storeAuthTokenOnGlobal(token, "oauth");
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
