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
  "localStorage",
  "sessionStorage",
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

  target.WebSocket = WebSocket as any;
  target.global = target;
  target.process = process;
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
    } catch {
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

  Object.assign(target, env);

  if (env.proxyUrl != null) {
    target.TENSORFLEET_PROXY_URL = env.proxyUrl;
  }

  if (env.vmManagerUrl != null) {
    target.TENSORFLEET_VM_MANAGER_URL = env.vmManagerUrl;
  }

  if (env.nodeId != null) {
    target.TENSORFLEET_NODE_ID = env.nodeId;
  }

  if (env.token != null) {
    target.TENSORFLEET_JWT = env.token;
  }

  target.__TENSORFLEET_CONFIG__ = config;
  target.__TENSORFLEET_ENV__ = env;
}

function createDom(): JSDOM {
  return new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
    runScripts: "outside-only",
    resources: "usable",
    storageQuota: 10_000_000,
  });
}

export function setupWindowMock(config: any): void {
  clearWindowMock();

  dom = createDom();

  const window = dom.window;
  installNodeWebApis(window);
  applyProxyConfig(window, config);
  installWindowGlobals(window);
}

export function setupWindowMockForROS2Bridge(config: any): boolean {
  try {
    setupWindowMock(config);
    return true;
  } catch (error: any) {
    if (error instanceof DOMException) {
      console.error("[WindowMock] ROS2Bridge setup failed:", {
        name: error.name,
        message: error.message,
        stack: error.stack,
      });
    } else {
      console.error("[WindowMock] ROS2Bridge setup failed:", error);
    }
    return false;
  }
}

export function clearWindowMock(): void {
  restoreGlobals();

  if (dom) {
    dom.window.close();
    dom = null;
  }
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
  }
  g.WebSocket = WebSocket as any;
}