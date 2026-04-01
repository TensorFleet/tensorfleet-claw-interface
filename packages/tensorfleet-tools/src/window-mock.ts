import { JSDOM, type DOMWindow } from "jsdom";
import WebSocket from "ws";

let dom: JSDOM | null = null;
const previousGlobals = new Map<string, unknown>();
const ABSENT = Symbol("absent");

const WINDOW_GLOBAL_KEYS = [
  "window",
  "self",
  "top",
  "parent",
  "document",
  "navigator",
  "location",
  "history",
  "customElements",
  "DOMParser",
  "XMLSerializer",
  "MutationObserver",
  "Node",
  "Text",
  "Element",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLSelectElement",
  "HTMLCanvasElement",
  "HTMLImageElement",
  "DocumentFragment",
  "Document",
  "EventTarget",
  "Event",
  "CustomEvent",
  "MessageEvent",
  "CloseEvent",
  "KeyboardEvent",
  "MouseEvent",
  "FocusEvent",
  "InputEvent",
  "UIEvent",
  "ProgressEvent",
  "Blob",
  "File",
  "FileList",
  "FormData",
  "Headers",
  "Request",
  "Response",
  "AbortController",
  "AbortSignal",
  "DOMException",
  "URL",
  "URLSearchParams",
  "WebSocket",
  "performance",
  "screen",
  "fetch",
  "atob",
  "btoa",
  "getComputedStyle",
  "matchMedia",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "requestIdleCallback",
  "cancelIdleCallback",
  "ResizeObserver",
  "IntersectionObserver",
  "TextEncoder",
  "TextDecoder",
  "ReadableStream",
  "WritableStream",
  "TransformStream",
  "CompressionStream",
  "DecompressionStream",
  "structuredClone",
  "crypto",
] as const;

const BOUND_FUNCTION_KEYS = new Set([
  "fetch",
  "atob",
  "btoa",
  "getComputedStyle",
  "matchMedia",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "requestIdleCallback",
  "cancelIdleCallback",
  "queueMicrotask",
]);

function savePreviousGlobal(name: string, target: any): void {
  if (!previousGlobals.has(name)) {
    previousGlobals.set(
      name,
      Object.prototype.hasOwnProperty.call(target, name) ? target[name] : ABSENT,
    );
  }
}

function setGlobal(name: string, value: unknown): void {
  const target = globalThis as any;
  savePreviousGlobal(name, target);

  const desc = Object.getOwnPropertyDescriptor(target, name);
  if (!desc || desc.writable || desc.configurable) {
    Object.defineProperty(target, name, {
      value,
      configurable: true,
      writable: true,
    });
  }
}

function restoreGlobals(): void {
  const target = globalThis as any;

  for (const [name, value] of previousGlobals.entries()) {
    if (value === ABSENT) {
      delete target[name];
    } else {
      Object.defineProperty(target, name, {
        value,
        configurable: true,
        writable: true,
      });
    }
  }

  previousGlobals.clear();
}

function extractProxyConfig(config: any): Record<string, unknown> {
  return (config?.env ?? {}) as Record<string, unknown>;
}

function installBrowserCompatibleBase64(window: DOMWindow): void {
  const target = window as any;

  const InvalidCharacterError = (message: string) =>
    new target.DOMException(message, "InvalidCharacterError");

  const isValidBase64 = (input: string): boolean => {
    if (input.length === 0) return true;
    if (/\s/.test(input)) return false;
    if (input.length % 4 !== 0) return false;
    return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input);
  };

  target.atob = (input: string): string => {
    const str = String(input);

    if (!isValidBase64(str)) {
      throw InvalidCharacterError("The string to be decoded contains invalid characters.");
    }

    try {
      return Buffer.from(str, "base64").toString("binary");
    } catch {
      throw InvalidCharacterError("The string to be decoded contains invalid characters.");
    }
  };

  target.btoa = (input: string): string => {
    const str = String(input);

    for (let i = 0; i < str.length; i++) {
      if (str.charCodeAt(i) > 0xff) {
        throw InvalidCharacterError("The string to be encoded contains invalid characters.");
      }
    }

    try {
      return Buffer.from(str, "binary").toString("base64");
    } catch {
      throw InvalidCharacterError("The string to be encoded contains invalid characters.");
    }
  };
}

