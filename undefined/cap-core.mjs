var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/core/base.ts
function fromBaseTag() {
  const href = document.querySelector("base")?.getAttribute("href");
  if (!href) {
    return null;
  }
  try {
    return new URL(href, location.origin).pathname.replace(/\/+$/, "");
  } catch {
    return null;
  }
}
function fromFirstSegment() {
  const segment = location.pathname.split("/")[1];
  return segment ? `/${segment}` : "";
}
function detect() {
  const declared = fromBaseTag();
  return declared !== null ? declared : fromFirstSegment();
}
var APP_BASE = detect();
var API_BASE = `${APP_BASE}/api/`;

// src/core/env.ts
function log(...args) {
  console.log("%c[NPU]", "color:#2b6cb0;font-weight:bold", ...args);
}

// src/core/diag.ts
var MAX_ENTRIES = 1500;
var entries = [];
var startedAt = Date.now();
var pageLoadedAt = Math.round(performance.timeOrigin);
var loginAt = null;
var lastAppCall = null;
function hhmmss(ms) {
  return new Date(ms).toLocaleTimeString("hu-HU", { hour12: false });
}
function fmtDuration(ms) {
  const s = Math.round(Math.abs(ms) / 1e3);
  return s < 60 ? `${s} mp` : `${Math.floor(s / 60)} p ${String(s % 60).padStart(2, "0")} mp`;
}
function diag(text) {
  entries.push({ at: Date.now(), text });
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
  console.log("%c[NPU diag]", "color:#9a6700;font-weight:bold", text);
}
function diagContext() {
  const now = Date.now();
  const parts = [];
  if (loginAt !== null) {
    parts.push(`a bel\xE9p\xE9s \xF3ta ${fmtDuration(now - loginAt)}`);
  }
  parts.push(`az oldal megnyit\xE1sa \xF3ta ${fmtDuration(now - pageLoadedAt)}`);
  if (lastAppCall) {
    parts.push(
      `az app utols\xF3 saj\xE1t k\xE9r\xE9se ${fmtDuration(now - lastAppCall.at)} ezel\u0151tt (${lastAppCall.path} \u2192 ${lastAppCall.status})`
    );
  }
  return parts.join(", ");
}
function sanitize(text) {
  return text.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "<token>").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<guid>").replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>").replace(/\d{7,}/g, "<sz\xE1m>").replace(/\s+/g, " ").trim().slice(0, 300);
}

// src/core/gate.ts
var gate_exports = {};
__export(gate_exports, {
  beginRequest: () => beginRequest,
  inFlightRequests: () => inFlightRequests,
  isRefreshing: () => isRefreshing,
  markRefreshEnd: () => markRefreshEnd,
  markRefreshStart: () => markRefreshStart,
  otherRefreshActive: () => otherRefreshActive,
  waitForQuiet: () => waitForQuiet,
  waitForRequestSlot: () => waitForRequestSlot
});
var REQUEST_MAX_WAIT_MS = 15e3;
var QUIET_MAX_WAIT_MS = 1e4;
var REFRESH_STALE_MS = 2e4;
var RECHECK_MS = 1e3;
var marks = [];
var nextId = 1;
var inFlight = 0;
var holdUntil = 0;
var slotWaiters = /* @__PURE__ */ new Set();
var quietWaiters = /* @__PURE__ */ new Set();
function wake(waiters) {
  const pending = [...waiters];
  waiters.clear();
  pending.forEach((resolve) => resolve());
}
function prune() {
  const now = Date.now();
  const before = marks.length;
  marks = marks.filter((mark) => now - mark.startedAt < REFRESH_STALE_MS);
  if (marks.length !== before && marks.length === 0) {
    wake(slotWaiters);
  }
}
function isRefreshing() {
  prune();
  return marks.length > 0;
}
function otherRefreshActive(exceptId) {
  prune();
  return marks.some((mark) => mark.id !== exceptId);
}
function markRefreshStart(owner) {
  const id = nextId++;
  marks.push({ id, owner, startedAt: Date.now() });
  setTimeout(prune, REFRESH_STALE_MS + 50);
  return id;
}
function markRefreshEnd(id, graceMs = 0) {
  marks = marks.filter((mark) => mark.id !== id);
  if (graceMs > 0) {
    holdUntil = Math.max(holdUntil, Date.now() + graceMs);
    setTimeout(() => wake(slotWaiters), graceMs + 10);
  }
  if (marks.length === 0) {
    wake(slotWaiters);
  }
}
function inFlightRequests() {
  return inFlight;
}
function requestsBlocked() {
  return isRefreshing() || Date.now() < holdUntil;
}
async function waitForRequestSlot() {
  const started = Date.now();
  while (requestsBlocked()) {
    const remaining = REQUEST_MAX_WAIT_MS - (Date.now() - started);
    if (remaining <= 0) {
      break;
    }
    await new Promise((resolve) => {
      slotWaiters.add(resolve);
      setTimeout(resolve, Math.min(remaining, RECHECK_MS));
    });
  }
  return Date.now() - started;
}
async function waitForQuiet() {
  const started = Date.now();
  while (inFlight > 0) {
    const remaining = QUIET_MAX_WAIT_MS - (Date.now() - started);
    if (remaining <= 0) {
      break;
    }
    await new Promise((resolve) => {
      quietWaiters.add(resolve);
      setTimeout(resolve, Math.min(remaining, RECHECK_MS));
    });
  }
  return Date.now() - started;
}
function beginRequest() {
  inFlight++;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      inFlight--;
      if (inFlight === 0) {
        wake(quietWaiters);
      }
    }
  };
}

