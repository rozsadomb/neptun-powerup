// A kérés-kapu: kérés nem indul frissítés alatt, frissítés nem indul kérés
// alatt, tulajdonos-tudatos jelek, single-flight várakozás után is, író-
// előny, és a 401-újrapróbálkozás útján sincs holtpont. Egyetlen közös
// modulpéldányon (core-entry), különben a kapu-állítások üresen igazak.
const CORE = process.argv[2];
const results = []; const check = (label, actual, expected) => { const pass = actual === expected; results.push(pass); console.log(`  ${pass ? "✓" : "✗ FAIL"}  ${label}${pass ? "" : `  (kapott: ${actual}, várt: ${expected})`}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function makeStore() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), get length() { return m.size; }, key: i => [...m.keys()][i] ?? null }; }
globalThis.location = { pathname: "/hallgatoi/dashboard", origin: "https://neptun.bme.hu", host: "neptun.bme.hu" };
globalThis.document = { title: "Neptun Web", querySelector: s => (s === "base" ? { getAttribute: () => "/hallgatoi/" } : null) };
globalThis.sessionStorage = makeStore(); globalThis.localStorage = makeStore();
globalThis.window = { setInterval, clearInterval, setTimeout, clearTimeout };
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = n => `${b64({ alg: "HS256" })}.${b64({ sub: n, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300 })}.s`;
const ok = (body = { data: 1 }) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
const refreshOk = () => ok({ accessToken: jwt("r" + Math.random()), sessionTimeoutInMinutes: 30 });
// A fülök közti zár 5 mp-ig él — az esetek közt "teljen el idő".
const elapse = () => localStorage.setItem("npu-ng:refresh-lock", String(Date.now() - 60_000));

const core = await import("../" + CORE);
const { gate } = core;
const calls = [];
let fetchImpl = async () => ok();
globalThis.fetch = async (url, init) => { const p = url.split("/api/")[1].split("?")[0]; calls.push(p); return fetchImpl(p, init); };

console.log("A) a kapu önmagában");
let t = Date.now(); await gate.waitForRequestSlot(); check("tétlen kapun nincs várakozás", Date.now() - t < 50, true);
let m = gate.markRefreshStart("npu");
let pending = gate.waitForRequestSlot(); await sleep(250); gate.markRefreshEnd(m, 300);
let waited = await pending; check(`kérés megvárja a frissítést + a türelmi időt (${waited} ms ≥ 500)`, waited >= 500, true);
const release = gate.beginRequest();
pending = gate.waitForQuiet(); await sleep(300); release();
waited = await pending; check(`frissítés megvárja a kérés végét (${waited} ms ≥ 250)`, waited >= 250, true);
release(); check("dupla felszabadítás nem viszi mínuszba", gate.inFlightRequests(), 0);

console.log("B) tulajdonos-tudatos jelek: a saját jel vége nem törli az appét");
const own = gate.markRefreshStart("npu"); const app = gate.markRefreshStart("app");
gate.markRefreshEnd(own); check("az app jele megmarad", gate.isRefreshing(), true);
check("otherRefreshActive a saját id-n kívül látja az appét", gate.otherRefreshActive(own), true);
gate.markRefreshEnd(app); check("mindkettő vége után szabad", gate.isRefreshing(), false);

console.log("C) refreshTokens() megvárja az app futó frissítését, és utána EGYSZER küld");
sessionStorage.setItem("access_token", jwt("a")); elapse(); calls.length = 0;
fetchImpl = async p => (p.includes("GetNewTokens") ? refreshOk() : ok());
const appMark = gate.markRefreshStart("app");
const r1 = core.refreshTokens(), r2 = core.refreshTokens();
await sleep(400);
check("amíg az app frissít, nem megy saját GetNewTokens", calls.filter(c => c.includes("GetNewTokens")).length, 0);
gate.markRefreshEnd(appMark);
await Promise.all([r1, r2]); await sleep(50);
check("a jel vége után pontosan EGY GetNewTokens ment", calls.filter(c => c.includes("GetNewTokens")).length, 1);
check("a kapu üres a végén", gate.isRefreshing(), false);

console.log("D) api(): 401 → frissítés → újrapróba, holtpont nélkül");
sessionStorage.setItem("access_token", jwt("b")); elapse(); calls.length = 0;
let userInfoCalls = 0;
fetchImpl = async p => { if (p.includes("GetNewTokens")) return refreshOk(); if (p === "UserInfo" && ++userInfoCalls === 1) return { ok: false, status: 401, headers: { get: () => null }, json: async () => ({}), text: async () => "" }; return ok({ data: { neptunCode: "X" } }); };
const raced = await Promise.race([core.api("UserInfo").then(() => "ok"), sleep(4000).then(() => "TIMEOUT")]);
check("a hívás befejeződik (nincs holtpont)", raced, "ok");
check("sorrend: UserInfo(401) → GetNewTokens → UserInfo(200)", calls.join(" → "), "UserInfo → Account/GetNewTokens → UserInfo");
check("a kapu üres a végén", gate.inFlightRequests(), 0);

console.log("E) kérés a frissítés alatt megvárja azt (ugyanaz a kapupéldány)");
fetchImpl = async () => ok(); sessionStorage.setItem("access_token", jwt("c"));
m = gate.markRefreshStart("app"); t = Date.now();
const pend = core.api("Dashboard/GetNumberOfTasksByType"); await sleep(400); gate.markRefreshEnd(m, 0); await pend;
check(`a kérés csak a frissítés után ment el (${Date.now() - t} ms ≥ 400)`, Date.now() - t >= 400, true);

console.log("F) író-előny: folyamatos kérésfolyam mellett a frissítés nem várja ki a 10 mp-es plafont");
sessionStorage.setItem("access_token", jwt("d")); elapse(); calls.length = 0;
fetchImpl = async p => { await sleep(40); return p.includes("GetNewTokens") ? refreshOk() : ok(); };
const chain = (async () => { for (let i = 0; i < 12; i++) await core.api("SubjectApplication/GetSubjectsCourses"); })();
await sleep(50); t = Date.now(); await core.refreshTokens(); const refreshTook = Date.now() - t; await chain;
const idx = calls.indexOf("Account/GetNewTokens");
check(`a frissítés ${refreshTook} ms alatt bejutott (< 2000)`, refreshTook < 2000, true);
check(`a frissítés a lánc elején sorolt be (index ${idx} ≤ 4)`, idx >= 0 && idx <= 4, true);
check("a lánc végigfutott", calls.filter(c => c.includes("GetSubjectsCourses")).length, 12);

console.log("G) a saját fülök-közti bérlet nem tiltja le a saját frissítést");
sessionStorage.setItem("access_token", jwt("e")); elapse(); calls.length = 0;
fetchImpl = async p => (p.includes("GetNewTokens") ? refreshOk() : ok());
core.takeCrossTabLock();
check("saját stempli után refreshTokens() nem null", (await core.refreshTokens()) !== null, true);
check("pontosan EGY GetNewTokens ment", calls.filter(c => c.includes("GetNewTokens")).length, 1);
localStorage.setItem("npu-ng:refresh-lock", String(Date.now()));
check("egy másik fül friss stemplije továbbra is tilt", await core.refreshTokens(), null);

console.log("H) ha a saját kérés a 10 mp-es plafon után is repül, a ciklus kimarad, nem frissít mellé");
sessionStorage.setItem("access_token", jwt("f")); elapse(); calls.length = 0;
let holdResolve; fetchImpl = async p => (p.includes("GetNewTokens") ? refreshOk() : new Promise(r => (holdResolve = () => r(ok()))));
const hung = core.api("SubjectApplication/GetScheduledCourses"); await sleep(50);
t = Date.now(); const skipped = await core.refreshTokens();
check(`kihagyta (${Math.round((Date.now() - t) / 1000)} mp várakozás után)`, skipped, null);
check("nem ment GetNewTokens a repülő kérés mellé", calls.filter(c => c.includes("GetNewTokens")).length, 0);
holdResolve(); await hung;
check("a beragadt kérés felszabadítása után a kapu üres", gate.inFlightRequests(), 0);

console.log("I) az app saját repülő kérése késlelteti a frissítést (de nem hagyatja ki)");
sessionStorage.setItem("access_token", jwt("g")); elapse(); calls.length = 0;
fetchImpl = async p => (p.includes("GetNewTokens") ? refreshOk() : ok());
gate.appRequestStarted(); t = Date.now();
const delayed = core.refreshTokens(); await sleep(300); gate.appRequestEnded();
check("a frissítés megvárta az app kérését", (await delayed) !== null && Date.now() - t >= 300, true);
check("egy GetNewTokens ment", calls.filter(c => c.includes("GetNewTokens")).length, 1);

console.log("J) két fül: a másik fül bérlete blokkolja a kérést, a másik fül kérése a frissítést");
const tabB = await import("../" + CORE + "?tab=B");
sessionStorage.setItem("access_token", jwt("h")); elapse(); calls.length = 0;
fetchImpl = async p => (p.includes("GetNewTokens") ? refreshOk() : ok());
// B fül bérlete → A fül kérése vár, amíg a stempli él (itt kézzel töröljük)
tabB.takeCrossTabLock(); t = Date.now();
const blocked = core.api("Dashboard/GetNumberOfTasksByType"); await sleep(300); localStorage.removeItem("npu-ng:refresh-lock"); await blocked;
check(`A kérése megvárta B bérletét (${Date.now() - t} ms ≥ 300)`, Date.now() - t >= 300, true);
// B fül repülő kérése → A frissítése vár
let holdB; const prevImpl = fetchImpl;
fetchImpl = async p => (p.includes("GetNewTokens") ? refreshOk() : new Promise(r => (holdB = () => r(ok()))));
const bReq = tabB.api("SubjectApplication/GetSubjectsCourses"); await sleep(50);
check("B kérése publikálva a tárolóban", [...Array(localStorage.length)].some((_, i) => localStorage.key(i).startsWith("npu-ng:request:")), true);
t = Date.now(); const aRefresh = core.refreshTokens(); await sleep(300); holdB(); await bReq; await aRefresh;
check(`A frissítése megvárta B kérését (${Date.now() - t} ms ≥ 300)`, Date.now() - t >= 300, true);
check("B jelzője eltűnt a végén", [...Array(localStorage.length)].some((_, i) => localStorage.key(i).startsWith("npu-ng:request:")), false);
fetchImpl = prevImpl;

const failed = results.filter(r => !r).length; console.log(failed === 0 ? `MIND A(Z) ${results.length} RENDBEN` : `${failed} BUKOTT`); process.exit(failed ? 1 : 0);
