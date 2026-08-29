import { log } from "./env";

// Observes the Neptun app's own API calls so modules can react to state the
// user changed through the app's UI.
//
// The app talks to its API exclusively over XMLHttpRequest, while NPU's own
// client uses fetch — so hooking XHR shows us the app's mutations and never
// our own requests (no feedback loop).
//
// Under a userscript manager the script may run in an isolated world, where
// patching our own XMLHttpRequest would not affect the page. We therefore
// patch the page's constructor via unsafeWindow when it is available. If the
// patch cannot observe anything, callers must still have a polling fallback:
// this hook is an accelerator, never the only source of truth.

export interface ApiCall {
  method: string;
  /** Path after the /hallgatoi/api/ prefix, e.g. "SubjectApplication/UnScheduleCourse". */
  path: string;
  status: number;
}

type Listener = (call: ApiCall) => void;

const listeners = new Set<Listener>();
let installed = false;
let observedCalls = 0;

declare const unsafeWindow: (Window & typeof globalThis) | undefined;

// The page's own window when the script runs in an isolated world.
function pageWindow(): Window & typeof globalThis {
  try {
    if (typeof unsafeWindow !== "undefined" && unsafeWindow) {
      return unsafeWindow;
    }
  } catch {
    // accessing unsafeWindow can throw depending on the manager
  }
  return window as Window & typeof globalThis;
}

const API_MARKER = "/hallgatoi/api/";

function notify(call: ApiCall): void {
  observedCalls++;
  // Deferred on purpose: a listener must never run inside the app's own event
  // dispatch, where an exception of ours would surface as an Angular error.
  queueMicrotask(() => {
    [...listeners].forEach(listener => {
      try {
        listener(call);
      } catch (error) {
        console.error("[NPU] net hook listener failed", error);
      }
    });
  });
}

// Installs once and stays for the page's lifetime. Removing the patch later
// would clobber anything that wrapped XHR after us (other userscripts, an
// analytics SDK, a lazily loaded Angular chunk); with no subscribers the
// patch is inert anyway.
function install(): void {
  if (installed) {
    return;
  }
  installed = true;

  try {
    const target = pageWindow();
    const proto = target.XMLHttpRequest?.prototype;
    if (!proto) {
      log("net hook unavailable: no XMLHttpRequest prototype");
      return;
    }

    const originalOpen = proto.open;
    const originalSend = proto.send;
    // Per-request details, kept off the XHR object's public surface.
    const pending = new WeakMap<XMLHttpRequest, { method: string; url: string }>();

    const wrappedOpen = function (this: XMLHttpRequest, ...args: unknown[]) {
      try {
        pending.set(this, { method: String(args[0]), url: String(args[1]) });
      } catch {
        // never let bookkeeping break the app's request
      }
      return (originalOpen as (...a: unknown[]) => unknown).apply(this, args);
    } as typeof proto.open;

    const wrappedSend = function (this: XMLHttpRequest, ...args: unknown[]) {
      try {
        const info = pending.get(this);
        if (info && info.url.includes(API_MARKER)) {
          // loadend fires once per send for every terminal outcome, after the
          // app's own load handler — so its state is already updated when we
          // report. `once` keeps a reused XHR from accumulating listeners.
          this.addEventListener(
            "loadend",
            () => {
              const path = info.url.slice(info.url.indexOf(API_MARKER) + API_MARKER.length).split(/[?#]/)[0];
              notify({ method: info.method.toUpperCase(), path, status: this.status });
            },
            { once: true }
          );
        }
      } catch {
        // ignore, the call itself must proceed untouched
      }
      return (originalSend as (...a: unknown[]) => unknown).apply(this, args);
    } as typeof proto.send;

    proto.open = wrappedOpen;
    proto.send = wrappedSend;
    // Across a Xray membrane the assignment can silently fail to apply to the
    // page's own constructor. Read it back before trusting the hook, and undo
    // it if it did not land, so callers fall back to polling instead of
    // waiting for events that will never arrive.
    if (proto.open !== wrappedOpen || new target.XMLHttpRequest().open !== wrappedOpen) {
      proto.open = originalOpen;
      proto.send = originalSend;
      log("net hook did not apply to the page, falling back to polling");
      return;
    }

    log("net hook installed");
  } catch (error) {
    // A sandboxed world (e.g. Firefox Xray vision) may refuse the patch.
    // Callers must keep working from their polling fallback, so never let
    // this failure escape into their activate().
    log("net hook could not be installed, falling back to polling", error);
  }
}

/**
 * Subscribes to the app's API calls. Returns an unsubscribe function.
 * Installation never throws: if the hook cannot observe the page, callers
 * simply never receive events and must rely on their own polling.
 */
export function onApiCall(listener: Listener): () => void {
  listeners.add(listener);
  install();
  return () => {
    listeners.delete(listener);
  };
}

/** How many app API calls the hook has seen; 0 suggests it cannot observe the page. */
export function observedCallCount(): number {
  return observedCalls;
}
