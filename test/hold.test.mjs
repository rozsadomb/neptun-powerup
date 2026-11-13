// v0.14.2, a Metropolitan-napló (2026-11-13): az app saját kérése nem futhat
// a frissítéssel egy időben. A hálózatfigyelő a send()-et tartja vissza, amíg
// a frissítés tart; a frissítés maga, a szinkron és a nem-API kérés azonnal
// megy; megszakított kérés utólag sem megy el; és semmilyen hiba nem
// ragaszthatja be az app kérését. A napló kimondja, mi futott a frissítés
// mellett, és a 401-es sor visszautal az előző sikeres frissítésre.
const ENTRY = process.argv[2];
const results = []; const check = (label, actual, expected) => { const pass = actual === expected; results.push(pass); console.log(`  ${pass ? "✓" : "✗ FAIL"}  ${label}${pass ? "" : `  (kapott: ${actual}, várt: ${expected})`}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function makeStore() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), get length() { return m.size; }, key: i => [...m.keys()][i] ?? null }; }

// Az app XHR-je: a send() csak feljegyzi, mi ment ki a „hálózatra”.
const wire = [];
class FakeXHR {
  constructor() { this.listeners = {}; this.status = 0; this.responseType = ""; this.responseText = "{}"; }
  open(method, url) { this.method = method; this.url = url; }
  send(body) { wire.push({ path: this.url.split("/api/")[1] ?? this.url, body, xhr: this }); }
  abort() { this.aborted = true; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  finish(status = 200, text = "{}") { this.status = status; this.responseText = text; (this.listeners.loadend ?? []).splice(0).forEach(fn => fn()); }
}
const API = "https://neptun.bme.hu/hallgatoi/api/";
const appCall = (path, { sync = false, body = null } = {}) => { const x = new FakeXHR(); x.open("GET", API + path, !sync); x.send(body); return x; };
const sentPaths = () => wire.map(w => w.path).join(",");

globalThis.location = { pathname: "/hallgatoi/dashboard", origin: "https://neptun.bme.hu", host: "neptun.bme.hu" };
globalThis.document = { title: "Neptun Web", visibilityState: "hidden", querySelector: s => (s === "base" ? { getAttribute: () => "/hallgatoi/" } : null), addEventListener() {}, dispatchEvent() {} };
globalThis.sessionStorage = makeStore(); globalThis.localStorage = makeStore();
globalThis.navigator = { userAgent: "teszt" };
globalThis.window = { XMLHttpRequest: FakeXHR, setInterval, clearInterval, setTimeout, clearTimeout };
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = n => `${b64({ alg: "HS256" })}.${b64({ sub: n, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300 })}.s`;
const elapse = () => localStorage.setItem("npu-ng:refresh-lock", String(Date.now() - 60_000));

const m = await import("../" + ENTRY);
const { hook, gate } = m;
const starts = [];
hook.onApiStart(info => starts.push(info.path));
await sleep(5);

console.log("A) kapu nélkül minden azonnal megy");
appCall("Dashboard/GetUpcomingEvents");
check("a kérés kiment", sentPaths(), "Dashboard/GetUpcomingEvents");
await sleep(5);

console.log("B) a kapu visszatartja az app kérését, amíg el nem engedi");
wire.length = 0; starts.length = 0;
let release; let consulted = [];
hook.setSendGate(info => { consulted.push(info.path); return new Promise(r => (release = r)); });
appCall("Exam/GetTerms", { body: "törzs" });
await sleep(50);
check("a visszatartott kérés nem ment ki", wire.length, 0);
check("és nem is jelent meg indulóként (a frissítés nem vár rá)", starts.length, 0);
release(); await sleep(20);
check("elengedés után pontosan egyszer megy ki", sentPaths(), "Exam/GetTerms");
check("a törzs változatlan", wire[0].body, "törzs");
check("és ekkor jelenik meg indulóként", starts.join(","), "Exam/GetTerms");

console.log("C) a sorrend megmarad");
wire.length = 0; const releases = [];
hook.setSendGate(() => new Promise(r => releases.push(r)));
appCall("A/Elso"); appCall("B/Masodik"); appCall("C/Harmadik");
releases.forEach(r => r()); await sleep(20);
check("három visszatartott kérés a kattintás sorrendjében megy ki", sentPaths(), "A/Elso,B/Masodik,C/Harmadik");

console.log("D) amit az app közben megszakított, az utólag sem megy el");
wire.length = 0; starts.length = 0;
hook.setSendGate(() => new Promise(r => (release = r)));
const cancelled = appCall("SubjectApplication/SchedulableSubjects");
cancelled.abort(); release(); await sleep(20);
check("a megszakított kérés nem ment ki", wire.length, 0);
check("az abort az eredeti XHR-hez is eljutott", cancelled.aborted, true);
check("és indulóként sem jelent meg", starts.length, 0);

console.log("E) ami nem tartható vissza, azonnal megy");
wire.length = 0; consulted = [];
hook.setSendGate(info => { consulted.push(info.path); return new Promise(() => {}); }, 300);
appCall("General/Szinkron", { sync: true });
check("szinkron kérés azonnal megy", sentPaths(), "General/Szinkron");
const other = new FakeXHR(); other.open("GET", "https://neptun.bme.hu/hallgatoi/assets/i18n/hu.json", true); other.send(null);
check("nem-API kérés azonnal megy", wire.length, 2);
check("és a kaput egyik sem kérdezi", consulted.length, 0);
hook.setSendGate(() => null);
appCall("General/Szabad");
check("ha a kapu nem tart vissza, azonnal megy", wire.length, 3);
hook.setSendGate(() => { throw new Error("hibás kapu"); });
appCall("General/HibasKapu");
check("a kapu hibája nem akasztja meg az app kérését", wire.length, 4);

console.log("F) a soha el nem engedő kapu sem ragaszthat be kérést");
wire.length = 0;
hook.setSendGate(() => new Promise(() => {}), 300);
let t = Date.now(); appCall("Exam/Beragadt");
await sleep(150); check("a plafon előtt még vár", wire.length, 0);
await sleep(300); check(`a plafon után kimegy (${Date.now() - t} ms)`, sentPaths(), "Exam/Beragadt");
hook.setSendGate(() => Promise.reject(new Error("elutasított kapu")));
appCall("Exam/Elutasitott"); await sleep(20);
check("az elutasított ígéret után is kimegy", wire.length, 2);

console.log("G) az api bekötve: az app kérése megvárja a szkript frissítését, az app saját frissítése nem vár");
m.trackAppRefreshes();
wire.length = 0; elapse(); sessionStorage.setItem("access_token", jwt("a"));
const refreshBody = () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ accessToken: jwt("r" + Math.random()), sessionTimeoutInMinutes: 15 }), text: async () => "" });
let duringFetch = () => {};
globalThis.fetch = async () => { duringFetch(); await sleep(300); return refreshBody(); };
let clicked;
duringFetch = () => { clicked = appCall("Exam/GetTerms"); };
t = Date.now(); const refreshing = m.refreshTokens();
await sleep(150);
check("a frissítés közbeni kattintás kérése még nem ment ki", wire.length, 0);
check("a kapu egy várakozót lát", gate.heldAppRequests(), 1);
appCall("Account/GetNewTokens");
check("az app saját frissítése viszont azonnal megy (különben holtpont volna)", sentPaths(), "Account/GetNewTokens");
wire.pop().xhr.finish(200, JSON.stringify({ sessionTimeoutInMinutes: 15 }));
check("a szkript frissítése sikerült", await refreshing, 15); await sleep(30);
check(`a kattintás kérése a frissítés után ment ki (${Date.now() - t} ms ≥ 300)`, sentPaths() === "Exam/GetTerms" && Date.now() - t >= 300, true);
clicked.finish(); await sleep(20);
let dump = m.diagDump();
check("a napló kimondja, hogy egy app-kérés várt", /a frissítés idejére 1 app-kérés várt/.test(dump), true);
check("és nem állítja, hogy bármi a frissítés mellett futott", /egy időben/.test(dump), false);

console.log("H) ami mégis a frissítés mellett futott, azt a napló néven nevezi — és a 401 visszautal rá");
await sleep(10_100); // az app iménti frissítése után a szkript 10 mp-ig nem frissít
wire.length = 0; elapse(); sessionStorage.setItem("access_token", jwt("b"));
duringFetch = () => { gate.appRequestStarted("ExamRegistration/GetExamsList"); gate.appRequestStarted("Exam/GetTerms"); };
check("a frissítés sikerült", await m.refreshTokens(), 15);
gate.appRequestEnded("ExamRegistration/GetExamsList"); gate.appRequestEnded("Exam/GetTerms");
dump = m.diagDump();
check("a napló sorolja a frissítéssel egy időben futó kéréseket",
  /a frissítéssel egy időben 2 app-kérés futott: ExamRegistration\/GetExamsList, Exam\/GetTerms/.test(dump), true);
elapse(); duringFetch = () => {};
globalThis.fetch = async () => ({ ok: false, status: 401, headers: { get: () => null }, json: async () => ({}), text: async () => "" });
check("a következő frissítést a szerver elutasítja", await m.refreshTokens(), null);
dump = m.diagDump();
const line401 = dump.split("\n").find(l => l.includes("ELUTASÍTVA")) ?? "";
check("a 401-es sor visszautal az előző sikeres frissítés átfedésére",
  /az előző sikeres frissítés \(\d+:\d\d:\d\d\) alatt 2 app-kérés futott \(ExamRegistration\/GetExamsList, Exam\/GetTerms\)/.test(line401), true);

console.log("I) az app saját frissítése mellett futó kérés is látszik");
const slow = appCall("SubjectApplication/SchedulableSubjects"); await sleep(5);
const appRefresh = appCall("Account/GetNewTokens"); await sleep(5);
appRefresh.finish(200, JSON.stringify({ sessionTimeoutInMinutes: 15 })); await sleep(5);
slow.finish(); await sleep(20);
dump = m.diagDump();
check("a napló az app frissítésénél is megnevezi",
  /a frissítéssel egy időben 1 app-kérés futott: SubjectApplication\/SchedulableSubjects/.test(dump), true);
check("a végén nincs várakozó és nincs repülő kérés", gate.heldAppRequests() + gate.appRequestsInFlight(), 0);

console.log("J) ha az app saját frissítését utasítja el a szerver, az a sor is visszautal");
sessionStorage.setItem("access_token", jwt("c"));
const stop = m.keepAlive.activate();
const rejected = appCall("Account/GetNewTokens"); await sleep(5);
rejected.finish(401, JSON.stringify({ message: "Authorization has been denied for this request." })); await sleep(20);
stop();
const appLine401 = m.diagDump().split("\n").find(l => l.includes("az app frissítése ELUTASÍTVA")) ?? "";
check("a szerver üzenete megmarad a sorban", appLine401.includes("Authorization has been denied"), true);
check("és az előző sikeres frissítés átfedése is benne van",
  /az előző sikeres frissítés \(\d+:\d\d:\d\d\) alatt 1 app-kérés futott \(SubjectApplication\/SchedulableSubjects\)/.test(appLine401), true);

const failed = results.filter(r => !r).length; console.log(failed === 0 ? `MIND A(Z) ${results.length} RENDBEN` : `${failed} BUKOTT`); process.exit(failed ? 1 : 0);
