// A szkript letöltéseinek számlálása: a /npu.user.js a Workeren át megy, ami
// egy adatpontot ír (fajta, böngésző-család, ország; IP nélkül), és az assetet
// változatlanul adja vissza. A számlálás sosem állhat a letöltés útjába. Az
// admin végpont csak tokennel megy, a KV nélkül is, és a Cloudflare SQL API
// válaszából a tegnapi háttérkérésekből becsül aktív telepítést.
import worker from "../worker/index.js";
import { aggregate, browserFamily, classify, statsQuery } from "../worker/installs.js";

const results = [];
const check = (label, actual, expected) => { const pass = actual === expected; results.push(pass); console.log(`  ${pass ? "✓" : "✗ FAIL"}  ${label}${pass ? "" : `  (kapott: ${JSON.stringify(actual)}, várt: ${JSON.stringify(expected)})`}`); };

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const EDGE = CHROME + " Edg/152.0.0.0";
const OPERA = CHROME + " OPR/118.0.0.0";
const FIREFOX = "Mozilla/5.0 (Macintosh; Intel Mac OS X 15.6; rv:143.0) Gecko/20100101 Firefox/143.0";
const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15";

function request(headers, { method = "GET", cf = { country: "HU" } } = {}) {
  const req = new Request("https://example.test/npu.user.js", { method, headers });
  Object.defineProperty(req, "cf", { value: cf });
  return req;
}

