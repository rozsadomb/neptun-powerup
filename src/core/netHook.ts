import { API_BASE } from "./base";
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
  /** Path after the app's API root, e.g. "SubjectApplication/UnScheduleCourse". */
  path: string;
  status: number;
  /** Full request URL, so listeners can read query parameters. */
  url: string;
  /**
   * The response body the app received, parsed on first access and cached.
   * Lets us reuse data the app already fetched instead of asking again.
   * Returns null when the body is missing or not JSON.
   */
  json<T = unknown>(): T | null;
}

type Listener = (call: ApiCall) => void;
type StartListener = (info: { method: string; path: string }) => void;

const listeners = new Set<Listener>();
// Notified when the app SENDS an API request, before any response: the gate
// needs to know that a refresh is in flight, not only that it has finished.
const startListeners = new Set<StartListener>();
let installed = false;
let observedCalls = 0;

// The one place where NPU does more than watch the app's requests: an API
// call can be held back for a moment before it is sent, so that it does not
// fly next to a token refresh (gate.ts tells the story). The gate answers
// null ("send it now") or a promise ("send it when this settles").
//
// Holding must never be able to lose or wedge a request of the app's:
//  - a gate that throws or rejects lets the request through;
//  - a gate that never settles is overruled by the hard cap below;
//  - a synchronous XHR cannot be deferred and is never asked about;
//  - a request the app aborted while it was held is not sent afterwards.
type SendGate = (info: { method: string; path: string }) => Promise<void> | null;
const SEND_HOLD_HARD_CAP_MS = 10_000;
let sendGate: SendGate | null = null;
let sendHoldCapMs = SEND_HOLD_HARD_CAP_MS;

/** Installs the gate consulted before each of the app's API requests is sent. */
export function setSendGate(gate: SendGate | null, hardCapMs = SEND_HOLD_HARD_CAP_MS): void {
  sendGate = gate;
  sendHoldCapMs = hardCapMs;
}

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

// Includes any institution prefix, so the hook also recognises the app's calls
// where Neptun is not mounted at the site root.
const API_MARKER = API_BASE;

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
    const originalAbort = proto.abort;
    // Per-request details, kept off the XHR object's public surface.
    interface Pending {
      method: string;
      url: string;
      async: boolean;
    }
    const pending = new WeakMap<XMLHttpRequest, Pending>();
    // Requests whose send() is being held back, so abort() can call them off.
    const held = new WeakMap<XMLHttpRequest, { cancelled: boolean }>();

    const wrappedOpen = function (this: XMLHttpRequest, ...args: unknown[]) {
      try {
        pending.set(this, { method: String(args[0]), url: String(args[1]), async: args.length < 3 || args[2] !== false });
      } catch {
        // never let bookkeeping break the app's request
      }
      return (originalOpen as (...a: unknown[]) => unknown).apply(this, args);
    } as typeof proto.open;

    // The bookkeeping for a request that is really going out now.
    const observe = (xhr: XMLHttpRequest, info: Pending, path: string) => {
      const startInfo = { method: info.method.toUpperCase(), path };
      queueMicrotask(() => {
        [...startListeners].forEach(listener => {
          try {
            listener(startInfo);
          } catch (error) {
            console.error("[NPU] net hook start listener failed", error);
          }
        });
      });
      // loadend fires once per send for every terminal outcome, after the
      // app's own load handler — so its state is already updated when we
      // report. `once` keeps a reused XHR from accumulating listeners.
      xhr.addEventListener(
        "loadend",
        () => {
          let parsed: unknown;
          let parsedDone = false;
          notify({
            method: info.method.toUpperCase(),
            path,
            status: xhr.status,
            url: info.url,
            json<T>(): T | null {
              if (!parsedDone) {
                parsedDone = true;
                try {
                  // responseText throws for non-text response types.
                  parsed = xhr.responseType === "" || xhr.responseType === "text"
                    ? JSON.parse(xhr.responseText)
                    : xhr.response;
                } catch {
                  parsed = null;
                }
              }
              return (parsed as T) ?? null;
            },
          });
        },
        { once: true }
      );
    };

    const wrappedSend = function (this: XMLHttpRequest, ...args: unknown[]) {
      const xhr = this;
      const send = () => (originalSend as (...a: unknown[]) => unknown).apply(xhr, args);
      let info: Pending | undefined;
      let path = "";
      let hold: Promise<void> | null = null;
      try {
        info = pending.get(xhr);
        if (info && info.url.includes(API_MARKER)) {
          path = info.url.slice(info.url.indexOf(API_MARKER) + API_MARKER.length).split(/[?#]/)[0];
          if (info.async && sendGate) {
            hold = sendGate({ method: info.method.toUpperCase(), path });
          }
        } else {
          info = undefined;
        }
      } catch {
        hold = null; // a failing gate must not cost the app its request
      }
      if (!info) {
        return send();
      }
      const request = info;
      if (!hold) {
        try {
          observe(xhr, request, path);
        } catch {
          // ignore, the call itself must proceed untouched
        }
        return send();
      }

      // Held: the app has called send() and sees an XHR that simply has not
      // answered yet. A request reports as started only when it really goes
      // out, so a refresh waiting for the app's requests to drain is not
      // waiting for the very ones parked behind it.
      const state = { cancelled: false };
      held.set(xhr, state);
      let released = false;
      const proceed = () => {
        if (released) {
          return;
        }
        released = true;
        clearTimeout(timer);
        if (held.get(xhr) === state) {
          held.delete(xhr);
        }
        // Aborted meanwhile, or opened again for something else: not ours to send.
        if (state.cancelled || pending.get(xhr) !== request) {
          return;
        }
        try {
          observe(xhr, request, path);
        } catch {
          // ignore, the call itself must proceed untouched
        }
        try {
          send();
        } catch (error) {
          // The app's send() returned long ago; there is nobody to throw at.
          console.error("[NPU] a held request could not be sent", error);
        }
      };
      const timer = setTimeout(proceed, sendHoldCapMs);
      hold.then(proceed, proceed);
      return undefined;
    } as typeof proto.send;

    const wrappedAbort = function (this: XMLHttpRequest, ...args: unknown[]) {
      try {
        const state = held.get(this);
        if (state) {
          state.cancelled = true;
        }
      } catch {
        // never let bookkeeping break the app's abort
      }
      return (originalAbort as (...a: unknown[]) => unknown).apply(this, args);
    } as typeof proto.abort;

    proto.open = wrappedOpen;
    proto.send = wrappedSend;
    proto.abort = wrappedAbort;
    // Across a Xray membrane the assignment can silently fail to apply to the
    // page's own constructor. Read it back before trusting the hook, and undo
    // it if it did not land, so callers fall back to polling instead of
    // waiting for events that will never arrive.
    if (proto.open !== wrappedOpen || new target.XMLHttpRequest().open !== wrappedOpen) {
      proto.open = originalOpen;
      proto.send = originalSend;
      proto.abort = originalAbort;
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

/** Subscribes to the moment the app sends an API request. Returns an unsubscribe function. */
export function onApiStart(listener: StartListener): () => void {
  startListeners.add(listener);
  install();
  return () => {
    startListeners.delete(listener);
  };
}

/** How many app API calls the hook has seen; 0 suggests it cannot observe the page. */
export function observedCallCount(): number {
  return observedCalls;
}
