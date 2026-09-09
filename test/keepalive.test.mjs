// A kidobásvédelem tick-je túléli a hálózati hibát. Az NJE-naplóban (2026-09-09)
// egy "Failed to fetch" a tick-ből kezeletlen promise-elutasításként jött ki,
// és a ciklus többi része (a számláló ébresztése) elmaradt. Elvárás: a hiba a
// naplóba kerül a token lejáratával és az újrapróbálás ígéretével, a tick nem
// dob, nem születik "munkamenet lejárt" ítélet, és a következő tick frissít.
const ENTRY = process.argv[2];
const results = [];
const check = (label, actual, expected) => { const pass = actual === expected; results.push(pass); console.log(`  ${pass ? "✓" : "✗ FAIL"}  ${label}${pass ? "" : `  (kapott: ${JSON.stringify(actual)}, várt: ${JSON.stringify(expected)})`}`); };
function makeStore() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), get length() { return m.size; }, key: i => [...m.keys()][i] ?? null }; }
globalThis.location = { pathname: "/hallgato/dashboard", origin: "https://neptun.nje.hu", host: "neptun.nje.hu" };
let dispatched = [];
globalThis.document = { title: "Neptun Web", visibilityState: "hidden", querySelector: s => (s === "base" ? { getAttribute: () => "/hallgato/" } : null), dispatchEvent(e) { dispatched.push(e.type); return true; }, addEventListener() {}, removeEventListener() {} };
Object.defineProperty(globalThis, "navigator", { value: { userAgent: "test" }, configurable: true, writable: true });
globalThis.sessionStorage = makeStore(); globalThis.localStorage = makeStore();
globalThis.window = { setInterval, clearInterval, setTimeout, clearTimeout };
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (n, sec) => `${b64({ alg: "HS256" })}.${b64({ sub: n, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + sec })}.s`;
const refreshOk = () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ accessToken: jwt("fresh", 300), sessionTimeoutInMinutes: 30 }), text: async () => "" });

let unhandled = 0;
process.on("unhandledRejection", () => { unhandled++; });
const m = await import("../" + ENTRY);

console.log("A) a token 60 mp múlva lejár, a hálózat nem elérhető");
const oldToken = jwt("old", 60);
sessionStorage.setItem("access_token", oldToken);
let network = "down"; let calls = 0;
globalThis.fetch = async () => { calls++; if (network === "down") throw new TypeError("Failed to fetch"); return refreshOk(); };
let threw = false;
try { await m.tick(); } catch { threw = true; }
check("a tick nem dob", threw, false);
check("egy frissítés elment", calls, 1);
const dump = m.diagDump();
check("a napló: hálózati hiba + a token lejárata + újrapróbálás", /frissítés HÁLÓZATI HIBA: Failed to fetch — a token \d{1,2}:\d{2}:\d{2}-kor jár le, a következő ciklus újrapróbálja/.test(dump), true);
check("nincs „munkamenet lejárt” ítélet", m.isSessionLost(), false);
check("a régi token maradt", m.getAccessToken(), oldToken);
check("a számláló ébresztése (scroll) a hiba ellenére megtörtént", dispatched.includes("scroll"), true);
check("nincs frissítési idő a jelvényre", m.lastRefresh, null);

console.log("B) a következő tick: a hálózat visszajött");
network = "up"; dispatched = [];
await new Promise(r => setTimeout(r, 30));
threw = false;
try { await m.tick(); } catch { threw = true; }
check("a tick nem dob", threw, false);
check("újra ment egy frissítés", calls, 2);
check("új token került a tárba", m.getAccessToken() !== oldToken && m.getAccessToken() === sessionStorage.getItem("access_token"), true);
check("a jelvény frissítési ideje beállt", m.lastRefresh instanceof Date, true);
check("a napló: frissítés OK", /frissítés OK — új token/.test(m.diagDump()), true);
await new Promise(r => setTimeout(r, 30));
check("nem volt kezeletlen promise-elutasítás", unhandled, 0);

const failed = results.filter(r => !r).length;
console.log(failed === 0 ? `MIND A(Z) ${results.length} RENDBEN` : `${failed} BUKOTT`);
process.exit(failed ? 1 : 0);
