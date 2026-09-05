import {
  api,
  getAccessToken,
  getSessionExpiration,
  getTokenExpiration,
  getTokenIssuedAt,
  isLoggedIn,
  isSessionLost,
  noteExternalRefresh,
  refreshTokens,
} from "../core/api";
import { diag, fmtDuration, hhmmss, noteAppCall, sanitize, setLoginTime } from "../core/diag";
import { log } from "../core/env";
import type { NpuModule } from "../core/modules";
import { onApiCall } from "../core/netHook";
import * as storage from "../core/storage";

// Keeps the session alive indefinitely: refreshes the access token shortly
// before it expires, which also renews the server session window.
//
// The server rotates the refresh cookie, so racing the app's own refresh gets
// one of the two a 401 and logs the user out. We therefore watch the app's
// requests and stand down whenever it refreshes by itself, and we let the
// page settle before our first check.

const CHECK_INTERVAL_MS = 20_000;
const REFRESH_MARGIN_MS = 120_000;
const STARTUP_DELAY_MS = 5_000;

// Experiment A (default ON): let the APP do the refreshing. A diagnostic log
// from Debrecen showed sessions dying 12–13 minutes after login despite our
// refreshes and our ordinary read-only requests all succeeding — so either the
// server enforces an absolute limit, or it treats the app's refresh differently
// from ours. Handing the refresh to the app separates the two: it refreshes
// through its own HttpClient, interceptors and handlers, exactly as it would
// on its own. We trigger it through the app's idle service: when the stored
// session expiry is under 150 s, a visibilitychange makes it request new
// tokens (see checkSessionExpirationAndCountdownTimer in the app). If the
// app has not refreshed within a few seconds, we fall back to our own call.
const APP_REFRESH_WAIT_MS = 10_000;
const APP_REFRESH_FAKE_REMAINING_MS = 100_000;

// Experiment B (default OFF — it did not help in the Debrecen log): a tiny
// read-only request every few minutes, for a server that only slides its
// session on ordinary requests.
const ACTIVITY_INTERVAL_MS = 4 * 60_000;

// A tick this late means the tab was throttled (Chromium: ~60 s wake-ups in
// the background) or put to sleep entirely (Opera snoozes idle tabs). Both
// matter when a session dies, so both are logged.
const LATE_TICK_MS = 45_000;
const SLEPT_TICK_MS = 150_000;

const SESSION_EXP_KEY = "session_expiration_date";

export let lastRefresh: Date | null = null;
// Whether the keep-alive is actually running, so the badge reports what is
// true rather than assuming the module is on: it can be switched off in the
// settings, or its activation can have thrown.
export let running = false;

export function isActivityPingEnabled(): boolean {
  return storage.get<boolean>("keepAlive", "activityPing") === true;
}
export function setActivityPingEnabled(enabled: boolean): void {
  storage.set("keepAlive", "activityPing", enabled);
}
export function isAppRefreshEnabled(): boolean {
  return storage.get<boolean>("keepAlive", "appRefresh") !== false;
}
export function setAppRefreshEnabled(enabled: boolean): void {
  storage.set("keepAlive", "appRefresh", enabled);
}

// The app keeps its session countdown in memory (NGXS store) and logs the
// user out client-side when it reaches zero. It re-reads the (refreshed)
// expiration from sessionStorage in two cases: on a visibilitychange event
// while the page is visible, and on a user interaction event while the
// countdown is in the idle range. Synthetic events satisfy both code paths.
function nudgeAppCountdown(): void {
  if (document.visibilityState === "visible") {
    document.dispatchEvent(new Event("visibilitychange"));
  }
  document.dispatchEvent(new Event("scroll"));
}

let lastTickAt = 0;
let lastVisibility = "";
// Counts the app's own GetNewTokens calls, so a refresh we asked the app for
// can be recognised when it happens.
let appRefreshes = 0;

// Fires a visibilitychange the app's handler will act on even in a hidden tab
// (it checks document.visibilityState, which is shadowed for the duration of
// the dispatch and restored right after).
function dispatchVisibleChange(): void {
  const hidden = document.visibilityState !== "visible";
  try {
    if (hidden) {
      Object.defineProperty(document, "visibilityState", { get: () => "visible", configurable: true });
    }
    document.dispatchEvent(new Event("visibilitychange"));
  } finally {
    if (hidden) {
      delete (document as unknown as { visibilityState?: string }).visibilityState;
    }
  }
}

async function refreshViaApp(): Promise<boolean> {
  const before = appRefreshes;
  const stored = sessionStorage.getItem(SESSION_EXP_KEY);
  // The app's idle check reads this value synchronously inside the event
  // handler; it is put back immediately afterwards.
  sessionStorage.setItem(SESSION_EXP_KEY, new Date(Date.now() + APP_REFRESH_FAKE_REMAINING_MS).toISOString());
  try {
    dispatchVisibleChange();
  } finally {
    if (stored) {
      sessionStorage.setItem(SESSION_EXP_KEY, stored);
    }
  }
  const deadline = Date.now() + APP_REFRESH_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise(resolve => window.setTimeout(resolve, 250));
    if (appRefreshes > before) {
      return true;
    }
  }
  return false;
}

