// Elindul-e a szkript minden magyar egyetem Neptunján, és jól ismeri-e fel az
// app gyökerét? A lista élő méréssel készült (2026-08-30), 22 intézmény.
import { readFileSync } from "node:fs";
const [, , USERSCRIPT, BASE] = process.argv;
const results = []; const check = (label, actual, expected) => { const pass = actual === expected; results.push(pass); if (!pass) console.log(`  ✗ FAIL  ${label}  (kapott: ${actual}, várt: ${expected})`); return pass; };
const UNIS = [["BME","https://neptun.bme.hu","/hallgatoi"],["Edutus","https://neptun.edutus.hu","/hallgato"],["GDF","https://neptun.gdf.hu","/hallgato"],["Kodolányi","https://neptun.kodolanyi.hu","/Hallgato_NG"],["KRE","https://neptun.kre.hu","/hallgato"],["LFZE","https://neptun.lfze.hu","/hallgato"],["Metropolitan","https://neptunweb1.metropolitan.hu","/hallgato"],["MOME","https://host.sdakft.hu","/momehw"],["BHF","https://host.sdakft.hu","/bhfhw"],["Nyíregyháza","https://neptunweb.nye.hu","/hallgato"],["SZE","https://neptun-hweb.sze.hu","/hallgato_ng"],["SZTE","https://neptun.szte.hu","/hallgato"],["TF","https://neptun.tf.hu","/hallgato"],["Eszterházy","https://neptun.uni-eszterhazy.hu","/hallgato"],["MATE","https://hallgato.uni-mate.hu","/hallgato_ng"],["Miskolc","https://neptunweb1.uni-miskolc.hu","/hallgato_ng"],["Óbudai","https://neptun.uni-obuda.hu","/ujhallgato"],["Pannon","https://neptun.uni-pannon.hu","/hallgato"],["Debrecen","https://www-h-ng.neptun.unideb.hu","/hallgato_ng"],["PPKE","https://neptun3.ppke.hu","/hallgato2_uj"],["Semmelweis","https://neptunweb.semmelweis.hu","/hallgato"],["NKE","https://neptunweb.uni-nke.hu","/hallgato_ng"]];
const NOT = [["hírportál","https://index.hu/belfold/2026/"],["projekt weboldal","https://neptun-powerup.com/visszajelzes"],["github","https://github.com/rozsadomb/neptun-powerup"],["webshop","https://arukereso.hu/mobiltelefon/"]];
const header = readFileSync(USERSCRIPT, "utf8").split("==/UserScript==")[0];
const toRe = p => new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
const inc = [...header.matchAll(/^\/\/ @(match|include)\s+(\S+)/gm)].map(m => toRe(m[2]));
const exc = [...header.matchAll(/^\/\/ @exclude\s+(\S+)/gm)].map(m => toRe(m[1]));
const fires = u => inc.some(r => r.test(u)) && !exc.some(r => r.test(u));
let ok = 0; for (const [n, o, r] of UNIS) if (check(`${n} elindul`, [`${o}${r}/login`, `${o}${r}/subjects/registration`].every(fires), true)) ok++;
console.log(`  ✓ ${ok}/${UNIS.length} intézményen elindul`);
let okNeg = 0; for (const [n, u] of NOT) if (check(`${n}: nem indul`, fires(u), false)) okNeg++;
console.log(`  ✓ ${okNeg}/${NOT.length} nem-Neptun oldalon helyesen nem indul`);
async function load({ origin, pathname, baseHref }, tag) {
  globalThis.location = { pathname, origin, host: new URL(origin).host };
  globalThis.document = { title: "Neptun Web", querySelector: s => (s === "base" ? (baseHref ? { getAttribute: () => baseHref } : null) : s === "app-root" ? {} : null) };
  return import(`../${BASE}?v=${tag}`);
}
let ok2 = 0;
for (const [i, [n, o, r]] of UNIS.entries()) { const m = await load({ origin: o, pathname: `${r}/subjects/registration`, baseHref: `${r}/` }, `u${i}`);
  if (check(`${n} APP_BASE`, m.APP_BASE, r) && check(`${n} API`, m.API_BASE, `${r}/api/`) && check(`${n} appPath`, m.appPath(`${r}/subjects/registration`), "/subjects/registration") && check(`${n} appUrl`, m.appUrl("/exams"), `${r}/exams`) && check(`${n} isNeptunApp`, m.isNeptunApp(), true)) ok2++; }
console.log(`  ✓ ${ok2}/${UNIS.length} intézményen helyes az útvonalkezelés`);
let m = await load({ origin: "https://neptun.pelda.hu", pathname: "/hallgato_ng/exams", baseHref: null }, "nobase"); check("<base> nélkül", m.APP_BASE, "/hallgato_ng");
m = await load({ origin: "https://neptun.pelda.hu", pathname: "/login", baseHref: "/" }, "root"); check("gyökérbe telepítve", m.APP_BASE, "");
globalThis.document = { title: "Index", querySelector: () => null }; globalThis.location = { pathname: "/x", origin: "https://index.hu", host: "index.hu" };
m = await import(`../${BASE}?v=notneptun`); check("nem Neptun oldalt elutasít", m.isNeptunApp(), false);
const failed = results.filter(r => !r).length; console.log(failed === 0 ? `MIND A(Z) ${results.length} RENDBEN` : `${failed} BUKOTT`); process.exit(failed ? 1 : 0);
