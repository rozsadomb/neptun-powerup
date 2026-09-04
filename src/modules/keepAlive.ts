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
import { diag, fmtDuration, hhmmss } from "../core/diag";
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

// Experimental: one tiny read-only request at this interval, in case the
// server only slides its session window on ordinary requests and not on the
// token refresh itself (suspected where sessions are 15 minutes and expire
// despite successful refreshes). Switchable in the settings panel.
const ACTIVITY_INTERVAL_MS = 4 * 60_000;

// A tick this late means the tab was throttled (Chromium: ~60 s wake-ups in
// the background) or put to sleep entirely (Opera snoozes idle tabs). Both
// matter when a session dies, so both are logged.
const LATE_TICK_MS = 45_000;
const SLEPT_TICK_MS = 150_000;

export let lastRefresh: Date | null = null;
// Whether the keep-alive is actually running, so the badge reports what is
// true rather than assuming the module is on: it can be switched off in the
// settings, or its activation can have thrown.
export let running = false;

export function isActivityPingEnabled(): boolean {
  return storage.get<boolean>("keepAlive", "activityPing") !== false;
}

export function setActivityPingEnabled(enabled: boolean): void {
  storage.set("keepAlive", "activityPing", enabled);
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
    diag(
      `kidobásvédelem indul — token kiadva ${issued ? hhmmss(issued.getTime()) : "?"}, lejár ${expires ? hhmmss(expires.getTime()) : "?"}; ` +
        `a munkamenet (sessionStorage szerint) ${sessionExp ? hhmmss(sessionExp.getTime()) + "-kor" : "?"} jár le; ` +
        `tevékenység-jelzés: ${isActivityPingEnabled() ? "BE" : "KI"}`
    );

    // When the app refreshes tokens itself, the cookie has already rotated —
    // taking our own turn right after would spend a stale cookie.
    const unsubscribe = onApiCall(call => {
      if (call.path === "Account/GetNewTokens") {
        noteExternalRefresh();
        diag(`az app maga frissített: HTTP ${call.status}`);
        if (call.status >= 200 && call.status < 300) {
          lastRefresh = new Date();
        }
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
      unsubscribe();
      window.clearTimeout(startup);
      window.clearInterval(timer);
      window.clearInterval(pinger);
    };
  },
};
