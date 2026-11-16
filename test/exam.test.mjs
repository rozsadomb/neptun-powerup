// Vizsgatervező: a diák a jelentkezés nyitása előtt összeválogatja a
// vizsgákat, nyitás után egy kattintással felveszi őket. A terv hallgatónként
// tárolódik; a Neptun sorát csak akkor kötjük vizsgához, ha egyértelmű; a
// jelentkezés azt küldi, amit az app; a szerver elutasításának szövege
// (500-as válasz, notification.description) eljut a diákhoz.
const ENTRY = process.argv[2];
const results = [];
const check = (label, actual, expected) => { const pass = JSON.stringify(actual) === JSON.stringify(expected); results.push(pass); console.log(`  ${pass ? "✓" : "✗ FAIL"}  ${label}${pass ? "" : `  (kapott: ${JSON.stringify(actual)}, várt: ${JSON.stringify(expected)})`}`); };
function makeStore() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), get length() { return m.size; }, key: i => [...m.keys()][i] ?? null }; }
globalThis.location = { pathname: "/hallgatoi/exams/overview/registration", origin: "https://neptun.bme.hu", host: "neptun.bme.hu" };
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
globalThis.navigator = { userAgent: "teszt" };
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = session => `${b64({ alg: "HS256" })}.${b64({ SessionId: session, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300 })}.s`;
sessionStorage.setItem("access_token", jwt("s1"));

let neptunCode = "ABC123";
let signupResponse = { status: 200, body: { data: { isWaiting: false }, notification: [] } };
let listResponse = { status: 200, body: { data: [], notification: [] } };
const posts = [];
const gets = [];
const reply = ({ status, body, raw }) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body, text: async () => raw ?? JSON.stringify(body) });
globalThis.fetch = async (url, init = {}) => {
  const p = url.split("/api/")[1];
  const path = p.split("?")[0];
  if (path === "UserInfo") return reply({ status: 200, body: { data: { neptunCode } } });
  if ((init.method ?? "GET") === "POST") { posts.push({ path, body: JSON.parse(init.body) }); return reply(signupResponse); }
  gets.push(p);
  return reply(listResponse);
};

const m = await import("../" + ENTRY);
await m.storage.initialize();
await m.user.ensureUser();

const exam = (over = {}) => ({
  examId: "e1", courseId: "c1", courseExamId: "ce1", courseCode: "EHU03GT", examType: "Jelentkeztető",
  fromDate: "2026-12-14T14:00:00", toDate: "2026-12-14T16:00:00", strength: 0, maxStrength: null,
  waitingStrength: 0, examTutors: "Karakas Alexandra", examSignin: false, examSignInId: null, ...over,
});
const subject = (over = {}) => ({ subjectId: "s1", subjectCode: "BMEGT41A301", subjectName: "Kutatásmódszertan", examList: [exam()], ...over });

console.log("A) a szerver listája lapos vizsgalistává válik, a tárgy adataival");
const flat = m.flattenExams([
  subject({ examList: [exam(), exam({ examId: "e2", fromDate: "2027-01-11T10:00:00" })] }),
  subject({ subjectId: "s2", subjectCode: "BMETE90AX00", subjectName: "Analízis", examList: [exam({ examId: "e3", courseId: "c9", courseCode: "A0" })] }),
]);
check("három vizsga", flat.length, 3);
check("viszi a tárgy nevét", flat[0].subjectName, "Kutatásmódszertan");
check("és a kódját", flat[2].subjectCode, "BMETE90AX00");
check("a kulcs a vizsga és a kurzus", flat[1].key, "e2:c1");
check("üres vagy hiányzó listára üres", m.flattenExams(null).length + m.flattenExams([{ subjectId: "x" }]).length, 0);

console.log("\nB) a terv hallgatónként tárolódik");
events.length = 0;
m.addToPlan(flat[0]);
check("bekerült", Object.keys(m.getPlan()), ["e1:c1"]);
check("isPlanned", m.isPlanned("e1", "c1"), true);
check("szólt a változásról", events.includes("npu:exam-plan-changed"), true);
check("megjegyzi, amit a kártya mutat", [m.getPlan()["e1:c1"].subjectName, m.getPlan()["e1:c1"].courseCode, m.getPlan()["e1:c1"].fromDate], ["Kutatásmódszertan", "EHU03GT", "2026-12-14T14:00:00"]);
m.addToPlan(flat[1]);
m.removeFromPlan("e1:c1");
check("kivehető", Object.keys(m.getPlan()), ["e2:c1"]);
// másik hallgató lép be ugyanazon a gépen
neptunCode = "XYZ789";
sessionStorage.setItem("access_token", jwt("s2"));
check("amíg nem tudjuk, ki van belépve, nincs terv", Object.keys(m.getPlan()).length, 0);
m.addToPlan(flat[2]);
check("és ilyenkor nem is írunk", Object.keys(m.getPlan()).length, 0);
await m.user.ensureUser();
check("a másik hallgató terve üres", Object.keys(m.getPlan()).length, 0);
neptunCode = "ABC123";
sessionStorage.setItem("access_token", jwt("s3"));
await m.user.ensureUser();
check("az elsőé megmaradt", Object.keys(m.getPlan()), ["e2:c1"]);

console.log("\nC) a lejárt vizsga magától kikerül");
m.addToPlan(flat[0]); // dec 14. 14:00
check("a kezdés előtt marad", (m.prunePast(new Date("2026-12-14T13:59:00")), Object.keys(m.getPlan()).sort()), ["e1:c1", "e2:c1"]);
check("a kezdés után kikerül", (m.prunePast(new Date("2026-12-14T14:01:00")), Object.keys(m.getPlan())), ["e2:c1"]);
m.removeFromPlan("e2:c1");

