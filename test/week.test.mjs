// „6. szorgalmi hét": a hét sorszáma az időszak kezdőhetének hétfőjétől, hétfő-
// vasárnap hetekkel, az óraátállításon át is; a vizsgahét csak valódi
// „Vizsgaidőszak" időszakból, a vizsgajelentkezésiből nem; a fejléc dátuma
// heti és napi nézetben olvasható, havi nézetben nincs felirat. Az időszakok
// félévente egyszer jönnek le, hallgatónként tárolva.
const ENTRY = process.argv[2];
const results = [];
const check = (label, actual, expected) => { const pass = actual === expected; results.push(pass); console.log(`  ${pass ? "✓" : "✗ FAIL"}  ${label}${pass ? "" : `  (kapott: ${JSON.stringify(actual)}, várt: ${JSON.stringify(expected)})`}`); };
function makeStore() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), get length() { return m.size; }, key: i => [...m.keys()][i] ?? null }; }
globalThis.location = { pathname: "/hallgatoi/calendar", origin: "https://neptun.bme.hu", host: "neptun.bme.hu" };
globalThis.document = { title: "Neptun Web", visibilityState: "visible", querySelector: s => (s === "base" ? { getAttribute: () => "/hallgatoi/" } : null), addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true };
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } };
globalThis.Event = class { constructor(type) { this.type = type; } };
globalThis.sessionStorage = makeStore(); globalThis.localStorage = makeStore();
globalThis.window = { setInterval, clearInterval, setTimeout, clearTimeout };
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = () => `${b64({ alg: "HS256" })}.${b64({ SessionId: "s1", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300 })}.s`;
sessionStorage.setItem("access_token", jwt());

const m = await import("../" + ENTRY);
const d = (y, mo, day) => new Date(y, mo - 1, day);
const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

console.log("A) a hét hétfője");
check("szerda → hétfő", iso(m.mondayOf(d(2026, 10, 14))), "2026-10-12");
check("vasárnap → az előző hétfő", iso(m.mondayOf(d(2026, 10, 18))), "2026-10-12");
check("hétfő marad", iso(m.mondayOf(d(2026, 10, 12))), "2026-10-12");
check("hónapon át", iso(m.mondayOf(d(2026, 10, 1))), "2026-09-28");

console.log("\nB) a hét sorszáma (BME 2026/27/1: szept 7 – dec 11)");
const S = new Date("2026-09-07T06:00:00"), E = new Date("2026-12-11T23:59:59");
check("okt 12–18 = 6. hét (az óbudai példa)", m.weekNumber(S, E, d(2026, 10, 12)), 6);
check("a hét vasárnapja is 6.", m.weekNumber(S, E, d(2026, 10, 18)), 6);
check("szept 7 = 1. hét", m.weekNumber(S, E, d(2026, 9, 7)), 1);
check("szept 6 (előtte) → nincs", m.weekNumber(S, E, d(2026, 9, 6)), null);
check("dec 11 (az utolsó péntek) = 14. hét", m.weekNumber(S, E, d(2026, 12, 11)), 14);
check("dec 14 (utána) → nincs", m.weekNumber(S, E, d(2026, 12, 14)), null);
check("óraátállítás után (nov 2) = 9. hét", m.weekNumber(S, E, d(2026, 11, 2)), 9);
check("szerdán kezdődő időszak: a hétfője már 1. hét", m.weekNumber(new Date("2026-09-09T00:00:00"), E, d(2026, 9, 7)), 1);
check("és a rá következő hét a 2.", m.weekNumber(new Date("2026-09-09T00:00:00"), E, d(2026, 9, 14)), 2);

console.log("\nC) milyen időszak");
check("Szorgalmi Időszak → szorgalmi", m.kindOf({ type: "Szorgalmi Időszak", name: "Szorgalmi időszak 2026/27/1" }), "study");
check("Vizsgaidőszak → vizsga", m.kindOf({ type: "Vizsgaidőszak", name: "Vizsgaidőszak 2026/27/1" }), "exam");
check("Vizsgajelentkezési időszak → NEM vizsga", m.kindOf({ type: "Vizsgajelentkezési időszak", name: "Vizsgajelentkezési időszak 2026/27/1" }), null);
check("Jegybeírási → semmi", m.kindOf({ type: "Jegybeírási időszak", name: "Jegybeírási időszak" }), null);
check("csak a névből is", m.kindOf({ type: "Egyéb", name: "Vizsgaidőszak 2026/27/1" }), "exam");
check("hiányzó mezők → semmi", m.kindOf({}), null);