async function tick(): Promise<void> {
  const now = Date.now();
  if (lastTickAt) {
    const gap = now - lastTickAt;
    if (gap > SLEPT_TICK_MS) {
      diag(`tick ${fmtDuration(gap)} késéssel futott — a fül valószínűleg ALUDT (fül: ${document.visibilityState})`);
    } else if (gap > LATE_TICK_MS) {
      diag(`tick ${fmtDuration(gap)} késéssel futott — háttérben fojtva (fül: ${document.visibilityState})`);
    }
  }
  lastTickAt = now;
  if (document.visibilityState !== lastVisibility) {
    lastVisibility = document.visibilityState;
    diag(`fül láthatósága: ${lastVisibility}`);
  }

  const token = getAccessToken();
  if (!token || isSessionLost()) {
    return;
  }
  const expiration = getTokenExpiration(token);
  if (!expiration || expiration.getTime() - now < REFRESH_MARGIN_MS) {
    if (isAppRefreshEnabled()) {
      diag(`frissítés kérése az app saját mechanizmusán át (a token ${expiration ? hhmmss(expiration.getTime()) + "-kor jár le" : "?"})`);
      if (await refreshViaApp()) {
        nudgeAppCountdown();
        return; // the outcome was logged from the app's own call
      }
      diag(`az app ${APP_REFRESH_WAIT_MS / 1000} mp alatt nem frissített — saját frissítés következik`);
      if (isSessionLost() || !getAccessToken()) {
        return;
      }
    }
    const timeout = await refreshTokens();
    if (timeout !== null) {
      lastRefresh = new Date();
      log(`session refreshed, next window: ${timeout} minutes`);
      document.dispatchEvent(new CustomEvent("npu:session-refreshed"));
    }
  }
  nudgeAppCountdown();
}

// Read-only, tiny, and never sent when the session is already known to be
// gone. Goes through api(), so it shares the single-flight token refresh.
async function activityPing(): Promise<void> {
  if (!isActivityPingEnabled() || !getAccessToken() || isSessionLost()) {
    return;
  }
  try {
    await api<unknown>("UserInfo");
    diag("tevékenység-jelzés OK (UserInfo, csak olvasás)");
  } catch (error) {
    diag(`tevékenység-jelzés HIBA: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export const keepAlive: NpuModule = {
  id: "keepAlive",
  matches: () => isLoggedIn(),
  activate() {
    // A fresh activation means a fresh session (we deactivate on logout), so
    // the previous session's refresh time must not linger on the badge.
    lastRefresh = null;
    lastTickAt = 0;
    lastVisibility = "";

    const token = getAccessToken();
    const issued = token ? getTokenIssuedAt(token) : null;
    const expires = token ? getTokenExpiration(token) : null;
    const sessionExp = getSessionExpiration();
    setLoginTime(issued ? issued.getTime() : null);
    diag(
      `kidobásvédelem indul — token kiadva ${issued ? hhmmss(issued.getTime()) : "?"}, lejár ${expires ? hhmmss(expires.getTime()) : "?"}; ` +
        `a munkamenet (sessionStorage szerint) ${sessionExp ? hhmmss(sessionExp.getTime()) + "-kor" : "?"} jár le; ` +
        `frissítés az appon át: ${isAppRefreshEnabled() ? "BE" : "KI"}, tevékenység-jelzés: ${isActivityPingEnabled() ? "BE" : "KI"}`
    );

    // Every call the app makes on its own is logged (path only, no
    // parameters), so the log shows when Neptun itself last spoke to the
    // server. When the app refreshes tokens, the cookie has already rotated —
    // taking our own turn right after would spend a stale cookie.
    const unsubscribe = onApiCall(call => {
      noteAppCall(call.path, call.status);
      if (call.path === "Account/GetNewTokens") {
        appRefreshes++;
        noteExternalRefresh();
        const ok = call.status >= 200 && call.status < 300;
        if (ok) {
          lastRefresh = new Date();
          const exp = getAccessToken() ? getTokenExpiration(getAccessToken()!) : null;
          diag(`az app frissített: HTTP ${call.status} — új token ${exp ? hhmmss(exp.getTime()) + "-kor jár le" : "?"}`);
          document.dispatchEvent(new CustomEvent("npu:session-refreshed"));
        } else {
          let body = "";
          try {
            body = sanitize(JSON.stringify(call.json<unknown>() ?? ""));
          } catch {
            // no readable body
          }
          diag(`az app frissítése ELUTASÍTVA: HTTP ${call.status}${body ? ` — a szerver üzenete: ${body}` : ""}`);
        }
      } else {
        diag(`app → ${call.path} ${call.status}`);
      }
    });

    // Give the app time to finish its own startup refresh before we act.
    const startup = window.setTimeout(() => void tick(), STARTUP_DELAY_MS);
    const timer = window.setInterval(() => void tick(), CHECK_INTERVAL_MS);
    const pinger = window.setInterval(() => void activityPing(), ACTIVITY_INTERVAL_MS);
    running = true;
    return () => {
      running = false;
      diag("kidobásvédelem leáll (kijelentkezés vagy kikapcsolás)");
      setLoginTime(null);
      unsubscribe();
      window.clearTimeout(startup);
      window.clearInterval(timer);
      window.clearInterval(pinger);
    };
  },
};