console.log("\nD) a Neptun sora csak egyértelműen köthető vizsgához");
const row = (over = {}) => ({ subjectCode: "BMEGT41A301", subjectName: "Kutatásmódszertan", dateText: "2026. december 14. 14:00", courseCode: "EHU03GT", ...over });
check("a sor megtalálja a vizsgáját", m.matchExam(row(), flat)?.key, "e1:c1");
check("a tárgy másik időpontja a másik vizsga", m.matchExam(row({ dateText: "2027. január 11. 10:00" }), flat)?.key, "e2:c1");
check("angol felületen is", m.matchExam(row({ dateText: "14 December 2026 14:00" }), flat)?.key, "e1:c1");
check("számos dátummal is", m.matchExam(row({ dateText: "2026. 12. 14. 14:00" }), flat)?.key, "e1:c1");
check("kisbetűs tárgykóddal és szóközökkel is", m.matchExam(row({ subjectCode: " bmegt41a301 ", courseCode: "EHU03GT " }), flat)?.key, "e1:c1");
check("más tárgy sora nem talál ide", m.matchExam(row({ subjectCode: "BMEXX00", subjectName: "Más" }), flat), null);
check("más időpont → nincs találat", m.matchExam(row({ dateText: "2026. december 15. 14:00" }), flat), null);
check("más óra → nincs találat", m.matchExam(row({ dateText: "2026. december 14. 16:00" }), flat), null);
check("más kurzus → nincs találat", m.matchExam(row({ courseCode: "EHU04GT" }), flat), null);
const twins = m.flattenExams([subject({ examList: [exam(), exam({ examId: "e7" })] })]);
check("két azonosnak látszó vizsga → inkább semmi", m.matchExam(row(), twins), null);
const months = m.flattenExams([subject({ examList: [exam({ fromDate: "2026-12-14T14:00:00" }), exam({ examId: "e8", fromDate: "2027-01-14T14:00:00" })] })]);
check("azonos nap és óra, más hónap: a hónap dönt", m.matchExam(row({ dateText: "2027. január 14. 14:00" }), months)?.key, "e8:c1");
check("tárgykód nélkül a név is elég", m.matchExam(row({ subjectCode: "" }), flat)?.key, "e1:c1");

console.log("\nE) a vizsga állapota");
check("szabad", m.examState(exam()), "open");
check("limit alatt szabad", m.examState(exam({ strength: 9, maxStrength: 10 })), "open");
check("betelt", m.examState(exam({ strength: 10, maxStrength: 10 })), "full");
check("felvett", m.examState(exam({ examSignin: true, examSignInId: "x" })), "registered");
check("felvett akkor is, ha csak az azonosító jön", m.examState(exam({ examSignInId: "x" })), "registered");
check("leírás limit nélkül", m.describeExam(flat[0]), "EHU03GT · Karakas Alexandra · 0 fő");
check("leírás limittel, betelve", m.describeExam({ ...flat[0], strength: 10, maxStrength: 10, waitingStrength: 2 }), "EHU03GT · Karakas Alexandra · 10/10 fő · BETELT · 2 várólistán");

console.log("\nF) a jelentkezés azt küldi, amit az app");
posts.length = 0;
const ok = await m.signUp(flat[0]);
check("egy kérés ment", posts.length, 1);
check("a jó végpontra", posts[0].path, "ExamRegistration/SignUpForExam");
check("a vizsga és a kurzus azonosítójával, mással nem", posts[0].body, { examId: "e1", courseId: "c1" });
check("siker", ok.isWaiting, false);
signupResponse = { status: 200, body: { data: null, notification: [] } };
check("üres válasz is siker", (await m.signUp(flat[0])).isWaiting, false);
signupResponse = { status: 200, raw: "" };
let emptyOk = null;
try { emptyOk = await m.signUp(flat[0]); } catch (error) { emptyOk = `HIBA: ${error.message}`; }
check("törzs nélküli 200 is siker, nem hiba", emptyOk, { isWaiting: false });
signupResponse = { status: 200, body: { data: { isWaiting: true }, notification: [] } };
check("várólista jelezve", (await m.signUp(flat[0])).isWaiting, true);

console.log("\nG) az elutasítás szövege eljut a diákhoz (500 + notification.description)");
signupResponse = { status: 500, body: { data: null, notification: [{ type: 3, title: null, description: "A vizsgajelentkezés nem engedélyezett. Nincs vizsgajelentkezési időszak!" }] } };
let caught = null;
try { await m.signUp(flat[0]); } catch (error) { caught = error; }
check("hibát dob", caught instanceof m.core.ApiError, true);
check("a státusz megvan", caught?.status, 500);
check("a szöveg a szerveré", caught?.message, "A vizsgajelentkezés nem engedélyezett. Nincs vizsgajelentkezési időszak!");

console.log("\nH) a lista lekérése úgy megy, ahogy az app kéri");
gets.length = 0;
listResponse = { status: 200, body: { data: [subject()], notification: [] } };
const fetched = await m.fetchExams();
check("a vizsgalista végpontja, minden sorral", gets[0], "ExamRegistration/GetExamsList?sortAndPage.firstRow=0&sortAndPage.lastRow=9999");
check("laposítva jön vissza", fetched.map(e => e.key), ["e1:c1"]);

const failed = results.filter(r => !r).length;
console.log(failed === 0 ? `MIND A(Z) ${results.length} RENDBEN` : `${failed} BUKOTT`);
process.exit(failed ? 1 : 0);