console.log("\nD) a felirat");
const study = { type: "Szorgalmi Időszak", name: "Szorgalmi időszak 2026/27/1", start: "2026-09-07T06:00:00", end: "2026-12-11T23:59:59" };
const examReg = { type: "Vizsgajelentkezési időszak", name: "Vizsgajelentkezési időszak", start: "2026-12-08T18:00:00", end: "2027-01-29T23:59:59" };
const exam = { type: "Vizsgaidőszak", name: "Vizsgaidőszak 2026/27/1", start: "2026-12-14T00:00:00", end: "2027-01-29T23:59:59" };
const prev = { type: "Szorgalmi Időszak", name: "Szorgalmi időszak 2025/26/2", start: "2026-02-09T06:00:00", end: "2026-05-22T23:59:59" };
check("szorgalmi hét", m.labelFor([study, examReg], d(2026, 10, 14)), "6. szorgalmi hét");
check("vizsgahét, ha van vizsgaidőszak", m.labelFor([study, examReg, exam], d(2026, 12, 16)), "1. vizsgahét");
check("a vizsgaidőszak 7. hete", m.labelFor([study, examReg, exam], d(2027, 1, 29)), "7. vizsgahét");
check("vizsgaidőszak nélkül (BME) decemberben nincs felirat", m.labelFor([study, examReg], d(2026, 12, 16)), null);
check("az időszakok után semmi", m.labelFor([study, examReg, exam], d(2027, 2, 3)), null);
check("két félév listázva: a mostani számít", m.labelFor([prev, study], d(2026, 10, 14)), "6. szorgalmi hét");
check("az előző félévre is jó", m.labelFor([prev, study], d(2026, 3, 4)), "4. szorgalmi hét");
check("üres lista → semmi", m.labelFor([], d(2026, 10, 14)), null);

console.log("\nE) a fejléc dátuma");
check("heti nézet: az első nap", iso(m.parseHeaderDate("2026. október 12. - 2026. október 18.")), "2026-10-12");
check("napi nézet", iso(m.parseHeaderDate("2026. október 13.")), "2026-10-13");
check("havi nézet → nincs nap", m.parseHeaderDate("2026. október"), null);
check("évváltás", iso(m.parseHeaderDate("2027. január 4. - 2027. január 10.")), "2027-01-04");
check("nagybetűs hónap", iso(m.parseHeaderDate("2026. Október 12.")), "2026-10-12");
check("zaj → nincs", m.parseHeaderDate("Heti nézet"), null);

console.log("\nF) a lekérdezés alakja");
const q = m.periodsQuery(["abc-123"], d(2026, 10, 13));
check("a naptár végpontja", q.startsWith("Calendar/GetCalendarEvents?"), true);
check("csak az időszakok", q.includes("isPeriodsVisible=true") && q.includes("isClassesVisible=false") && q.includes("isExamsVisible=false") && q.includes("isTasksVisible=false"), true);
check("150 nap vissza", q.includes("startDate=2026-05-16T00:00:00.000"), true);
check("150 nap előre, a nap végéig", q.includes("endDate=2027-03-12T23:59:59.999"), true);
check("a képzés azonosítója", q.includes("studentTrainingIds[0]=abc-123"), true);
check("két képzés", m.periodsQuery(["a", "b"], d(2026, 10, 13)).includes("studentTrainingIds[1]=b"), true);

console.log("\nG) betöltés: egyszer a szerverről, utána a tárolóból, hallgatónként");
let calls = [];
globalThis.fetch = async url => {
  const p = String(url).split("/api/")[1].split("?")[0];
  calls.push(p);
  const ok = data => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data }), text: async () => "{}" });
  if (p === "UserInfo") return ok({ neptunCode: "ABC123" });
  if (p === "MyTrainings") return ok([{ studentTrainingId: "t-old", isArchived: true }, { studentTrainingId: "t-1", isArchived: false }]);
  if (p === "Calendar/GetCalendarEvents") {
    check("a lekérdezés az aktív képzéssel megy", String(url).includes("studentTrainingIds[0]=t-1") && !String(url).includes("t-old"), true);
    return ok([
      { intervalType: "Jegybeírási időszak", name: "Jegybeírási időszak 2026/27/1", startDate: "2026-08-31T06:00:00", endDate: "2027-02-02T14:00:00", term: "2026/27/1" },
      { intervalType: "Szorgalmi Időszak", name: "Szorgalmi időszak 2026/27/1", startDate: "2026-09-07T06:00:00", endDate: "2026-12-11T23:59:59", term: "2026/27/1" },
      { intervalType: "Vizsgajelentkezési időszak", name: "Vizsgajelentkezési időszak", startDate: "2026-12-08T18:00:00", endDate: "2027-01-29T23:59:59", term: "2026/27/1" },
    ]);
  }
  return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}), text: async () => "" };
};
await m.storage.initialize();
const now = d(2026, 10, 13);
let periods = await m.loadPeriods(now);
check("csak a számítható időszakok maradnak", periods.map(p => m.kindOf(p)).join(","), "study");
check("a felirat ebből jó", m.labelFor(periods, now), "6. szorgalmi hét");
check("a tárolóban a hallgató kódja alatt", !!m.storage.get("weekLabel", "ABC123"), true);
const before = calls.length;
periods = await m.loadPeriods(new Date(now.getTime() + 2 * 86400000));
check("két nappal később nem kérdez újra", calls.length, before);
periods = await m.loadPeriods(new Date(now.getTime() + 8 * 86400000));
check("egy hét után frissít", calls.slice(before).includes("Calendar/GetCalendarEvents"), true);

const failed = results.filter(r => !r).length;
console.log(failed === 0 ? `MIND A(Z) ${results.length} RENDBEN` : `${failed} BUKOTT`);
process.exit(failed ? 1 : 0);
