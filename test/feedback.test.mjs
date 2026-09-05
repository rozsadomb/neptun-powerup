// A visszajelzés-worker: a nyilvános GitHub-issue-ba csak a szöveg kerül, az
// email cím soha. A teljes bejelentés (szöveg + elérhetőség) a privát KV-tárolóba
// megy, és csak az admin token birtokában olvasható. A GitHub-hívás és a KV
// stubolva van, kérés nem megy ki sehova.
import worker from "../worker/index.js";

const results = [];
const check = (label, actual, expected) => { const pass = actual === expected; results.push(pass); console.log(`  ${pass ? "✓" : "✗ FAIL"}  ${label}${pass ? "" : `  (kapott: ${JSON.stringify(actual)}, várt: ${JSON.stringify(expected)})`}`); };

function fakeKv() {
  const store = new Map();
  return {
    puts: [],
    async put(key, value, opts) { this.puts.push({ key, value, opts }); store.set(key, { value, metadata: opts?.metadata }); },
    async get(key, type) { const e = store.get(key); return e ? (type === "json" ? JSON.parse(e.value) : e.value) : null; },
    async delete(key) { store.delete(key); },
    async list({ prefix = "" } = {}) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name, metadata: store.get(name).metadata }));
      return { keys, list_complete: true };
    },
  };
}

const githubCalls = [];
let nextIssue = 41;
globalThis.fetch = async (url, init) => {
  githubCalls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
  nextIssue++;
  return { ok: true, status: 201, json: async () => ({ number: nextIssue, html_url: `https://github.com/x/y/issues/${nextIssue}` }), text: async () => "" };
};

const kv = fakeKv();
const env = { GITHUB_TOKEN: "t", GITHUB_REPO: "x/y", FEEDBACK: kv, ADMIN_TOKEN: "s3cret-token", FEEDBACK_TTL_DAYS: 30, ASSETS: { fetch: async () => new Response("asset") } };
const post = (path, payload, e = env) => worker.fetch(new Request("https://example.test" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }), e);
const req = (path, init = {}, e = env) => worker.fetch(new Request("https://example.test" + path, init), e);
const auth = { Authorization: "Bearer s3cret-token" };
const EMAIL = "hallgato@example.com";
const BODY = "Részletes leírás a hibáról, tíz karakternél hosszabb.";
const base = { type: "bug", title: "A helyfigyelő nem jelez", body: BODY, website: "" };

console.log("1) elérhetőséggel: az issue-ban csak a szöveg, a KV-ban minden");
let res = await post("/api/feedback", { ...base, contact: EMAIL });
let data = await res.json();
check("200-as válasz", res.status, 200);
check("issue url visszajön", data.url, "https://github.com/x/y/issues/42");
check("contactSaved: true", data.contactSaved, true);
check("az issue-ban ott a szöveg", githubCalls[0].body.body.startsWith(BODY), true);
check("az issue szövegében nincs email", githubCalls[0].body.body.includes(EMAIL), false);
check("a teljes GitHub-kérésben sincs email", JSON.stringify(githubCalls[0]).includes(EMAIL), false);
check("az issue jelzi, hogy van privát elérhetőség", githubCalls[0].body.body.includes("csak a karbantartó látja"), true);
check("KV-kulcs az issue számával, feltöltve", kv.puts[0].key, "report:00000042");
check("lejárat: 30 nap", kv.puts[0].opts.expirationTtl, 30 * 86400);
const stored = JSON.parse(kv.puts[0].value);
check("a tárolt rekordban a szöveg", stored.body, BODY);
check("és az email", stored.contact, EMAIL);
check("és a típus", stored.type, "bug");
check("a kivonatban (metaadat) az email", kv.puts[0].opts.metadata.contact, EMAIL);
check("a kivonatban nincs szöveg (méretkorlát)", "body" in kv.puts[0].opts.metadata, false);

console.log("2) elérhetőség nélkül: a bejelentés akkor is a tárolóba kerül");
res = await post("/api/feedback", { ...base, contact: "" }); data = await res.json();
check("contactSaved: null", data.contactSaved, null);
check("van új KV-írás", kv.puts.length, 2);
check("üres elérhetőséggel", JSON.parse(kv.puts[1].value).contact, "");
check("az issue nem emlegeti", githubCalls[1].body.body.includes("elérhetőséget"), false);