function installNodeWebApis(window: DOMWindow): void {
  const nodeGlobals = globalThis as any;
  const target = window as any;

  const passthroughKeys = [
    "fetch",
    "Headers",
    "Request",
    "Response",
    "FormData",
    "AbortController",
    "AbortSignal",
    "TextEncoder",
    "TextDecoder",
    "ReadableStream",
    "WritableStream",
    "TransformStream",
    "CompressionStream",
    "DecompressionStream",
    "structuredClone",
    "crypto",
  ];

  for (const key of passthroughKeys) {
    if (target[key] == null && nodeGlobals[key] != null) {
      target[key] = nodeGlobals[key];
    }
  }

  target.setTimeout = globalThis.setTimeout.bind(globalThis);
  target.clearTimeout = globalThis.clearTimeout.bind(globalThis);
  target.setInterval = globalThis.setInterval.bind(globalThis);
  target.clearInterval = globalThis.clearInterval.bind(globalThis);
  target.queueMicrotask = globalThis.queueMicrotask.bind(globalThis);

  if (typeof target.matchMedia !== "function") {
    target.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }

  if (typeof target.requestIdleCallback !== "function") {
    target.requestIdleCallback = (callback: IdleRequestCallback) => {
      const start = Date.now();
      return globalThis.setTimeout(() => {
        callback({
          didTimeout: false,
          timeRemaining: () => Math.max(0, 50 - (Date.now() - start)),
        });
      }, 1);
    };
  }

  if (typeof target.cancelIdleCallback !== "function") {
    target.cancelIdleCallback = (id: number) => {
      globalThis.clearTimeout(id);
    };
  }

  if (typeof target.ResizeObserver !== "function") {
    target.ResizeObserver = class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }

  if (typeof target.IntersectionObserver !== "function") {
    target.IntersectionObserver = class IntersectionObserver {
      readonly root = null;
      readonly rootMargin = "0px";
      readonly thresholds = [0];

      constructor(_: IntersectionObserverCallback, __?: IntersectionObserverInit) {}

      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    };
  }

  if (typeof target.DOMException === "undefined") {
    target.DOMException = class DOMException extends Error {
      readonly name: string;
      readonly code: number;

      constructor(message?: string, name?: string) {
        super(message);
        this.name = name || "UnknownError";
        this.code = 0;
      }

      static create(window: any, args: any[]): DOMException {
        const [message, name] = args;
        return new target.DOMException(message, name);
      }
    };
  }

  if (typeof target.CloseEvent === "undefined") {
    target.CloseEvent = class CloseEvent extends target.Event {
      readonly code: number;
      readonly reason: string;
      readonly wasClean: boolean;

      constructor(type: string, eventInitDict?: { code?: number; reason?: string; wasClean?: boolean }) {
        super(type);
        this.code = eventInitDict?.code || 0;
        this.reason = eventInitDict?.reason || "";
        this.wasClean = eventInitDict?.wasClean || false;
      }
    };
  }

  installBrowserCompatibleBase64(window);

  target.WebSocket = WebSocket as any;
  target.OriginalWebSocket = WebSocket as any;
  target.global = target;
  target.process = process;
}

function installSafeStorage(window: DOMWindow): void {
  const makeStorage = () => {
    const store = new Map<string, string>();
    return {
      get length() {
        return store.size;
      },
      clear() {
        store.clear();
      },
      getItem(key: string) {
        return store.has(key) ? store.get(key)! : null;
      },
      key(index: number) {
        return Array.from(store.keys())[index] ?? null;
      },
      removeItem(key: string) {
        store.delete(key);
      },
      setItem(key: string, value: string) {
        store.set(String(key), String(value));
      },
    };
  };

  const w = window as any;

  Object.defineProperty(w, "localStorage", {
    configurable: true,
    value: makeStorage(),
  });

  Object.defineProperty(w, "sessionStorage", {
    configurable: true,
    value: makeStorage(),
  });
}

function installWindowGlobals(window: DOMWindow): void {
  const source = window as any;

  setGlobal("window", source);
  setGlobal("self", source);
  setGlobal("top", source);
  setGlobal("parent", source);

  for (const key of WINDOW_GLOBAL_KEYS) {
    if (!(key in source)) continue;

    let value: any;
    try {
      value = source[key];
    } catch (err) {
      console.error("[WindowMock] failed reading window property:", key, err);
      continue;
    }

    if (typeof value === "undefined") continue;

    if (BOUND_FUNCTION_KEYS.has(key) && typeof value === "function") {
      setGlobal(key, value.bind(source));
    } else {
      setGlobal(key, value);
    }
  }
}

