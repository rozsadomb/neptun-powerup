import { API_BASE } from "./base";
import { diag, diagContext, fmtDuration, hhmmss, sanitize } from "./diag";
import { log } from "./env";
import {
  appRequestEnded,
  appRequestStarted,
  beginRequest,
  inFlightRequests,
  isRefreshing,
  markRefreshEnd,
  markRefreshStart,
  otherRefreshActive,
  REFRESH_STALE_MS,
  setCrossTab,
  waitForQuiet,
  waitForRequestSlot,
} from "./gate";
import * as storage from "./storage";
import { observedCallCount, onApiCall, onApiStart } from "./netHook";

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

// Decodes the iat claim (seconds) of a JWT; null if unparseable.
export function getTokenIssuedAt(token: string): Date | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.iat === "number" ? new Date(payload.iat * 1000) : null;
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
// Our own fetch must not outlive the gate's idea of a refresh (gate.ts).
const OWN_REFRESH_TIMEOUT_MS = 45_000;
// When NPU requests are still in flight after the quiet wait gave up, the
// cycle is skipped — unless the token is this close to expiring.
const FORCE_REFRESH_BELOW_MS = 30_000;
// App-driven refresh: how long to wait for the app to SEND, then for its RESPONSE.
const APP_REFRESH_WAIT_MS = 10_000;
const APP_REFRESH_RESPONSE_WAIT_MS = 20_000;
const APP_REFRESH_FAKE_REMAINING_MS = 100_000;
// The app stores the new token about a second after the response arrives
// (its refresh pipeline has a delay(1000)); NPU requests hold that long.
const APP_STORE_GRACE_MS = 1_500;
const SESSION_EXP_KEY_APP = "session_expiration_date";

let refreshInFlight: Promise<number | null> | null = null;
let lastExternalRefreshAt = 0;
// The access token the 401 verdict was passed on — NOT a plain boolean. The
// verdict is about one dead session, but logging in again is an SPA route
// change, so the script keeps running across it: a page-lifetime flag would
// survive into the new session and could only be cleared by a manual reload.
// It would then not just leave the badge nagging, but keep refreshTokens()
// bailing out, so the new session would silently run with no keep-alive.
let sessionLostForToken: string | null = null;
// This tab's latest cross-tab stamp: our own lease must never read as another
// tab's, or the app-driven attempt's lease would block our own fallback.
let ownStamp: string | null = null;

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
    diag("a „munkamenet lejárt” ítélet feloldva: másik token jelent meg (új belépés)");
    return false;
  }
  return true;
}

function otherTabRefreshing(): boolean {
  try {
    const raw = localStorage.getItem(REFRESH_LOCK_KEY);
    if (!raw || raw === ownStamp) {
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
    // A fractional suffix keeps two tabs' stamps distinct even in the same
    // millisecond, while older versions still parse it as a plain number.
    ownStamp = `${Date.now()}.${Math.floor(Math.random() * 1_000_000)}`;
    localStorage.setItem(REFRESH_LOCK_KEY, ownStamp);
  } catch {
    // storage may be unavailable; serialising within the tab still helps
  }
}

/** Exported for tests and for anything that must honour the cross-tab rules. */
export function crossTabRefreshLocked(): boolean {
  return otherTabRefreshing();
}
export function takeCrossTabLock(): void {
  takeLock();
}
export const CROSS_TAB_LOCK_RENEW_MS = LOCK_TTL_MS / 2;

// Per-tab "I have requests in flight" markers, so a sibling tab's refresh can
// wait for ours the way it waits for its own. Value = expiry; renewed while
// busy, removed when idle, ignored (and cleaned up) once expired.
const TAB_ID = Math.random().toString(36).slice(2);
const REQUEST_MARK_PREFIX = "npu-ng:request:";
const REQUEST_MARK_TTL_MS = 15_000;
let requestMarkRenew: number | undefined;

function publishRequests(count: number): void {
  try {
    if (count > 0) {
      localStorage.setItem(REQUEST_MARK_PREFIX + TAB_ID, String(Date.now() + REQUEST_MARK_TTL_MS));
      if (requestMarkRenew === undefined) {
        requestMarkRenew = window.setInterval(
          () => localStorage.setItem(REQUEST_MARK_PREFIX + TAB_ID, String(Date.now() + REQUEST_MARK_TTL_MS)),
          REQUEST_MARK_TTL_MS / 3
        );
      }
    } else {
      localStorage.removeItem(REQUEST_MARK_PREFIX + TAB_ID);
      if (requestMarkRenew !== undefined) {
        window.clearInterval(requestMarkRenew);
        requestMarkRenew = undefined;
      }
    }
  } catch {
    // storage may be unavailable; the per-tab gate still applies
  }
}

function otherTabsRequesting(): boolean {
  try {
    const now = Date.now();
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(REQUEST_MARK_PREFIX) || key === REQUEST_MARK_PREFIX + TAB_ID) {
        continue;
      }
      if (Number(localStorage.getItem(key)) > now) {
        return true;
      }
      stale.push(key);
    }
    stale.forEach(key => localStorage.removeItem(key));
  } catch {
    // storage may be unavailable
  }
  return false;
}