console.log("3) a KV nincs bekötve: az issue megnyílik, a válasz jelzi a hiányt");
res = await post("/api/feedback", { ...base, contact: EMAIL }, { ...env, FEEDBACK: undefined }); data = await res.json();
check("200-as válasz", res.status, 200);
check("contactSaved: false", data.contactSaved, false);
check("az issue-ban ekkor sincs email", githubCalls[2].body.body.includes(EMAIL), false);

console.log("4) honeypot: nem nyit issue-t");
const before = githubCalls.length;
res = await post("/api/feedback", { ...base, contact: EMAIL, website: "http://spam" });
check("200 (a botnak siker)", res.status, 200);
check("nem ment GitHub-kérés", githubCalls.length, before);

console.log("5) admin API: csak tokennel, legfrissebb elöl, szöveg külön kérésre");
await post("/api/feedback", { ...base, type: "idea", title: "Második bejelentés", contact: "masik@example.com" });
res = await req("/api/admin/reports"); check("token nélkül 401", res.status, 401);
res = await req("/api/admin/reports", { headers: { Authorization: "Bearer rossz" } }); check("rossz tokennel 401", res.status, 401);
res = await req("/api/admin/reports", { headers: auth }); data = await res.json();
check("jó tokennel 200", res.status, 200);
check("ttlDays", data.ttlDays, 30);
check("három elem", data.items.length, 3);
check("a legfrissebb elöl", data.items[0].issue, 45);
check("típusa: ötlet", data.items[0].type, "idea");
check("a legrégebbi a végén", data.items[2].contact, EMAIL);
check("a listában nincs szöveg", data.items.some((it) => "body" in it), false);
check("a válasz nem cache-elhető", res.headers.get("Cache-Control"), "no-store");
res = await req("/api/admin/reports/42", { headers: auth }); data = await res.json();
check("egy bejelentés lekérése 200", res.status, 200);
check("szöveggel", data.body, BODY);
check("és emaillel", data.contact, EMAIL);
res = await req("/api/admin/reports/999", { headers: auth }); check("nem létező: 404", res.status, 404);
res = await req("/api/admin/reports", { headers: auth }, { ...env, ADMIN_TOKEN: undefined }); check("ADMIN_TOKEN nélkül 503", res.status, 503);
res = await req("/api/admin/reports", { headers: auth }, { ...env, FEEDBACK: undefined }); check("KV nélkül 503", res.status, 503);

console.log("6) admin törlés");
res = await req("/api/admin/reports/42", { method: "DELETE" }); check("törlés token nélkül 401", res.status, 401);
res = await req("/api/admin/reports/42", { method: "DELETE", headers: auth }); check("törlés 200", res.status, 200);
res = await req("/api/admin/reports", { headers: auth }); data = await res.json();
check("két elem maradt", data.items.length, 2);
check("a 42-es nincs köztük", data.items.some((it) => it.issue === 42), false);

console.log("7) admin oldal és health");
res = await req("/admin");
check("admin oldal 200", res.status, 200);
check("html", (res.headers.get("Content-Type") || "").startsWith("text/html"), true);
check("noindex", (res.headers.get("X-Robots-Tag") || "").includes("noindex"), true);
check("az oldal maga nem tartalmaz adatot", (await res.text()).includes("example.com"), false);
res = await req("/api/health"); data = await res.json();
check("health: KV bekötve", data.feedbackStoreConfigured, true);
check("health: admin token", data.adminTokenConfigured, true);
check("health: ttl", data.feedbackTtlDays, 30);
res = await req("/api/health", {}, { ...env, FEEDBACK_TTL_DAYS: undefined }); data = await res.json();
check("health: ttl alapértéke 90", data.feedbackTtlDays, 90);

console.log("8) hosszú szöveg (diagnosztikai napló) nem csonkolódik");
const longBody = ("12:00:01  keepAlive: frissítés indul, fül látható\n").repeat(400);
res = await post("/api/feedback", { ...base, body: longBody, contact: "" });
check("200-as válasz", res.status, 200);
check("20 000+ karakter átment", githubCalls[githubCalls.length - 1].body.body.startsWith(longBody.trim()), true);

const failed = results.filter((r) => !r).length;
console.log(failed === 0 ? `MIND A(Z) ${results.length} RENDBEN` : `${failed} BUKOTT`);
process.exit(failed ? 1 : 0);
