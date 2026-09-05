// A "munkamenet lejárt" ítélet a tokenhez kötődik, nem az oldal élettartamához:
// újrabelépés (SPA, nincs újratöltés) után a jelvény felirata eltűnik és a
// kidobásvédelem újraindul. A régi kód 4 ellenőrzésen bukott.
const API = process.argv[2];
function makeStore() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }
globalThis.location = { pathname: "/hallgatoi/dashboard", origin: "https://neptun.bme.hu", host: "neptun.bme.hu" };
globalThis.document = { title: "Neptun Web", querySelector: s => (s === "base" ? { getAttribute: () => "/hallgatoi/" } : null) };
Object.defineProperty(globalThis, "navigator", { value: { userAgent: "test" }, configurable: true, writable: true });
globalThis.sessionStorage = makeStore();
globalThis.localStorage = makeStore();
globalThis.window = { setInterval, clearInterval };
function token(name, sec) { const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url"); return `${b64({ alg: "HS256" })}.${b64({ sub: name, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + sec })}.sig-${name}`; }
let fetchMode = "401", fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls++; if (fetchMode === "401") return { ok: false, status: 401 }; return { ok: true, status: 200, json: async () => ({ accessToken: token("refreshed", 300), sessionTimeoutInMinutes: 30 }) }; };
// A fülök közti zár 5 mp-ig él; a valóságban percek telnek el a lépések közt.
const elapse = () => localStorage.setItem("npu-ng:refresh-lock", String(Date.now() - 60_000));
const { refreshTokens, isSessionLost } = await import("../" + API);
const results = [];
const check = (label, actual, expected) => { const pass = actual === expected; results.push(pass); console.log(`  ${pass ? "✓" : "✗ FAIL"}  ${label}${pass ? "" : `  (kapott: ${actual}, várt: ${expected})`}`); };
const A = token("morning", 60), B = token("evening", 300);
console.log("1) a munkamenet meghal (401)"); sessionStorage.setItem("access_token", A); await refreshTokens();
check("felismeri, hogy elveszett", isSessionLost(), true);
console.log("2) ugyanazzal a halott tokennel nem ostromol"); fetchCalls = 0; await refreshTokens(); check("nem ment újabb kérés", fetchCalls, 0);
console.log("3) újrabelépés SPA-ban"); fetchMode = "ok"; sessionStorage.setItem("access_token", B); check("a felirat eltűnik", isSessionLost(), false);
console.log("4) a kidobásvédelem újraindul"); elapse(); fetchCalls = 0; const t = await refreshTokens(); check("a kérés elment", fetchCalls, 1); check("és sikerült", t, 30);
console.log("5) bejelentkező oldal: nincs token"); sessionStorage.setItem("access_token", A); fetchMode = "401"; elapse(); await refreshTokens(); check("előbb halott", isSessionLost(), true); sessionStorage.removeItem("access_token"); check("kijelentkezve már nem", isSessionLost(), false);
const failed = results.filter(r => !r).length; console.log(failed === 0 ? `MIND A(Z) ${results.length} RENDBEN` : `${failed} BUKOTT`); process.exit(failed ? 1 : 0);