setCrossTab({ refreshing: otherTabRefreshing, requesting: otherTabsRequesting, publish: publishRequests });

// ---------------------------------------------------------------------------
// The app's own token refreshes are tracked here in the core, not in a module:
// the gate must know about them even when the keep-alive is switched off.
let appPathAvailable = false;
let appStarts = 0;
let appRefreshes = 0;
let lastAppRefreshTimeout: number | null = null;
const appMarks: number[] = [];

// The cross-tab lease follows the app's refresh to its loadend, not the 30 s
// app-driven attempt: a slow app refresh must not be raced by a sibling tab
// either. Capped like the gate's mark, in case a loadend never comes.
let appLease: number | undefined;
let appLeaseSince = 0;

function releaseAppLease(): void {
  if (appLease !== undefined) {
    window.clearInterval(appLease);
    appLease = undefined;
  }
}

function holdAppLease(): void {
  takeLock();
  if (appLease === undefined) {
    appLeaseSince = Date.now();
    appLease = window.setInterval(() => {
      if (appMarks.length === 0 || Date.now() - appLeaseSince > REFRESH_STALE_MS) {
        releaseAppLease();
        return;
      }
      takeLock();
    }, CROSS_TAB_LOCK_RENEW_MS);
  }
}

export function trackAppRefreshes(): void {
  if (appPathAvailable) {
    return;
  }
  appPathAvailable = true;
  onApiStart(info => {
    appRequestStarted();
    if (info.path === "Account/GetNewTokens") {
      appStarts++;
      appMarks.push(markRefreshStart("app"));
      holdAppLease();
    }
  });
  onApiCall(call => {
    appRequestEnded();
    if (call.path === "Account/GetNewTokens") {
      appRefreshes++;
      noteExternalRefresh();
      if (call.status >= 200 && call.status < 300) {
        const body = call.json<{ sessionTimeoutInMinutes?: number }>();
        lastAppRefreshTimeout = typeof body?.sessionTimeoutInMinutes === "number" ? body.sessionTimeoutInMinutes : 0;
      } else {
        lastAppRefreshTimeout = null; // a failed app refresh must not read as a success
      }
      const id = appMarks.shift();
      if (id !== undefined) {
        markRefreshEnd(id, APP_STORE_GRACE_MS);
      }
      if (appMarks.length === 0) {
        // The cookie just rotated: sibling tabs wait out the TTL, as after our own fetch.
        releaseAppLease();
        takeLock();
      }
    }
  });
}

export function isAppRefreshEnabled(): boolean {
  return storage.get<boolean>("keepAlive", "appRefresh") !== false;
}
export function setAppRefreshEnabled(enabled: boolean): void {
  storage.set("keepAlive", "appRefresh", enabled);
}

const sleep = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));