function applyProxyConfig(window: DOMWindow, config: any): void {
  const env = extractProxyConfig(config);
  const target = window as any;

  const tokenStr = env.token as string | undefined;
  const jwtStr = env.TENSORFLEET_JWT as string | undefined;

  console.log('[WindowMock] applyProxyConfig called with env:', {
    hasToken: tokenStr != null,
    hasTENSORFLEET_JWT: jwtStr != null,
    tokenPreview: tokenStr ? `${tokenStr.slice(0, 8)}...` : undefined,
    jwtPreview: jwtStr ? `${jwtStr.slice(0, 8)}...` : undefined,
  });

  Object.assign(target, env);

  if (env.proxyUrl != null) {
    target.TENSORFLEET_PROXY_URL = env.proxyUrl;
    // Also set on globalThis for CLI mode where ros2-bridge reads from globalThis
    setGlobal("TENSORFLEET_PROXY_URL", env.proxyUrl);
  }

  if (env.vmManagerUrl != null) {
    target.TENSORFLEET_VM_MANAGER_URL = env.vmManagerUrl;
    setGlobal("TENSORFLEET_VM_MANAGER_URL", env.vmManagerUrl);
  }

  if (env.nodeId != null) {
    target.TENSORFLEET_NODE_ID = env.nodeId;
    setGlobal("TENSORFLEET_NODE_ID", env.nodeId);
  }

  // Handle token from either 'token' field or 'TENSORFLEET_JWT' env variable
  if (env.token != null) {
    target.TENSORFLEET_JWT = env.token;
    setGlobal("TENSORFLEET_JWT", env.token);
    console.log('[WindowMock] Set TENSORFLEET_JWT from env.token');
  } else if (env.TENSORFLEET_JWT != null) {
    target.TENSORFLEET_JWT = env.TENSORFLEET_JWT;
    setGlobal("TENSORFLEET_JWT", env.TENSORFLEET_JWT);
    console.log('[WindowMock] Set TENSORFLEET_JWT from env.TENSORFLEET_JWT');
  } else {
    console.log('[WindowMock] No token found in config env');
  }

  target.__TENSORFLEET_CONFIG__ = config;
  target.__TENSORFLEET_ENV__ = env;
}

function createDom(): JSDOM {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
    runScripts: "outside-only",
    resources: "usable",
    storageQuota: 10_000_000,
  });

  const window = dom.window;
  const target = window as any;

  if (typeof target.DOMException === "undefined" || typeof target.DOMException.create === "undefined") {
    target.DOMException = class DOMException extends Error {
      readonly name: string;
      readonly code: number;

      constructor(message?: string, name?: string) {
        super(message);
        this.name = name || "UnknownError";
        this.code = 0;
      }

      static create(window: any, args: any[]): DOMException {
        const [message, name] = args;
        return new target.DOMException(message, name);
      }
    };
  }

  if (typeof target.CloseEvent === "undefined") {
    target.CloseEvent = class CloseEvent extends target.Event {
      readonly code: number;
      readonly reason: string;
      readonly wasClean: boolean;

      constructor(type: string, eventInitDict?: { code?: number; reason?: string; wasClean?: boolean }) {
        super(type);
        this.code = eventInitDict?.code || 0;
        this.reason = eventInitDict?.reason || "";
        this.wasClean = eventInitDict?.wasClean || false;
      }
    };
  }

  installBrowserCompatibleBase64(window);

  return dom;
}

export function setupWindowMock(config: any): void {
  restoreGlobals();

  if (!dom) {
    dom = createDom();
  }

  const window = dom.window;
  installNodeWebApis(window);
  installSafeStorage(window);
  applyProxyConfig(window, config);
  installWindowGlobals(window);
}

export function setupWindowMockForROS2Bridge(config: any): boolean {
  try {
    setupWindowMock(config);
    return true;
  } catch (error: any) {
    if (error && error.name === "DOMException") {
      console.error("[WindowMock] ROS2Bridge setup failed with DOMException:", {
        name: error.name,
        message: error.message,
        stack: error.stack,
      });
    }
    return false;
  }
}

export function clearWindowMock(): void {
  restoreGlobals();
}

export function clearROS2BridgeConnection(): void {
  try {
    const { ros2Bridge } = require("tensorfleet-ros");
    if (ros2Bridge && typeof ros2Bridge.disconnect === "function") {
      ros2Bridge.disconnect();
      console.log("[WindowMock] ROS2Bridge connection cleared");
    }
  } catch (error) {
    console.warn("[WindowMock] Failed to clear ROS2Bridge connection:", error);
  }
}

export function getCurrentProxyConfig(): any {
  return (globalThis as any).window ?? null;
}

export function setupWebSocketMock(): void {
  const g = globalThis as any;
  if (g.window) {
    g.window.WebSocket = WebSocket as any;
    g.window.OriginalWebSocket = WebSocket as any;
  }
  g.WebSocket = WebSocket as any;
}