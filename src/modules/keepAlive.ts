import { getAccessToken, getTokenExpiration, isLoggedIn, isSessionLost, noteExternalRefresh, refreshTokens } from "../core/api";
import { log } from "../core/env";
import type { NpuModule } from "../core/modules";
import { onApiCall } from "../core/netHook";

// Keeps the session alive indefinitely: refreshes the access token shortly
// before it expires, which also renews the 30-minute server session window.
//
// The server rotates the refresh cookie, so racing the app's own refresh gets
// one of the two a 401 and logs the user out. We therefore watch the app's
// requests and stand down whenever it refreshes by itself, and we let the
// page settle before our first check.

const CHECK_INTERVAL_MS = 20_000;
const REFRESH_MARGIN_MS = 120_000;
const STARTUP_DELAY_MS = 5_000;

export let lastRefresh: Date | null = null;
// Whether the keep-alive is actually running, so the badge reports what is
// true rather than assuming the module is on: it can be switched off in the
// settings, or its activation can have thrown.
export let running = false;

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

async function tick(): Promise<void> {
  const token = getAccessToken();
  if (!token || isSessionLost()) {
    return;
  }
  const expiration = getTokenExpiration(token);
  if (!expiration || expiration.getTime() - Date.now() < REFRESH_MARGIN_MS) {
    const timeout = await refreshTokens();
    if (timeout !== null) {
      lastRefresh = new Date();
      log(`session refreshed, next window: ${timeout} minutes`);
      document.dispatchEvent(new CustomEvent("npu:session-refreshed"));
    }
  }
  nudgeAppCountdown();
}

export const keepAlive: NpuModule = {
  id: "keepAlive",
  matches: () => isLoggedIn(),
  activate() {
    // A fresh activation means a fresh session (we deactivate on logout), so
    // the previous session's refresh time must not linger on the badge.
    lastRefresh = null;

    // When the app refreshes tokens itself, the cookie has already rotated —
    // taking our own turn right after would spend a stale cookie.
    const unsubscribe = onApiCall(call => {
      if (call.path === "Account/GetNewTokens") {
        noteExternalRefresh();
        if (call.status >= 200 && call.status < 300) {
          lastRefresh = new Date();
        }
      }
    });

    // Give the app time to finish its own startup refresh before we act.
    const startup = window.setTimeout(() => void tick(), STARTUP_DELAY_MS);
    const timer = window.setInterval(() => void tick(), CHECK_INTERVAL_MS);
    running = true;
    return () => {
      running = false;
      unsubscribe();
      window.clearTimeout(startup);
      window.clearInterval(timer);
    };
  },
};
