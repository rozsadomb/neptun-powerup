// A béta-értesítő nem nyaggathat: a bemutatkozó kártya verziónként egyszer,
// az emlékeztető 25 perc bejelentkezett futás után, naponta legfeljebb
// egyszer, és soha többé, ha a felhasználó elnémította vagy ebben a
// verzióban már küldött naplót. Két fül ugyanaznap nem kérdezhet kétszer.
const ENTRY = process.argv[2];
const results = [];
const check = (label, actual, expected) => { const pass = actual === expected; results.push(pass); console.log(`  ${pass ? "✓" : "✗ FAIL"}  ${label}${pass ? "" : `  (kapott: ${actual}, várt: ${expected})`}`); };
function makeStore() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), get length() { return m.size; }, key: i => [...m.keys()][i] ?? null }; }
globalThis.location = { pathname: "/hallgatoi/dashboard", origin: "https://neptun.bme.hu", host: "neptun.bme.hu" };
globalThis.document = { title: "Neptun Web", visibilityState: "visible", querySelector: () => null, addEventListener() {}, removeEventListener() {} };
globalThis.sessionStorage = makeStore(); globalThis.localStorage = makeStore();
globalThis.window = { setInterval, clearInterval, setTimeout, clearTimeout };

const m = await import("../" + ENTRY);
const MIN = 60_000;
const T0 = new Date(2026, 8, 8, 10, 0, 0).getTime(); // 2026-09-08 10:00 helyi idő
const base = { version: "0.13.0", loggedSince: T0, onLoginPage: false, visible: true, introShownInTab: false, cardOpen: false };
const decide = (over) => m.decide({ state: {}, now: T0, ...base, ...over });

console.log("A) bemutatkozó kártya: belépés után, verziónként egyszer");
check("belépve, üres állapot → bemutatkozó", decide({}), "intro");
check("kijelentkezve → semmi", decide({ loggedSince: null }), null);
check("a login oldalon → semmi", decide({ onLoginPage: true }), null);
check("rejtett fülön → semmi (majd ha látszik)", decide({ visible: false }), null);
check("nyitott kártya mellett → semmi", decide({ cardOpen: true }), null);
check("ugyanabban a verzióban már látta → nem jön újra", decide({ state: { introVersion: "0.13.0" } }), null);
check("új verzió → egyszer újra", decide({ state: { introVersion: "0.12.4" } }), "intro");
check("elnémítva → soha", decide({ state: { muted: true } }), null);
check("ezen a fülön már volt → nem duplázódik", decide({ introShownInTab: true }), null);

console.log("\nB) emlékeztető: 25 perc bejelentkezett futás után, naponta egyszer");
const seen = { introVersion: "0.13.0" };
check("24 perc után még semmi", decide({ state: seen, now: T0 + 24 * MIN }), null);
check("25 perc után emlékeztető", decide({ state: seen, now: T0 + 25 * MIN }), "reminder");
check("de csak látható fülön", decide({ state: seen, now: T0 + 25 * MIN, visible: false }), null);
check("ha ma már kérdezett → nem", decide({ state: { ...seen, reminderDay: m.dayKey(T0) }, now: T0 + 25 * MIN }), null);
check("másnap újra", decide({ state: { ...seen, reminderDay: m.dayKey(T0) }, now: T0 + 24 * 60 * MIN, loggedSince: T0 + 23 * 60 * MIN }), "reminder");
check("ebben a verzióban már másolt → nem", decide({ state: { ...seen, copiedVersion: "0.13.0" }, now: T0 + 25 * MIN }), null);
check("új verzióban a másolás után is újra kér", decide({ state: { introVersion: "0.14.0", copiedVersion: "0.13.0" }, now: T0 + 25 * MIN, version: "0.14.0" }), "reminder");
check("elnémítva → soha", decide({ state: { ...seen, muted: true }, now: T0 + 60 * MIN }), null);
check("újbóli belépés nullázza a számlálót", decide({ state: seen, now: T0 + 60 * MIN, loggedSince: T0 + 50 * MIN }), null);
check("a bemutatkozó elsőbbséget élvez", decide({ state: {}, now: T0 + 30 * MIN }), "intro");

console.log("\nC) napkulcs helyi dátum szerint");
check("2026-09-08", m.dayKey(T0), "2026-09-08");
check("éjfél előtt/után más nap", m.dayKey(new Date(2026, 8, 8, 23, 59).getTime()) !== m.dayKey(new Date(2026, 8, 9, 0, 1).getTime()), true);

console.log("\nD) két fül: a másik fül döntését a tároló újraolvasása mutatja meg");
await m.storage.initialize();
check("frissen: nincs állapot", m.storage.get("betaNotice"), undefined);
// A másik fül közben elmentette, hogy ma már kérdezett.
localStorage.setItem("npu-ng:data", JSON.stringify({ betaNotice: { reminderDay: m.dayKey(T0), introVersion: "0.13.0" } }));
check("újraolvasás nélkül ezt a fül nem látja", m.storage.get("betaNotice", "reminderDay"), undefined);
await m.storage.reload();
check("újraolvasás után látja", m.storage.get("betaNotice", "reminderDay"), m.dayKey(T0));
check("és ezért nem kérdez", m.decide({ ...base, state: m.storage.get("betaNotice"), now: T0 + 25 * MIN }), null);
// A saját, még ki nem írt módosítás nem veszhet el az újraolvasásban.
m.storage.set("betaNotice", "muted", true);
await m.storage.reload();
check("a saját friss módosítás megmarad", m.storage.get("betaNotice", "muted"), true);
check("a másik fülé is", m.storage.get("betaNotice", "introVersion"), "0.13.0");

const failed = results.filter(r => !r).length;
console.log(failed === 0 ? `MIND A(Z) ${results.length} RENDBEN` : `${failed} BUKOTT`);
process.exit(failed ? 1 : 0);
