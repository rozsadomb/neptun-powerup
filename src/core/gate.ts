// Serialises NPU's own requests against the token refresh.
//
// The app never has a request in flight while it refreshes: its interceptor
// queues every call until the new token has arrived. NPU's fetches bypass
// that queue, so a course-watch poll or a planner check can run concurrently
// with a refresh — ours or the app's. If the server re-issues its cookie on
// ordinary responses as well, the two responses race and the browser can end
// up keeping the stale one; the next refresh then sends a cookie the server
// no longer knows and gets a 401.
//
// The Debrecen logs have exactly that shape: sessions died at random points
// (3, 6, 9, 24 minutes), the failing refresh always came right after one that
// coincided with a background poll, and the 401 carried an empty body — an
// authentication-layer rejection, not an application "session expired".
//
// Rules:
//  - no NPU request while a refresh is running (ours or the app's);
//  - no refresh while NPU requests are running;
//  - a refresh announces itself BEFORE waiting for the requests to drain, so
//    a steady stream of polls cannot starve it (writer preference);
//  - every mark has an owner id: ending one refresh never erases another
//    party's mark (the app may be mid-flight while ours times out);
//  - every wait is capped and event-driven, so a hung request can slow
//    things down but never freeze them, and a throttled background tab is
//    not left polling.

// A refresh that has not ended after this long is assumed lost. Every real
// refresh ends its own mark (ours in a finally, the app's on loadend, which
// fires for load/error/abort/timeout alike), so this only guards against a
// mark whose owner vanished. It must outlive the longest legitimate refresh:
// the app-driven attempt waits 10 s for the send and 20 s for the response,
// and our own fetch is aborted at 45 s.
export const REFRESH_STALE_MS = 60_000;
// Requests wait for a refresh as long as its mark can live — releasing them
// earlier would put a request's response next to a slow refresh's response,
// which is the very race the gate exists to prevent.
const REQUEST_MAX_WAIT_MS = REFRESH_STALE_MS;
const QUIET_MAX_WAIT_MS = 10_000;
// Waiters re-check at least this often even without an event, so a mark going
// stale or a grace period ending is noticed.
const RECHECK_MS = 1_000;

export type RefreshOwner = "npu" | "app";

interface Mark {
  id: number;
  owner: RefreshOwner;
  startedAt: number;
}

// The marks and the in-flight count are per tab, but the refresh cookie is
// per browser: a sibling tab's refresh races our requests, and its requests
// race our refresh, exactly as our own would. api.ts plugs in the cross-tab
// view (its localStorage lease and per-tab request markers).
export interface CrossTab {
  /** Another tab holds the refresh lease. */
  refreshing(): boolean;
  /** Another tab has a request in flight. */
  requesting(): boolean;
  /** This tab's in-flight count changed — publish it for the others. */
  publish(count: number): void;
}
let crossTab: CrossTab = { refreshing: () => false, requesting: () => false, publish: () => {} };
export function setCrossTab(view: CrossTab): void {
  crossTab = view;
}

// The app's own API XHRs (start → loadend, fed from the net hook): the app
// queues nothing at our refresh margin, so a refresh must wait for these as
// well. Timestamps rather than a counter, so a missed loadend can never wedge
// the count for good.
const APP_REQUEST_STALE_MS = 60_000;
let appRequests: number[] = [];

let marks: Mark[] = [];
let nextId = 1;
let inFlight = 0;
let holdUntil = 0; // grace after a refresh (the app stores the new token ~1 s after the response)
const slotWaiters = new Set<() => void>();
const quietWaiters = new Set<() => void>();

function wake(waiters: Set<() => void>): void {
  const pending = [...waiters];
  waiters.clear();
  pending.forEach(resolve => resolve());
}

function prune(): void {
  const now = Date.now();
  const before = marks.length;
  marks = marks.filter(mark => now - mark.startedAt < REFRESH_STALE_MS);
  if (marks.length !== before && marks.length === 0) {
    wake(slotWaiters);
  }
}

export function isRefreshing(): boolean {
  prune();
  return marks.length > 0;
}

/** True when a refresh other than the given one is running. */
export function otherRefreshActive(exceptId: number): boolean {
  prune();
  return marks.some(mark => mark.id !== exceptId);
}

export function markRefreshStart(owner: RefreshOwner): number {
  const id = nextId++;
  marks.push({ id, owner, startedAt: Date.now() });
  setTimeout(prune, REFRESH_STALE_MS + 50);
  return id;
}

export function markRefreshEnd(id: number, graceMs = 0): void {
  marks = marks.filter(mark => mark.id !== id);
  if (graceMs > 0) {
    holdUntil = Math.max(holdUntil, Date.now() + graceMs);
    setTimeout(() => wake(slotWaiters), graceMs + 10);
  }
  if (marks.length === 0) {
    wake(slotWaiters);
  }
}

/** NPU's own requests in flight (the app's are counted separately). */
export function inFlightRequests(): number {
  return inFlight;
}

export function appRequestsInFlight(): number {
  const now = Date.now();
  appRequests = appRequests.filter(startedAt => now - startedAt < APP_REQUEST_STALE_MS);
  return appRequests.length;
}

function localBusy(): boolean {
  return inFlight > 0 || appRequestsInFlight() > 0;
}

function publish(): void {
  crossTab.publish(inFlight + appRequestsInFlight());
}

export function appRequestStarted(): void {
  appRequests.push(Date.now());
  publish();
}

export function appRequestEnded(): void {
  appRequests.shift();
  publish();
  if (!localBusy()) {
    wake(quietWaiters);
  }
}

function requestsBlocked(): boolean {
  return isRefreshing() || Date.now() < holdUntil || crossTab.refreshing();
}

/** Before an NPU request: waits until no refresh is running. Returns the wait in ms. */
export async function waitForRequestSlot(): Promise<number> {
  const started = Date.now();
  while (requestsBlocked()) {
    const remaining = REQUEST_MAX_WAIT_MS - (Date.now() - started);
    if (remaining <= 0) {
      break;
    }
    await new Promise<void>(resolve => {
      slotWaiters.add(resolve);
      setTimeout(resolve, Math.min(remaining, RECHECK_MS));
    });
  }
  return Date.now() - started;
}

/**
 * Before a refresh: waits until NPU's own requests, the app's own requests
 * and the other tabs' requests have drained. Returns the wait in ms.
 */
export async function waitForQuiet(): Promise<number> {
  const started = Date.now();
  while (localBusy() || crossTab.requesting()) {
    const remaining = QUIET_MAX_WAIT_MS - (Date.now() - started);
    if (remaining <= 0) {
      break;
    }
    await new Promise<void>(resolve => {
      quietWaiters.add(resolve);
      setTimeout(resolve, Math.min(remaining, RECHECK_MS));
    });
  }
  return Date.now() - started;
}

/** Counts a request as in flight until the returned function is called. */
export function beginRequest(): () => void {
  inFlight++;
  publish();
  let released = false;
  return () => {
    if (!released) {
      released = true;
      inFlight--;
      publish();
      if (!localBusy()) {
        wake(quietWaiters);
      }
    }
  };
}
