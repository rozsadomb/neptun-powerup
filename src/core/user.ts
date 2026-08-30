import { api } from "./api";

// Who is logged in.
//
// The access token carries no identity whatsoever — its only claims are
// SessionId, WebSessionType, role and the standard timing ones — so the Neptun
// code has to come from the API. `UserInfo` is what the app itself fetches
// right after authenticating, so it is both cheap and expected.
//
// This matters because logging out and back in is an SPA route change: without
// an identity, per-user data stored by one student would be picked up by the
// next one to log in on the same machine.

interface UserInfo {
  neptunCode: string;
}

let cached: { sessionId: string | null; code: string } | null = null;
let inFlight: Promise<string | null> | null = null;

function sessionIdOfCurrentToken(): string | null {
  const token = sessionStorage.getItem("access_token");
  if (!token) {
    return null;
  }
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.SessionId === "string" ? payload.SessionId : null;
  } catch {
    return null;
  }
}

/**
 * The current student's Neptun code, or null when it is not known yet.
 * Synchronous, so callers that run on a timer can use it directly; call
 * `ensureUser()` first to make it available.
 */
export function userKey(): string | null {
  if (!cached) {
    return null;
  }
  if (!sessionStorage.getItem("access_token")) {
    return null; // logged out: the previous student's key must not linger
  }
  // A different session means a different login, so the cached code cannot be
  // trusted until it has been re-read.
  return cached.sessionId === sessionIdOfCurrentToken() ? cached.code : null;
}

/** Resolves the Neptun code, fetching it once per login. */
export function ensureUser(): Promise<string | null> {
  const known = userKey();
  if (known) {
    return Promise.resolve(known);
  }
  if (inFlight) {
    return inFlight;
  }
  inFlight = api<UserInfo>("UserInfo")
    .then(info => {
      const code = info?.neptunCode?.trim().toUpperCase() ?? "";
      if (!code) {
        return null;
      }
      cached = { sessionId: sessionIdOfCurrentToken(), code };
      return code;
    })
    .catch(() => null)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Forgets the cached identity (used when the session ends). */
export function forgetUser(): void {
  cached = null;
}
