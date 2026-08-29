import { log } from "./env";

// Thin client for the new Neptun REST API. The Angular app keeps its access
// token in sessionStorage, so we can share its session: read the token for
// our own calls and write refreshed tokens back so the app stays in sync.

export const API_BASE = "/hallgatoi/api/";

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

// Requests a new access token. The endpoint accepts an expired Bearer token;
// what matters is the HttpOnly refresh cookie. Returns the new session
// timeout in minutes, or null on failure.
export async function refreshTokens(): Promise<number | null> {
  const token = getAccessToken();
  if (!token) {
    return null;
  }
  const response = await fetch(`${API_BASE}Account/GetNewTokens`, {
    method: "POST",
    credentials: "include",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    log(`Token refresh failed with status ${response.status}`);
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
