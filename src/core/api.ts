import { API_BASE } from "./base";
import { log } from "./env";

// Thin client for the new Neptun REST API. The Angular app keeps its access
// token in sessionStorage, so we can share its session: read the token for
// our own calls and write refreshed tokens back so the app stays in sync.

export { API_BASE };

const TOKEN_KEY = "access_token";
const TOKEN_EXP_KEY = "access_token_expiration_date";
const SESSION_EXP_KEY = "session_expiration_date";

export interface ApiResponse<T> {
  data: T;
  notification: unknown[];
}

export function getAccessToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function isLoggedIn(): boolean {
  return !!getAccessToken();
}

// Decodes the exp claim (seconds) of a JWT; null if unparseable.
export function getTokenExpiration(token: string): Date | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? new Date(payload.exp * 1000) : null;
  } catch {
    return null;
  }
}

export function getSessionExpiration(): Date | null {
  const value = sessionStorage.getItem(SESSION_EXP_KEY);
  return value ? new Date(value) : null;
}

// The server ROTATES the refresh cookie: every successful GetNewTokens issues
// a new one and invalidates the previous. Two refreshes racing each other
// therefore make the loser send an already-spent cookie, get a 401 — and
// Neptun logs the user out. All refreshes must be serialised, both within
// this tab and across tabs, and we must stay out of the app's way when it
// refreshes on its own.

const REFRESH_LOCK_KEY = "npu-ng:refresh-lock";
// How long another refresher is assumed to still be in flight.
const LOCK_TTL_MS = 5_000;
// After someone else refreshed, our token in sessionStorage is stale but the
// cookie is fresh; wait this long before refreshing again ourselves.
const EXTERNAL_QUIET_MS = 10_000;

let refreshInFlight: Promise<number | null> | null = null;
let lastExternalRefreshAt = 0;
// The access token the 401 verdict was passed on — NOT a plain boolean. The
// verdict is about one dead session, but logging in again is an SPA route
// change, so the script keeps running across it: a page-lifetime flag would
// survive into the new session and could only be cleared by a manual reload.
// It would then not just leave the badge nagging, but keep refreshTokens()
// bailing out, so the new session would silently run with no keep-alive.
let sessionLostForToken: string | null = null;

/** Called when the app itself was seen refreshing tokens, so we back off. */
export function noteExternalRefresh(): void {
  lastExternalRefreshAt = Date.now();
}

/** True once a refresh came back 401: the session is gone, stop hammering. */
export function isSessionLost(): boolean {
  if (sessionLostForToken === null) {
    return false;
  }
  // Any other token — including none, on the login page — means we have moved
  // on from the dead session, so the verdict no longer applies. This also
  // undoes a verdict we passed while losing a refresh race: the winner's token
  // lands in sessionStorage and the session turns out to be alive after all.
  if (getAccessToken() !== sessionLostForToken) {
    sessionLostForToken = null;
    return false;
  }
  return true;
}

function otherTabRefreshing(): boolean {
  try {
    const raw = localStorage.getItem(REFRESH_LOCK_KEY);
    if (!raw) {
      return false;
    }
    const at = Number(raw);
    return Number.isFinite(at) && Date.now() - at < LOCK_TTL_MS;
  } catch {
    return false;
  }
}

function takeLock(): void {
  try {
    localStorage.setItem(REFRESH_LOCK_KEY, String(Date.now()));
  } catch {
    // storage may be unavailable; serialising within the tab still helps
  }
}

