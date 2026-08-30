import { appPath } from "./base";

// Watches SPA route changes: hooks history.pushState/replaceState and
// listens to popstate, with a low-frequency interval as a safety net.
//
// Paths are reported with the institution prefix stripped, so every module can
// match plain "/hallgatoi/..." routes regardless of where Neptun is mounted.

type RouteListener = (path: string) => void;

const listeners: RouteListener[] = [];
let lastPath = "";

function emitIfChanged(): void {
  const path = appPath(location.pathname);
  if (path === lastPath) {
    return;
  }
  lastPath = path;
  listeners.forEach(listener => {
    try {
      listener(path);
    } catch (error) {
      console.error("[NPU] route listener failed", error);
    }
  });
}

export function initRouter(): void {
  const wrap = (method: "pushState" | "replaceState") => {
    const original = history[method].bind(history);
    history[method] = (...args: Parameters<History["pushState"]>) => {
      original(...args);
      queueMicrotask(emitIfChanged);
    };
  };
  wrap("pushState");
  wrap("replaceState");
  window.addEventListener("popstate", () => queueMicrotask(emitIfChanged));
  window.setInterval(emitIfChanged, 1000);
  emitIfChanged();
}

export function onRouteChange(listener: RouteListener): void {
  listeners.push(listener);
  if (lastPath) {
    listener(lastPath);
  }
}

export function currentPath(): string {
  return appPath(location.pathname);
}
