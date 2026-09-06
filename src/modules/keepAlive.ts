import {
  api,
  getAccessToken,
  getSessionExpiration,
  getTokenExpiration,
  getTokenIssuedAt,
  isAppRefreshEnabled,
  isLoggedIn,
  isSessionLost,
  refreshTokens,
  setAppRefreshEnabled,
} from "../core/api";
import { diag, fmtDuration, hhmmss, noteAppCall, sanitize, setLoginTime } from "../core/diag";
import { log } from "../core/env";
import type { NpuModule } from "../core/modules";
import { onApiCall, onApiStart } from "../core/netHook";
import * as storage from "../core/storage";

// Keeps the session alive indefinitely: asks for a token refresh shortly
// before the token expires, which also renews the server session window.
// HOW a refresh happens — app first, our own fetch only as a fallback, all
// of it serialised against NPU's own requests and against other tabs — lives
// in core/api.ts (refreshTokens) and core/gate.ts. This module only schedules
// and logs.

const CHECK_INTERVAL_MS = 20_000;
const REFRESH_MARGIN_MS = 120_000;
const STARTUP_DELAY_MS = 5_000;

// Experiment B (default OFF — it did not help in the Debrecen log): a tiny
// read-only request every few minutes, for a server that only slides its
// session on ordinary requests.
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

export { isAppRefreshEnabled, setAppRefreshEnabled };

export function isActivityPingEnabled(): boolean {
  return storage.get<boolean>("keepAlive", "activityPing") === true;
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
let ticking = false;

async function tick(): Promise<void> {
  if (ticking) {
    return; // a slow cycle must not overlap the next one
  }
  ticking = true;
  try {
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
  } finally {
    ticking = false;
  }
}

// Read-only, tiny, and never sent when the session is already known to be
// gone. Goes through api(), so it shares the gate and the single-flight refresh.
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

    // Logging only — the gate and the refresh logic are fed from the core.
    // Every call the app makes on its own is logged (path only, no
    // parameters), so the log shows when Neptun last spoke to the server.
    const unsubscribeStart = onApiStart(info => {
      if (info.path === "Account/GetNewTokens") {
        diag("az app elküldte a frissítést");
      }
    });
    const unsubscribe = onApiCall(call => {
      noteAppCall(call.path, call.status);
      if (call.path === "Account/GetNewTokens") {
        const ok = call.status >= 200 && call.status < 300;
        if (ok) {
          lastRefresh = new Date();
          diag(`az app frissített: HTTP ${call.status}`);
          // The new token lands in sessionStorage ~1 s later; log its expiry then.
          window.setTimeout(() => {
            const current = getAccessToken();
            const exp = current ? getTokenExpiration(current) : null;
            diag(`az új token ${exp ? hhmmss(exp.getTime()) + "-kor jár le" : "nem olvasható"}`);
          }, 1_500);
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
      unsubscribeStart();
      unsubscribe();
      window.clearTimeout(startup);
      window.clearInterval(timer);
      window.clearInterval(pinger);
    };
  },
};