async function doRefresh(): Promise<number | null> {
  const token = getAccessToken();
  if (!token) {
    return null;
  }
  takeLock();
  // The lock is a LEASE, not a single 5 s stamp. Under load a GetNewTokens can
  // take longer than the TTL, and the other tab would then read the lock as
  // stale and send the very same not-yet-rotated cookie — the loser of that
  // race gets a 401 and the server logs the user out, which is exactly what
  // this whole mechanism exists to prevent. Renewing while the request is in
  // flight closes that window, and because the renewer dies with the tab, a
  // tab closed mid-refresh still lets the lock expire on its own.
  const renew = window.setInterval(takeLock, LOCK_TTL_MS / 2);
  try {
    const response = await fetch(`${API_BASE}Account/GetNewTokens`, {
      method: "POST",
      credentials: "include",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      if (response.status === 401) {
        sessionLostForToken = token;
        log("token refresh rejected (401) — the session is no longer valid");
      } else {
        log(`Token refresh failed with status ${response.status}`);
      }
      return null;
    }
    const result = (await response.json()) as { accessToken: string; sessionTimeoutInMinutes: number };
    sessionStorage.setItem(TOKEN_KEY, result.accessToken);
    const tokenExp = getTokenExpiration(result.accessToken);
    if (tokenExp) {
      sessionStorage.setItem(TOKEN_EXP_KEY, tokenExp.toISOString());
    }
    const sessionExp = new Date(Date.now() + result.sessionTimeoutInMinutes * 60_000);
    sessionStorage.setItem(SESSION_EXP_KEY, sessionExp.toISOString());
    return result.sessionTimeoutInMinutes;
  } finally {
    window.clearInterval(renew);
    // Stamp on every exit path, failures included. A failed attempt may still
    // have rotated the cookie server-side, so the quiet period has to hold
    // even then — the old code left no lock at all after a failure.
    takeLock();
  }
}

/**
 * Requests a new access token. Concurrent callers share one request; if
 * another tab or the app itself refreshed a moment ago, this is a no-op so
 * the rotated cookie is never used twice.
 */
export function refreshTokens(): Promise<number | null> {
  if (isSessionLost()) {
    return Promise.resolve(null);
  }
  if (refreshInFlight) {
    return refreshInFlight;
  }
  if (Date.now() - lastExternalRefreshAt < EXTERNAL_QUIET_MS || otherTabRefreshing()) {
    return Promise.resolve(null);
  }
  refreshInFlight = doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

// Refreshes the access token if it expires within the given margin.
export async function ensureFreshToken(marginMs = 60_000): Promise<void> {
  const token = getAccessToken();
  if (!token) {
    return;
  }
  const expiration = getTokenExpiration(token);
  if (!expiration || expiration.getTime() - Date.now() < marginMs) {
    await refreshTokens();
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

// Extracts a readable message from a Neptun API error response body.
function parseErrorBody(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      modelStateErrors?: { key: string; errors: string[] }[];
      notification?: { message?: string }[];
      message?: string;
    };
    const parts: string[] = [];
    parsed.modelStateErrors?.forEach(e => parts.push(...e.errors));
    parsed.notification?.forEach(n => n.message && parts.push(n.message));
    if (parsed.message) {
      parts.push(parsed.message);
    }
    if (parts.length > 0) {
      return parts.join("\n");
    }
  } catch {
    // fall through
  }
  return body.slice(0, 300);
}

// Authenticated POST returning the full response envelope.
export async function apiPost<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
  await ensureFreshToken();
  const call = () =>
    fetch(API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken()}` },
      body: JSON.stringify(body),
    });
  let response = await call();
  if (response.status === 401) {
    await refreshTokens();
    response = await call();
  }
  const text = await response.text();
  if (!response.ok) {
    throw new ApiError(parseErrorBody(text), response.status);
  }
  return JSON.parse(text) as ApiResponse<T>;
}

// Authenticated API call. Refreshes the token up front when needed and
// retries once on 401.
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  await ensureFreshToken();
  const call = () =>
    fetch(API_BASE + path, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${getAccessToken()}` },
    });
  let response = await call();
  if (response.status === 401) {
    await refreshTokens();
    response = await call();
  }
  if (!response.ok) {
    throw new Error(`API call ${path} failed with status ${response.status}`);
  }
  const result = (await response.json()) as ApiResponse<T>;
  return result.data;
}