// src/core/netHook.ts
var listeners = /* @__PURE__ */ new Set();
var startListeners = /* @__PURE__ */ new Set();
var installed = false;
var observedCalls = 0;
function pageWindow() {
  try {
    if (typeof unsafeWindow !== "undefined" && unsafeWindow) {
      return unsafeWindow;
    }
  } catch {
  }
  return window;
}
var API_MARKER = API_BASE;
function notify(call) {
  observedCalls++;
  queueMicrotask(() => {
    [...listeners].forEach((listener) => {
      try {
        listener(call);
      } catch (error) {
        console.error("[NPU] net hook listener failed", error);
      }
    });
  });
}
function install() {
  if (installed) {
    return;
  }
  installed = true;
  try {
    const target = pageWindow();
    const proto = target.XMLHttpRequest?.prototype;
    if (!proto) {
      log("net hook unavailable: no XMLHttpRequest prototype");
      return;
    }
    const originalOpen = proto.open;
    const originalSend = proto.send;
    const pending = /* @__PURE__ */ new WeakMap();
    const wrappedOpen = function(...args) {
      try {
        pending.set(this, { method: String(args[0]), url: String(args[1]) });
      } catch {
      }
      return originalOpen.apply(this, args);
    };
    const wrappedSend = function(...args) {
      try {
        const info = pending.get(this);
        if (info && info.url.includes(API_MARKER)) {
          const startPath = info.url.slice(info.url.indexOf(API_MARKER) + API_MARKER.length).split(/[?#]/)[0];
          const startInfo = { method: info.method.toUpperCase(), path: startPath };
          queueMicrotask(() => {
            [...startListeners].forEach((listener) => {
              try {
                listener(startInfo);
              } catch (error) {
                console.error("[NPU] net hook start listener failed", error);
              }
            });
          });
          const xhr = this;
          this.addEventListener(
            "loadend",
            () => {
              const path = info.url.slice(info.url.indexOf(API_MARKER) + API_MARKER.length).split(/[?#]/)[0];
              let parsed;
              let parsedDone = false;
              notify({
                method: info.method.toUpperCase(),
                path,
                status: xhr.status,
                url: info.url,
                json() {
                  if (!parsedDone) {
                    parsedDone = true;
                    try {
                      parsed = xhr.responseType === "" || xhr.responseType === "text" ? JSON.parse(xhr.responseText) : xhr.response;
                    } catch {
                      parsed = null;
                    }
                  }
                  return parsed ?? null;
                }
              });
            },
            { once: true }
          );
        }
      } catch {
      }
      return originalSend.apply(this, args);
    };
    proto.open = wrappedOpen;
    proto.send = wrappedSend;
    if (proto.open !== wrappedOpen || new target.XMLHttpRequest().open !== wrappedOpen) {
      proto.open = originalOpen;
      proto.send = originalSend;
      log("net hook did not apply to the page, falling back to polling");
      return;
    }
    log("net hook installed");
  } catch (error) {
    log("net hook could not be installed, falling back to polling", error);
  }
}
function onApiCall(listener) {
  listeners.add(listener);
  install();
  return () => {
    listeners.delete(listener);
  };
}
function onApiStart(listener) {
  startListeners.add(listener);
  install();
  return () => {
    startListeners.delete(listener);
  };
}

// src/core/api.ts
var TOKEN_KEY = "access_token";
var TOKEN_EXP_KEY = "access_token_expiration_date";
var SESSION_EXP_KEY = "session_expiration_date";
function getAccessToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}
function isLoggedIn() {
  return !!getAccessToken();
}
function getTokenExpiration(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? new Date(payload.exp * 1e3) : null;
  } catch {
    return null;
  }
}
function getTokenIssuedAt(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.iat === "number" ? new Date(payload.iat * 1e3) : null;
  } catch {
    return null;
  }
}
function getSessionExpiration() {
  const value = sessionStorage.getItem(SESSION_EXP_KEY);
  return value ? new Date(value) : null;
}
var REFRESH_LOCK_KEY = "npu-ng:refresh-lock";
var LOCK_TTL_MS = 5e3;
var EXTERNAL_QUIET_MS = 1e4;
var refreshInFlight = null;
var lastExternalRefreshAt = 0;
var sessionLostForToken = null;
function noteExternalRefresh() {
  lastExternalRefreshAt = Date.now();
}
function isSessionLost() {
  if (sessionLostForToken === null) {
    return false;
  }
  if (getAccessToken() !== sessionLostForToken) {
    sessionLostForToken = null;
    diag("a \u201Emunkamenet lej\xE1rt\u201D \xEDt\xE9let feloldva: m\xE1sik token jelent meg (\xFAj bel\xE9p\xE9s)");
    return false;
  }
  return true;
}
function otherTabRefreshing() {
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
function takeLock() {
  try {
    localStorage.setItem(REFRESH_LOCK_KEY, String(Date.now()));
  } catch {
  }
}
function crossTabRefreshLocked() {
  return otherTabRefreshing();
}
function takeCrossTabLock() {
  takeLock();
}
var CROSS_TAB_LOCK_RENEW_MS = LOCK_TTL_MS / 2;
var APP_STORE_GRACE_MS = 1500;
var appMarks = [];
var tracking = false;
function trackAppRefreshes() {
  if (tracking) {
    return;
  }
  tracking = true;
  onApiStart((info) => {
    if (info.path === "Account/GetNewTokens") {
      appMarks.push(markRefreshStart("app"));
    }
  });
  onApiCall((call) => {
    if (call.path === "Account/GetNewTokens") {
      noteExternalRefresh();
      const id = appMarks.shift();
      if (id !== void 0) {
        markRefreshEnd(id, APP_STORE_GRACE_MS);
      }
    }
  });
}
async function doRefresh() {
  const token = getAccessToken();
  if (!token) {
    return null;
  }
  const mark = markRefreshStart("npu");
  let renew;
  let sent = false;
  try {
    const quietWait = await waitForQuiet();
    if (isSessionLost() || getAccessToken() !== token) {
      diag("friss\xEDt\xE9s kihagyva: k\xF6zben m\xE1sik token jelent meg");
      return null;
    }
    if (otherRefreshActive(mark)) {
      diag("friss\xEDt\xE9s kihagyva: az app friss\xEDt\xE9se fut");
      return null;
    }
    if (Date.now() - lastExternalRefreshAt < EXTERNAL_QUIET_MS || otherTabRefreshing()) {
      diag("friss\xEDt\xE9s kihagyva: nemr\xE9g friss\xEDtett m\xE1s (az app vagy egy m\xE1sik f\xFCl)");
      return null;
    }
    takeLock();
    sent = true;
    renew = window.setInterval(takeLock, LOCK_TTL_MS / 2);
    const expBefore = getTokenExpiration(token);
    diag(
      `friss\xEDt\xE9s indul (a token ${expBefore ? hhmmss(expBefore.getTime()) + "-kor j\xE1r le" : "lej\xE1rata ismeretlen"})` + (quietWait >= 300 ? ` \u2014 ${fmtDuration(quietWait)} v\xE1rt a saj\xE1t k\xE9r\xE9sek befejez\u0151d\xE9s\xE9re` : "")
    );
    let response;
    try {
      response = await fetch(`${API_BASE}Account/GetNewTokens`, {
        method: "POST",
        credentials: "include",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/plain, */*"
        },
        body: "{}"
      });
    } catch (error) {
      diag(`friss\xEDt\xE9s H\xC1L\xD3ZATI HIBA: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
    const serverDate = Date.parse(response.headers?.get("Date") ?? "");
    const skew = Number.isFinite(serverDate) ? ` [szerver\xF3ra elt\xE9r\xE9se ${Math.round((serverDate - Date.now()) / 1e3)} mp]` : "";
    if (!response.ok) {
      if (response.status === 401) {
        sessionLostForToken = token;
        const sessionExp2 = getSessionExpiration();
        const remaining = sessionExp2 ? sessionExp2.getTime() - Date.now() : null;
        let body = "";
        try {
          body = sanitize(await response.text());
        } catch {
        }
        diag(
          `friss\xEDt\xE9s ELUTAS\xCDTVA: HTTP 401 \u2014 a szerver szerint a munkamenet lej\xE1rt` + (remaining !== null ? `, mik\xF6zben a jelv\xE9ny szerint m\xE9g ${fmtDuration(remaining)} volt h\xE1tra` : "") + `; ${diagContext()}${skew}` + (body ? `; a szerver \xFCzenete: ${body}` : "")
        );
        log("token refresh rejected (401) \u2014 the session is no longer valid");
      } else {
        diag(`friss\xEDt\xE9s sikertelen: HTTP ${response.status}`);
        log(`Token refresh failed with status ${response.status}`);
      }
      return null;
    }
    const result = await response.json();
    sessionStorage.setItem(TOKEN_KEY, result.accessToken);
    const tokenExp = getTokenExpiration(result.accessToken);
    if (tokenExp) {
      sessionStorage.setItem(TOKEN_EXP_KEY, tokenExp.toISOString());
    }
    const sessionExp = new Date(Date.now() + result.sessionTimeoutInMinutes * 6e4);
    sessionStorage.setItem(SESSION_EXP_KEY, sessionExp.toISOString());
    diag(
      `friss\xEDt\xE9s OK \u2014 \xFAj token ${tokenExp ? hhmmss(tokenExp.getTime()) : "?"}-kor j\xE1r le; a szerver ${result.sessionTimeoutInMinutes} perces munkamenetet jelez (\u2192 ${hhmmss(sessionExp.getTime())})${skew}`
    );
    return result.sessionTimeoutInMinutes;
  } finally {
    markRefreshEnd(mark);
    if (renew !== void 0) {
      window.clearInterval(renew);
    }
    if (sent) {
      takeLock();
    }
  }
}
async function refreshTokens() {
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
      return null;
    }
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  }
  return null;
}
async function ensureFreshToken(marginMs = 6e4) {
  const token = getAccessToken();
  if (!token) {
    return;
  }
  const expiration = getTokenExpiration(token);
  if (!expiration || expiration.getTime() - Date.now() < marginMs) {
    await refreshTokens();
  }
}
var ApiError = class extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
};
function parseErrorBody(body) {
  try {
    const parsed = JSON.parse(body);
    const parts = [];
    parsed.modelStateErrors?.forEach((e) => parts.push(...e.errors));
    parsed.notification?.forEach((n) => n.message && parts.push(n.message));
    if (parsed.message) {
      parts.push(parsed.message);
    }
    if (parts.length > 0) {
      return parts.join("\n");
    }
  } catch {
  }
  return body.slice(0, 300);
}
async function gatedFetch(path, call) {
  const waited = await waitForRequestSlot();
  const shortPath = path.split(/[?#]/)[0];
  if (waited >= 500) {
    diag(`npu \u2192 ${shortPath}: ${fmtDuration(waited)} v\xE1rt a friss\xEDt\xE9s befejez\u0151d\xE9s\xE9re`);
  }
  const release = beginRequest();
  try {
    const response = await call();
    diag(`npu \u2192 ${shortPath} ${response.status}`);
    return response;
  } catch (error) {
    diag(`npu \u2192 ${shortPath} H\xC1L\xD3ZATI HIBA: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  } finally {
    release();
  }
}
async function apiPost(path, body) {
  await ensureFreshToken();
  const call = () => fetch(API_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken()}` },
    body: JSON.stringify(body)
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
  return JSON.parse(text);
}
async function api(path, init = {}) {
  await ensureFreshToken();
  const call = () => fetch(API_BASE + path, {
    ...init,
    headers: { ...init.headers ?? {}, Authorization: `Bearer ${getAccessToken()}` }
  });
  let response = await gatedFetch(path, call);
  if (response.status === 401) {
    await refreshTokens();
    response = await gatedFetch(path, call);
  }
  if (!response.ok) {
    throw new Error(`API call ${path} failed with status ${response.status}`);
  }
  const result = await response.json();
  return result.data;
}
export {
  API_BASE,
  ApiError,
  CROSS_TAB_LOCK_RENEW_MS,
  api,
  apiPost,
  crossTabRefreshLocked,
  ensureFreshToken,
  gate_exports as gate,
  getAccessToken,
  getSessionExpiration,
  getTokenExpiration,
  getTokenIssuedAt,
  isLoggedIn,
  isSessionLost,
  noteExternalRefresh,
  refreshTokens,
  takeCrossTabLock,
  trackAppRefreshes
};