// After the quiet wait: true when this cycle should be skipped because NPU
// requests are still in flight and the token can afford to wait.
function stillBusy(token: string, quietWait: number): boolean {
  if (inFlightRequests() === 0) {
    return false;
  }
  const exp = getTokenExpiration(token);
  const left = exp ? exp.getTime() - Date.now() : Infinity;
  if (left > FORCE_REFRESH_BELOW_MS) {
    diag(`frissítés kihagyva: ${inFlightRequests()} saját kérés ${fmtDuration(quietWait)} után is repül — a következő ciklus újrapróbálja`);
    return true;
  }
  diag(`saját kérés ${fmtDuration(quietWait)} után is repül, de a token ${fmtDuration(left)} múlva lejár — a frissítés mellette indul`);
  return false;
}

/**
 * Asks the APP to refresh, through its own idle service: with the stored
 * session expiry under 150 s, a visibilitychange makes it request new tokens
 * via its own HttpClient, interceptors and handlers — exactly as it would on
 * its own, and serialised with its own requests. Returns whether this cycle
 * is taken care of (the app refreshed, or has a refresh in flight, or another
 * tab is refreshing, or the cycle is deliberately skipped); false only when
 * the app did not react at all, so the caller may refresh itself.
 */
// When the app did not react, the mark is handed to the fallback (doRefresh)
// rather than ended: the parked NPU requests must not slip out between the
// two phases.
interface AppRefreshResult {
  handled: boolean;
  timeout: number | null;
  handedOver?: number;
}

async function refreshViaApp(token: string): Promise<AppRefreshResult> {
  if (otherTabRefreshing()) {
    diag("frissítés kihagyva: egy másik fül frissít");
    return { handled: true, timeout: null };
  }
  const startsBefore = appStarts;
  const before = appRefreshes;
  // Announce first (new NPU requests now wait), then let the in-flight ones
  // drain — and hold the cross-tab lease for the whole attempt, because the
  // app's request carries the same cookie a sibling tab would race.
  const mark = markRefreshStart("npu");
  let handedOver = false;
  takeLock();
  const renew = window.setInterval(takeLock, CROSS_TAB_LOCK_RENEW_MS);
  try {
    const quietWait = await waitForQuiet();
    if (stillBusy(token, quietWait)) {
      return { handled: true, timeout: null };
    }
    if (isSessionLost() || getAccessToken() !== token) {
      return { handled: true, timeout: null };
    }
    if (appStarts === startsBefore) {
      if (document.visibilityState !== "visible") {
        // The app's handler ignores the event unless the tab is visible, and a
        // shadowed visibilityState does not cross into the page's own world
        // under a userscript manager. Nobody is clicking in a hidden tab, so
        // the app's interceptor is not going to refresh either: go direct.
        diag("rejtett fül: az app nem kérhető meg, a frissítés közvetlenül megy");
        handedOver = true;
        return { handled: false, timeout: null, handedOver: mark };
      }
      diag(`frissítés kérése az app saját mechanizmusán át`);
      const stored = sessionStorage.getItem(SESSION_EXP_KEY_APP);
      // The app's idle check reads this value synchronously inside the event
      // handler; it is put back immediately afterwards.
      sessionStorage.setItem(SESSION_EXP_KEY_APP, new Date(Date.now() + APP_REFRESH_FAKE_REMAINING_MS).toISOString());
      try {
        document.dispatchEvent(new Event("visibilitychange"));
      } finally {
        if (stored) {
          sessionStorage.setItem(SESSION_EXP_KEY_APP, stored);
        } else {
          sessionStorage.removeItem(SESSION_EXP_KEY_APP);
        }
      }
    }
    const sendDeadline = Date.now() + APP_REFRESH_WAIT_MS;
    while (Date.now() < sendDeadline) {
      await sleep(250);
      if (appRefreshes > before) {
        return { handled: true, timeout: lastAppRefreshTimeout };
      }
      if (appStarts > startsBefore) {
        break; // sent — now only the response is outstanding
      }
    }
    if (appStarts === startsBefore) {
      diag(`az app ${APP_REFRESH_WAIT_MS / 1000} mp alatt nem küldött frissítést — saját frissítés következik`);
      if (observedCallCount() === 0) {
        // The hook cannot see the page at all (some managers refuse the XHR
        // patch): the app may well have refreshed, we would never know.
        // Stop asking it and refresh directly from now on.
        appPathAvailable = false;
        diag("a hálózatfigyelő nem lát app-hívást — a frissítés innentől közvetlenül megy");
      }
      handedOver = true;
      return { handled: false, timeout: null, handedOver: mark };
    }
    diag("az app elküldte a frissítést, de a válasz még nem jött meg — várakozás");
    const responseDeadline = Date.now() + APP_REFRESH_RESPONSE_WAIT_MS;
    while (Date.now() < responseDeadline) {
      await sleep(250);
      if (appRefreshes > before) {
        return { handled: true, timeout: lastAppRefreshTimeout };
      }
    }
    // Still no response. Never start our own against it: the app's mark ends
    // on its loadend, and the next cycle re-evaluates.
    diag("az app frissítése 20 mp után sem válaszolt — ebben a ciklusban nem indul saját frissítés");
    return { handled: true, timeout: null };
  } finally {
    window.clearInterval(renew);
    if (!handedOver) {
      markRefreshEnd(mark);
    }
  }
}

