import { getAccessToken, getTokenExpiration, isLoggedIn, refreshTokens } from "../core/api";
import { log } from "../core/env";
import type { NpuModule } from "../core/modules";

// Keeps the session alive indefinitely: refreshes the access token shortly
// before it expires, which also renews the 30-minute server session window.

const CHECK_INTERVAL_MS = 20_000;
const REFRESH_MARGIN_MS = 120_000;

export let lastRefresh: Date | null = null;

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
  if (!token) {
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
    void tick();
    const timer = window.setInterval(() => void tick(), CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  },
};
