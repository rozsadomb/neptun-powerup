// A diagnosztikai napló kivonata a lényeget őrzi meg, nem a zajt. Az NJE-napló
// (2026-09-09) 5 órán át rejtett fülön futott: percenként egy "fojtott tick"
// sor és 3 percenként egy "rejtett fül" sor 266 sort szorított ki a kivonat
// közepéből. Egy 401 után csak ilyen sorok jönnek, így 5 óra után maga a 401
// esett volna ki. Ezért: ha a napló nem fér be az űrlapba, először a zaj-sorok
// esnek ki, aztán a rutin sorok (sikeres frissítés, kérés), a legrégebbiektől,
// az első 40 sor (a belépés) érintetlen; a lényeges sorok — 401, hálózati hiba,
// fül-láthatóság, döntések — csak akkor csonkulnak, ha önmagukban sem férnek be.
// A memóriakorlát ugyanígy a zajt engedi el először.
const DIAG = process.argv[2];
const results = [];
const check = (label, actual, expected) => { const pass = actual === expected; results.push(pass); console.log(`  ${pass ? "✓" : "✗ FAIL"}  ${label}${pass ? "" : `  (kapott: ${JSON.stringify(actual)}, várt: ${JSON.stringify(expected)})`}`); };
globalThis.location = { pathname: "/hallgato/dashboard", origin: "https://neptun.nje.hu", host: "neptun.nje.hu" };
globalThis.document = { title: "Neptun Web", querySelector: s => (s === "base" ? { getAttribute: () => "/hallgato/" } : null) };
Object.defineProperty(globalThis, "navigator", { value: { userAgent: "test" }, configurable: true, writable: true });

const MIN = 60_000;
const MAX_DUMP = 28_000;
const HEAD = 40;
const realNow = Date.now;
const realLog = console.log;
let clock = new Date(2026, 8, 9, 11, 54, 29).getTime(); // 2026-09-09 11:54:29 helyi idő
Date.now = () => clock;
// Minden bejegyzés a konzolra is megy; ezer sor nem kell a teszt kimenetébe.
const quiet = fn => { console.log = () => {}; try { fn(); } finally { console.log = realLog; } };
let instance = 0;
const fresh = async () => import(`../${DIAG}?v=${++instance}`);
const bodyLines = dump => { const lines = dump.split("\n"); return lines.slice(lines.findIndex(l => l.includes("kidobásvédelem indul"))); };
const TICK = "tick 1 p 00 mp késéssel futott — háttérben fojtva (fül: hidden)";
const HIDDEN = "rejtett fül: az app nem kérhető meg, a frissítés közvetlenül megy";
const APP_CALLS = ["General/EnvironmentData", "Translations", "UserInfo", "Permissions", "MyTrainings", "ExtendedMenuPermissions", "Profiles/Favourites", "General/GetHWebErrorReportingEmailSystemParameter", "General/GetActiveDomainPasswordExpiration", "Dashboard/GetNumberOfTasksByType", "Message/GetUnreadedMessagesCount", "General/GetSubjectInformationInSchedulePlanner"];

function login(m) {
  m.diag("kidobásvédelem indul — token kiadva 11:54:12, lejár 11:59:12; a munkamenet (sessionStorage szerint) 12:24:27-kor jár le; frissítés az appon át: BE, tevékenység-jelzés: KI");
  m.diag("npu → UserInfo 200", "routine");
  APP_CALLS.forEach(p => m.diag(`app → ${p} 200`, "routine"));
  clock += 5_000; m.diag("fül láthatósága: visible");
  clock += 36_000; m.diag("fül láthatósága: hidden");
}
// Egy perc rejtett fülön: fojtott tick, minden harmadikban frissítés.
function hiddenMinute(m, i) {
  clock += MIN;
  m.diag(TICK, "noise");
  if (i % 3 === 0) {
    m.diag(HIDDEN, "noise");
    m.diag(`frissítés indul (a token ${m.hhmmss(clock + 2 * MIN)}-kor jár le)`, "routine");
    m.diag(`frissítés OK — új token ${m.hhmmss(clock + 5 * MIN)}-kor jár le; a szerver 30 perces munkamenetet jelez (→ ${m.hhmmss(clock + 30 * MIN)}) [szerveróra eltérése -2 mp]`, "routine");
  }
}