async function doRefresh(inherited?: number): Promise<number | null> {
  const token = getAccessToken();
  if (!token) {
    if (inherited !== undefined) {
      markRefreshEnd(inherited);
    }
    return null;
  }
  // Announce first, then let in-flight NPU requests drain: new ones now wait
  // on the gate, so a steady stream of polls cannot starve the refresh. A mark
  // handed over from the app-driven attempt is kept, so the requests parked
  // behind it stay parked.
  const mark = inherited ?? markRefreshStart("npu");
  let renew: number | undefined;
  let sent = false;
  try {
    const quietWait = await waitForQuiet();
    if (stillBusy(token, quietWait)) {
      return null;
    }
    // The world may have moved on while we waited: re-check every guard.
    if (isSessionLost() || getAccessToken() !== token) {
      diag("frissítés kihagyva: közben másik token jelent meg");
      return null;
    }
    if (otherRefreshActive(mark)) {
      diag("frissítés kihagyva: az app frissítése fut");
      return null;
    }
    if (Date.now() - lastExternalRefreshAt < EXTERNAL_QUIET_MS || otherTabRefreshing()) {
      diag("frissítés kihagyva: nemrég frissített más (az app vagy egy másik fül)");
      return null;
    }
    takeLock();
    sent = true;
    // The lock is a LEASE, not a single 5 s stamp. Under load a GetNewTokens
    // can take longer than the TTL, and the other tab would then read the lock
    // as stale and send the very same not-yet-rotated cookie — the loser of
    // that race gets a 401 and the server logs the user out. Renewing while
    // the request is in flight closes that window, and because the renewer
    // dies with the tab, a tab closed mid-refresh still lets the lock expire.
    renew = window.setInterval(takeLock, LOCK_TTL_MS / 2);
    const expBefore = getTokenExpiration(token);
    diag(
      `frissítés indul (a token ${expBefore ? hhmmss(expBefore.getTime()) + "-kor jár le" : "lejárata ismeretlen"})` +
        (quietWait >= 300 ? ` — ${fmtDuration(quietWait)} várt a saját kérések befejeződésére` : "")
    );
    const abort = new AbortController();
    const abortTimer = window.setTimeout(() => abort.abort(), OWN_REFRESH_TIMEOUT_MS);
    let response: Response;
    try {
      // Shaped like the app's own call (Angular HttpClient POST with an empty
      // JSON body), so a server that inspects the body or content type sees
      // no difference between the two.
      response = await fetch(`${API_BASE}Account/GetNewTokens`, {
        method: "POST",
        credentials: "include",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/plain, */*",
        },
        body: "{}",
        signal: abort.signal,
      });
    } catch (error) {
      diag(`frissítés HÁLÓZATI HIBA: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      window.clearTimeout(abortTimer);
    }
    // The server's clock against this machine's (whole seconds only).
    const serverDate = Date.parse(response.headers?.get("Date") ?? "");
    const skew = Number.isFinite(serverDate) ? ` [szerveróra eltérése ${Math.round((serverDate - Date.now()) / 1000)} mp]` : "";
    if (!response.ok) {
      if (response.status === 401) {
        sessionLostForToken = token;
        const sessionExp = getSessionExpiration();
        const remaining = sessionExp ? sessionExp.getTime() - Date.now() : null;
        let body = "";
        try {
          body = sanitize(await response.text());
        } catch {
          // the message is a bonus, its absence is not an error
        }
        diag(
          `frissítés ELUTASÍTVA: HTTP 401 — a szerver szerint a munkamenet lejárt` +
            (remaining !== null ? `, miközben a jelvény szerint még ${fmtDuration(remaining)} volt hátra` : "") +
            `; ${diagContext()}${skew}` +
            (body ? `; a szerver üzenete: ${body}` : "")
        );
        log("token refresh rejected (401) — the session is no longer valid");
      } else {
        diag(`frissítés sikertelen: HTTP ${response.status}`);
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
    diag(
      `frissítés OK — új token ${tokenExp ? hhmmss(tokenExp.getTime()) : "?"}-kor jár le; ` +
        `a szerver ${result.sessionTimeoutInMinutes} perces munkamenetet jelez (→ ${hhmmss(sessionExp.getTime())})${skew}`
    );
    return result.sessionTimeoutInMinutes;
  } finally {
    markRefreshEnd(mark);
    if (renew !== undefined) {
      window.clearInterval(renew);
    }
    // Stamp on every exit path where a request went out, failures included: a
    // failed attempt may still have rotated the cookie server-side.
    if (sent) {
      takeLock();
    }
  }
}

// App first, then ourselves — for EVERY refresh, whoever asks for it (the
// keep-alive timer, a request that found its token expiring, a 401 retry).
// One path means the app's own interceptor-driven refresh and ours can never
// meet in the same wake-up: when the app is willing, it does the refreshing
// and serialises its own requests around it; our fetch is only the fallback
// for an app that does not react.
async function performRefresh(): Promise<number | null> {
  if (appPathAvailable && isAppRefreshEnabled()) {
    const token = getAccessToken();
    if (!token) {
      return null;
    }
    const viaApp = await refreshViaApp(token);
    if (viaApp.handled) {
      return viaApp.timeout;
    }
    return doRefresh(viaApp.handedOver);
  }
  return doRefresh();
}

/**
 * Requests a new access token. Concurrent callers share one attempt; if the
 * app or another tab is refreshing, this waits for or defers to it, so the
 * rotated cookie is never used twice.
 */
export async function refreshTokens(): Promise<number | null> {
  // Every guard is re-checked after every wait: the single-flight promise, the
  // app's or another tab's refresh, and the quiet period can all change while
  // we are parked on the gate.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (isSessionLost()) {
      return null;
    }
    if (refreshInFlight) {
      return refreshInFlight;
    }
    if (isRefreshing()) {
      await waitForRequestSlot();
      continue;
    }
    if (Date.now() - lastExternalRefreshAt < EXTERNAL_QUIET_MS || otherTabRefreshing()) {
      diag("frissítés kihagyva: nemrég frissített más (az app vagy egy másik fül)");
      return null;
    }
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  }
  return null;
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

// Runs one NPU request through the gate: never while a refresh is in flight,
// and counted as in flight itself so a refresh waits for it. Released before
// any retry, so a refresh triggered by a 401 cannot wait on the very request
// that triggered it.
async function gatedFetch(path: string, call: () => Promise<Response>): Promise<Response> {
  const waited = await waitForRequestSlot();
  const shortPath = path.split(/[?#]/)[0];
  if (waited >= 500) {
    diag(`npu → ${shortPath}: ${fmtDuration(waited)} várt a frissítés befejeződésére`);
  }
  const release = beginRequest();
  try {
    const response = await call();
    diag(`npu → ${shortPath} ${response.status}`);
    return response;
  } catch (error) {
    diag(`npu → ${shortPath} HÁLÓZATI HIBA: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  } finally {
    release();
  }
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
  let response = await gatedFetch(path, call);
  if (response.status === 401) {
    await refreshTokens();
    response = await gatedFetch(path, call);
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
  let response = await gatedFetch(path, call);
  if (response.status === 401) {
    await refreshTokens();
    response = await gatedFetch(path, call);
  }
  if (!response.ok) {
    throw new Error(`API call ${path} failed with status ${response.status}`);
  }
  const result = (await response.json()) as ApiResponse<T>;
  return result.data;
}