console.log("1) a kérés fajtája a fejlécekből");
check("navigáció (telepítés gomb) → install", classify(request({ "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document", "User-Agent": CHROME })).kind, "install");
check("háttérkérés Range-dzsel (Tampermonkey napi ellenőrzés) → check", classify(request({ "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty", Range: "bytes=0-4095", "User-Agent": CHROME })).kind, "check");
check("háttérkérés teljes fájlért → download", classify(request({ "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "empty", "User-Agent": FIREFOX })).kind, "download");
check("Sec-Fetch nélkül, HTML-t kérő Accept → install (régi böngésző)", classify(request({ Accept: "text/html,application/xhtml+xml", "User-Agent": SAFARI })).kind, "install");
check("Sec-Fetch nélkül, más Accept → download", classify(request({ Accept: "*/*", "User-Agent": "curl/8.0" })).kind, "download");
check("az ország a Cloudflare cf-adatából", classify(request({ "User-Agent": CHROME })).country, "HU");
check("ország nélkül: ?", classify(request({ "User-Agent": CHROME }, { cf: null })).country, "?");

console.log("\n2) böngésző-család");
check("Chrome", browserFamily(CHROME), "Chrome");
check("Edge (a Chrome-minta ellenére)", browserFamily(EDGE), "Edge");
check("Opera", browserFamily(OPERA), "Opera");
check("Firefox", browserFamily(FIREFOX), "Firefox");
check("Safari", browserFamily(SAFARI), "Safari");
check("ismeretlen → egyéb", browserFamily("curl/8.0"), "egyéb");
check("hiányzó UA → egyéb", browserFamily(undefined), "egyéb");

console.log("\n3) a letöltés útján: adatpont, majd az asset változatlanul");
const points = [];
const assets = { fetch: async (req) => new Response("// ==UserScript==", { status: 200, headers: { "Content-Type": "text/javascript", "X-Method": req.method } }) };
const env = { ASSETS: assets, INSTALLS: { writeDataPoint: (p) => points.push(p) }, ADMIN_TOKEN: "s3cret-token", CF_ACCOUNT_ID: "acc", CF_ANALYTICS_TOKEN: "tok" };
let res = await worker.fetch(request({ "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty", Range: "bytes=0-4095", "User-Agent": EDGE }), env);
check("az asset jön vissza", await res.text(), "// ==UserScript==");
check("egy adatpont íródott", points.length, 1);
check("index: a fajta", points[0].indexes[0], "check");
check("blobok: fajta, böngésző, ország, range", points[0].blobs.join("|"), "check|Edge|HU|range");
check("egy darab", points[0].doubles[0], 1);
check("nincs benne IP vagy UA", JSON.stringify(points[0]).includes("Mozilla"), false);
await worker.fetch(request({ "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document", "User-Agent": FIREFOX }, { cf: { country: "RO" } }), env);
check("telepítés-kattintás is számol", points[1].blobs.join("|"), "install|Firefox|RO|full");
res = await worker.fetch(request({ "User-Agent": CHROME }, { method: "HEAD" }), env);
check("HEAD: számol", points.length, 3);
check("HEAD: átmegy az assethez", res.headers.get("X-Method"), "HEAD");
res = await worker.fetch(request({ "User-Agent": CHROME }, { method: "POST" }), env);
check("POST: nem számol", points.length, 3);
check("POST: az assethez megy tovább", res.headers.get("X-Method"), "POST");
res = await worker.fetch(request({ "User-Agent": CHROME }), { ...env, INSTALLS: undefined });
check("kötés nélkül is jön az asset", res.status, 200);
res = await worker.fetch(request({ "User-Agent": CHROME }), { ...env, INSTALLS: { writeDataPoint: () => { throw new Error("quota"); } } });
check("ha a számlálás hibázik, az asset akkor is jön", await res.text(), "// ==UserScript==");

console.log("\n4) összesítés a lekérdezés soraiból");
const rows = [
  { day: "2026-09-07 00:00:00", kind: "check", browser: "Chrome", country: "HU", n: 40 },
  { day: "2026-09-07 00:00:00", kind: "check", browser: "Firefox", country: "HU", n: 5 },
  { day: "2026-09-07 00:00:00", kind: "download", browser: "Chrome", country: "RO", n: 3 },
  { day: "2026-09-07 00:00:00", kind: "install", browser: "Chrome", country: "HU", n: 4 },
  { day: "2026-09-08 00:00:00", kind: "check", browser: "Chrome", country: "HU", n: 44 },
  { day: "2026-09-08 00:00:00", kind: "download", browser: "Edge", country: "HU", n: 2 },
  { day: "2026-09-09 00:00:00", kind: "check", browser: "Chrome", country: "HU", n: 12 },
  { day: "2026-09-09 00:00:00", kind: "furcsa", browser: "Chrome", country: "HU", n: 1 },
];
const agg = aggregate(rows, 30, "2026-09-09");
check("napok száma", agg.daily.length, 3);
check("növekvő sorrend", agg.daily[0].day, "2026-09-07");
check("napi bontás: ellenőrzés", agg.daily[0].check, 45);
check("napi bontás: letöltés", agg.daily[0].download, 3);
check("napi bontás: telepítés", agg.daily[0].install, 4);
check("ismeretlen fajta → letöltésnek számít", agg.daily[2].download, 1);
check("összesen ellenőrzés", agg.totals.check, 101);
check("összesen letöltés", agg.totals.download, 6);
check("összesen telepítés", agg.totals.install, 4);
check("tegnap = 09-08", agg.yesterday.day, "2026-09-08");
check("tegnapi háttérkérés (becsült aktív) = 44 + 2", agg.yesterday.check + agg.yesterday.download, 46);
check("ma csonka", agg.today.check, 12);
check("böngésző-lista a háttérkérésekből, telepítés-kattintás nélkül", agg.browsers.map((b) => `${b.name}:${b.n}`).join(","), "Chrome:100,Firefox:5,Edge:2");
check("ország-lista", agg.countries.map((c) => `${c.name}:${c.n}`).join(","), "HU:104,RO:3");
const empty = aggregate([], 7, "2026-09-09");
check("üres adat: nullák", empty.totals.check + empty.yesterday.download + empty.daily.length, 0);
check("üres adat: tegnap napja akkor is megvan", empty.yesterday.day, "2026-09-08");
check("a lekérdezés mintavételt korrigál", statsQuery(30).includes("SUM(_sample_interval)"), true);
check("a lekérdezés az időszakot használja", statsQuery(7).includes("INTERVAL '7' DAY"), true);

console.log("\n5) admin végpont: token, konfiguráció, lekérdezés");
const apiCalls = [];
globalThis.fetch = async (url, init) => {
  apiCalls.push({ url: String(url), auth: init.headers.Authorization, body: init.body });
  return { ok: true, status: 200, json: async () => ({ data: rows }), text: async () => "" };
};
const req = (path, init = {}, e = env) => worker.fetch(new Request("https://example.test" + path, init), e);
const auth = { Authorization: "Bearer s3cret-token" };
res = await req("/api/admin/installs"); check("token nélkül 401", res.status, 401);
res = await req("/api/admin/installs", { headers: auth }); let data = await res.json();
check("tokennel 200 (KV nélkül is)", res.status, 200);
check("a Cloudflare SQL API-t hívta", apiCalls[0].url, "https://api.cloudflare.com/client/v4/accounts/acc/analytics_engine/sql");
check("a saját tokennel", apiCalls[0].auth, "Bearer tok");
check("30 nap az alapérték", apiCalls[0].body.includes("INTERVAL '30' DAY"), true);
check("az összesítés jön vissza", data.totals.check, 101);
check("a válasz nem cache-elhető", res.headers.get("Cache-Control"), "no-store");
res = await req("/api/admin/installs?days=7", { headers: auth });
check("days=7 átmegy", apiCalls[1].body.includes("INTERVAL '7' DAY"), true);
res = await req("/api/admin/installs?days=5000", { headers: auth });
check("days felülről 90-re vágva", apiCalls[2].body.includes("INTERVAL '90' DAY"), true);
res = await req("/api/admin/installs?days=abc", { headers: auth });
check("értelmetlen days → 30", apiCalls[3].body.includes("INTERVAL '30' DAY"), true);
res = await req("/api/admin/installs?days=1", { headers: auth });
check("days=1 (24 óra, gördülő) átmegy", apiCalls[4].body.includes("INTERVAL '1' DAY"), true);
res = await req("/api/admin/installs?days=3", { headers: auth });
check("days=3 átmegy", apiCalls[5].body.includes("INTERVAL '3' DAY"), true);
res = await req("/api/admin/installs", { headers: auth }, { ...env, INSTALLS: undefined }); check("kötés nélkül 503", res.status, 503);
res = await req("/api/admin/installs", { headers: auth }, { ...env, CF_ANALYTICS_TOKEN: undefined }); check("lekérdező token nélkül 503", res.status, 503);
res = await req("/api/admin/installs", { method: "DELETE", headers: auth }); check("DELETE 405", res.status, 405);
globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({}), text: async () => "forbidden" });
res = await req("/api/admin/installs", { headers: auth }); data = await res.json();
check("ha a Cloudflare elutasít: 502 és az ok", res.status === 502 && data.error.includes("403"), true);
res = await req("/api/admin/reports", { headers: auth }); check("a bejelentések KV nélkül továbbra is 503", res.status, 503);

console.log("\n6) health");
res = await req("/api/health"); data = await res.json();
check("installStatsConfigured", data.installStatsConfigured, true);
check("installQueryConfigured", data.installQueryConfigured, true);
res = await req("/api/health", {}, { ...env, INSTALLS: undefined, CF_ACCOUNT_ID: undefined }); data = await res.json();
check("mindkettő jelzi a hiányt", data.installStatsConfigured || data.installQueryConfigured, false);
check("az érték nem szivárog", JSON.stringify(data).includes("tok"), false);

console.log("\n7) admin oldal");
res = await req("/admin");
const html = await res.text();
check("van Telepítések blokk", html.includes('id="installs"'), true);
const options = [...html.matchAll(/<option value="(\d+)"( selected)?>([^<]+)<\/option>/g)].map((m) => m[1] + ":" + m[3] + (m[2] ? "*" : ""));
check("időszak-választó: 24 óra, 3, 7, 30 (alapértelmezett), 90 nap", options.join(","), "1:24 óra,3:3 nap,7:7 nap,30:30 nap*,90:90 nap");
check("a számok felirata 24 óránál nem „1 nap”", html.includes('days === 1 ? "24 óra"'), true);
check("24 óránál a becslés az ablak háttérkéréseiből megy", html.includes("az elmúlt 24 óra háttérkérései"), true);
check("az oldal nem tartalmaz tokent vagy account id-t", html.includes("acc") && html.includes("Bearer tok"), false);

const failed = results.filter((r) => !r).length;
console.log(failed === 0 ? `MIND A(Z) ${results.length} RENDBEN` : `${failed} BUKOTT`);
process.exit(failed ? 1 : 0);