console.log("A) ami befér, változatlanul megy ki");
{
  const m = await fresh();
  quiet(() => { login(m); for (let i = 1; i <= 30; i++) hiddenMinute(m, i); });
  const body = bodyLines(m.diagDump());
  check("minden sor benne van", body.length, 16 + 30 + 10 * 3);
  check("nincs kihagyás-jelzés", body.some(l => l.includes("kihagyva")), false);
  check("időbélyeg + két szóköz + szöveg", /^\d{1,2}:\d{2}:\d{2}  tick 1 p 00 mp/.test(body[16]), true);
}

console.log("B) az NJE-alak: 5 óra rejtett fül, majd 401, majd 8 óra csak zaj — a 401 megmarad");
{
  const m = await fresh();
  let deadAt = 0;
  quiet(() => {
    login(m);
    for (let i = 1; i <= 300; i++) hiddenMinute(m, i);
    clock += MIN; deadAt = clock;
    m.diag("frissítés ELUTASÍTVA: HTTP 401 — a szerver szerint a munkamenet lejárt, miközben a jelvény szerint még 22 p 10 mp volt hátra; a belépés óta 5 ó 1 p");
    for (let i = 1; i <= 480; i++) { clock += MIN; m.diag(TICK, "noise"); }
    clock += 5_000; m.diag("fül láthatósága: visible");
  });
  const dump = m.diagDump();
  const body = bodyLines(dump);
  check(`befér az űrlapba (${dump.length} ≤ ${MAX_DUMP})`, dump.length <= MAX_DUMP, true);
  check("a 401-es sor megvan", dump.includes("frissítés ELUTASÍTVA: HTTP 401"), true);
  check("a 401 időbélyege a sajátja", body.some(l => l.startsWith(`${m.hhmmss(deadAt)}  frissítés ELUTASÍTVA`)), true);
  check("az utolsó sor a fül újra-látszása", body[body.length - 1].endsWith("fül láthatósága: visible"), true);
  check("mind a 100 frissítés OK-sor megvan", (dump.match(/frissítés OK — új token/g) ?? []).length, 100);
  check("mind a 100 frissítés-indul sor megvan", (dump.match(/frissítés indul \(a token/g) ?? []).length, 100);
  check("a belépés első 40 sora érintetlen", body[0].includes("kidobásvédelem indul") && body[15].endsWith("fül láthatósága: hidden") && body[16].endsWith(TICK) && body[HEAD - 1].endsWith("[szerveróra eltérése -2 mp]"), true);
  const summaries = body.filter(l => /… \d+ sor kihagyva .* között/.test(l));
  check("pontosan egy összegző sor áll a kihagyottak helyén", summaries.length, 1);
  const summary = summaries[0] ?? "";
  check("az összegző pontosan a fej után áll (a 41. sor helyén)", body.indexOf(summary), HEAD);
  check("az összegző elmondja, miféle sorok estek ki (fojtott tick)", /\d+× „tick N p N mp késéssel futott — háttérben fojtva \(fül: hidden\)”/.test(summary), true);
  check("…és hogy rejtett-fül sorok is", /\d+× „rejtett fül: az app nem kérhető meg/.test(summary), true);
  check("a kihagyottak száma a zaj-sorokból jön (több mint 700)", Number((summary.match(/… (\d+) sor kihagyva/) ?? [])[1]) > 700, true);
  check("nem esett ki rutin sor: nincs második összegző", summaries.length, 1);
  check("a legfrissebb zaj-sorok megmaradtak a 401 után", body.slice(-3, -1).every(l => l.endsWith(TICK)), true);
  check("nincs régi fej/farok jelzés", /\(\d+ sor kihagyva, hogy beférjen/.test(dump), false);
}

console.log("C) látható fül, 10 óra helyfigyelő-poll: a rutin sorok legrégebbije esik ki, a lényeges marad");
{
  const m = await fresh();
  quiet(() => {
    login(m);
    for (let i = 1; i <= 1200; i++) {
      clock += 30_000;
      m.diag("npu → SubjectApplication/GetScheduledCourses 200", "routine");
      if (i % 6 === 0) {
        m.diag(`frissítés indul (a token ${m.hhmmss(clock + 2 * MIN)}-kor jár le)`, "routine");
        m.diag(`frissítés OK — új token ${m.hhmmss(clock + 5 * MIN)}-kor jár le; a szerver 30 perces munkamenetet jelez (→ ${m.hhmmss(clock + 30 * MIN)}) [szerveróra eltérése -1 mp]`, "routine");
      }
      if (i === 700) m.diag("frissítés kihagyva: 1 saját kérés 10 mp után is repül — a következő ciklus újrapróbálja");
    }
    clock += 1_000; m.diag("figyelés leállítva: BMEVIAUA218/1 — a kurzus már nem létezik (HTTP 410)");
  });
  const dump = m.diagDump();
  const body = bodyLines(dump);
  check(`befér az űrlapba (${dump.length} ≤ ${MAX_DUMP})`, dump.length <= MAX_DUMP, true);
  check("a lényeges sor a közepéről megvan", dump.includes("frissítés kihagyva: 1 saját kérés"), true);
  check("a lényeges sor a végéről megvan", body[body.length - 1].endsWith("(HTTP 410)"), true);
  check("a legfrissebb rutin sorok megmaradtak", body[body.length - 2].includes("frissítés OK — új token") && body[body.length - 4].endsWith("npu → SubjectApplication/GetScheduledCourses 200"), true);
  check("a fej első sora a belépés", body[0].includes("kidobásvédelem indul"), true);
  check("a fej 40. sora is eredeti (rutin frissítés)", body[HEAD - 1].endsWith("[szerveróra eltérése -1 mp]"), true);
  const summaries = body.filter(l => /… \d+ sor kihagyva .* között/.test(l));
  check("egy összegző sor", summaries.length, 1);
  check("az összegző a fej után áll", body.indexOf(summaries[0]), HEAD);
  check("az összegző a poll-sorokat nevezi meg", /\d+× „npu → SubjectApplication\/GetScheduledCourses 200”/.test(summaries[0] ?? ""), true);
  check("az összegző a frissítéseket is", /\d+× „frissítés OK — új token ⋯-kor jár le; a szerver 30 perces/.test(summaries[0] ?? ""), true);
}

console.log("D) csupa lényeges sor, ami nem fér be: marad a régi fej + farok vágás");
{
  const m = await fresh();
  quiet(() => { login(m); for (let i = 1; i <= 600; i++) { clock += MIN; m.diag(`frissítés kihagyva: nemrég frissített más (az app vagy egy másik fül) — ${i}. eset, a részletek a következő sorban`); } });
  const dump = m.diagDump();
  const body = bodyLines(dump);
  check(`befér az űrlapba (${dump.length} ≤ ${MAX_DUMP})`, dump.length <= MAX_DUMP, true);
  check("fej/farok jelzés", body.some(l => /^… \(\d+ sor kihagyva, hogy beférjen az űrlapba\) …$/.test(l)), true);
  check("az első 40 sor megvan", body[HEAD - 1].includes("24. eset"), true);
  check("az utolsó sor megvan", body[body.length - 1].includes("600. eset"), true);
}

console.log("E) memóriakorlát: 1500 felett a zaj megy először, a rutin utána, a fej sosem");
{
  const m = await fresh();
  quiet(() => {
    login(m); // 16 lényeges/rutin sor
    for (let i = 1; i <= 24; i++) m.diag(`fej-töltelék ${i}`); // a fej 40 sora tele
    for (let i = 1; i <= 1400; i++) { clock += MIN; m.diag(TICK, "noise"); }
    for (let i = 1; i <= 100; i++) { clock += MIN; m.diag(`npu → Poll/${i} 200`, "routine"); }
    for (let i = 1; i <= 100; i++) { clock += MIN; m.diag(`döntés ${i}`); }
  });
  let dump = m.diagDump();
  check("a fejléc jelzi, hány sor esett ki a memóriából (140)", /a memóriakorlát miatt 140 régi sor már nincs meg/.test(dump), true);
  check("mind a 100 rutin sor megvan", (dump.match(/npu → Poll\/\d+ 200/g) ?? []).length, 100);
  check("mind a 100 döntés megvan", (dump.match(/döntés \d+$/gm) ?? []).length, 100);
  check("a fej első sora megvan", dump.includes("kidobásvédelem indul"), true);
  quiet(() => { for (let i = 101; i <= 1500; i++) { clock += MIN; m.diag(`döntés ${i}`); } }); // 1400 új lényeges → kiszorít 1260 zajt + 100 rutint + 40 lényegest
  dump = m.diagDump();
  check("a zaj elfogyott, a rutin is: a fejléc 1540-et mond", /a memóriakorlát miatt 1540 régi sor már nincs meg/.test(dump), true);
  check("a fej 24. tölteléke még megvan", dump.includes("fej-töltelék 24"), true);
  check("a legrégebbi lényeges esett ki utoljára: az 1. döntés nincs", /döntés 1$/m.test(dump), false);
  check("a legfrissebb döntés megvan", /döntés 1500$/m.test(dump), true);
}

Date.now = realNow;
const failed = results.filter(r => !r).length;
console.log(failed === 0 ? `MIND A(Z) ${results.length} RENDBEN` : `${failed} BUKOTT`);
process.exit(failed ? 1 : 0);
