// A helyfigyelő nem terhelheti örökké a szervert: ha a kurzus véglegesen
// eltűnt (404/410), a figyelés leáll; átmeneti hibát újrapróbál, de nem
// vég nélkül. Egy debreceni napló szerint két halott figyelés óránként 240
// biztosan sikertelen kérést küldött.
const ENTRY = process.argv[2];
const results = [];
const check = (label, actual, expected) => { const pass = actual === expected; results.push(pass); console.log(`  ${pass ? "✓" : "✗ FAIL"}  ${label}${pass ? "" : `  (kapott: ${actual}, várt: ${expected})`}`); };
function makeStore() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), get length() { return m.size; }, key: i => [...m.keys()][i] ?? null }; }
globalThis.location = { pathname: "/hallgatoi/dashboard", origin: "https://neptun.bme.hu", host: "neptun.bme.hu" };
const events = [];
globalThis.document = {
  title: "Neptun Web", visibilityState: "visible",
  querySelector: s => (s === "base" ? { getAttribute: () => "/hallgatoi/" } : null),
  addEventListener() {}, removeEventListener() {},
  dispatchEvent: e => { events.push(e.type); return true; },
};
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } };
globalThis.Event = class { constructor(type) { this.type = type; } };
globalThis.sessionStorage = makeStore(); globalThis.localStorage = makeStore();
globalThis.window = { setInterval, clearInterval, setTimeout, clearTimeout };
globalThis.Notification = undefined;
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = n => `${b64({ alg: "HS256" })}.${b64({ sub: n, SessionId: "s1", iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000) + 300 })}.s`;
sessionStorage.setItem("access_token", jwt("a"));

let courseStatus = 200, calls = 0;
globalThis.fetch = async url => {
  const p = url.split("/api/")[1].split("?")[0];
  if (p === "UserInfo") return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data: { neptunCode: "ABC123" } }), text: async () => "{}" };
  calls++;
  if (courseStatus === 200) return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data: [] }), text: async () => "{}" };
  return { ok: false, status: courseStatus, headers: { get: () => null }, json: async () => ({}), text: async () => "" };
};

const m = await import("../" + ENTRY);
await m.storage.initialize();
// A valós körben a checkAllWatches oldja fel, itt előre kell, mert a
// figyelések hallgatóhoz kötve tárolódnak.
await m.user.ensureUser();
const base = { subjectId: "s", curriculumTemplateId: "c", curriculumTemplateLineId: "l", termId: "t", termValue: 1, subjectTitle: "Analízis", courseType: "E", autoSignup: false };
const addTwo = () => { m.addWatch({ ...base, courseId: "k1", courseCode: "T1" }); m.addWatch({ ...base, courseId: "k2", courseCode: "T2" }); };

console.log("A) a szerver 410-et ad: a figyelés leáll, nem próbálja tovább");
addTwo();
check("két figyelés indul", Object.keys(m.getWatches()).length, 2);
courseStatus = 410; calls = 0; events.length = 0;
await m.checkAllWatches();
check("egy kör = két kérés", calls, 2);
check("mindkét figyelés leállt", Object.keys(m.getWatches()).length, 0);
check("szólt is róla", events.includes("npu:watch-retired"), true);
calls = 0;
await m.checkAllWatches();
check("a következő körben már NEM kérdez", calls, 0);

console.log("\nB) 404 ugyanígy végleges");
addTwo(); courseStatus = 404; await m.checkAllWatches();
check("leállt", Object.keys(m.getWatches()).length, 0);

console.log("\nC) 500 átmeneti: újrapróbálja, de nem vég nélkül");
addTwo(); courseStatus = 500;
await m.checkAllWatches();
check("egy hiba után még figyel", Object.keys(m.getWatches()).length, 2);
check("számolja a hibákat", m.getWatches()["s:k1"].failures, 1);
for (let i = 0; i < 19; i++) await m.checkAllWatches();
check("20 hiba után leáll magától", Object.keys(m.getWatches()).length, 0);

console.log("\nD) a sikeres kör nullázza a hibaszámlálót");
addTwo(); courseStatus = 500; await m.checkAllWatches();
check("van hibaszámláló", m.getWatches()["s:k1"].failures, 1);
courseStatus = 200; await m.checkAllWatches();
check("siker után nullázódik", m.getWatches()["s:k1"].failures, undefined);
check("és tovább figyel", Object.keys(m.getWatches()).length, 2);

const failed = results.filter(r => !r).length;
console.log(failed === 0 ? `MIND A(Z) ${results.length} RENDBEN` : `${failed} BUKOTT`);
process.exit(failed ? 1 : 0);
