// A weboldal bemutatói ugyanazt a verziót és kinézetet mutatják, mint a
// kiadott szkript: a szám egy helyről (package.json) sül bele mindenbe, a
// HTML-ben pedig nem lehet kézzel beírt verziószám vagy a szkript CSS-ének
// kézi másolata. A push előtti hook ezt futtatja, hogy elavult bemutató ne
// mehessen ki.
import { existsSync, readFileSync } from "node:fs";

const results = [];
const check = (label, actual, expected) => { const pass = actual === expected; results.push(pass); console.log(`  ${pass ? "✓" : "✗ FAIL"}  ${label}${pass ? "" : `  (kapott: ${JSON.stringify(actual)}, várt: ${JSON.stringify(expected)})`}`); };
const read = file => readFileSync(file, "utf8");

const version = JSON.parse(read("package.json")).version;
console.log(`A) a generált fájlok a package.json verzióját hordozzák (${version})`);
check("site/npu.user.js létezik (npm run build:site)", existsSync("site/npu.user.js"), true);
check("site/demo.js létezik (npm run build:site)", existsSync("site/demo.js"), true);
const header = (read("site/npu.user.js").match(/@version\s+(\S+)/) ?? [])[1];
check("a szkript fejlécében ugyanaz a verzió", header, version);
const demo = read("site/demo.js");
check("a demo.js-be ugyanaz a verzió sült", demo.includes(`"${version}"`), true);
check("a demo.js fejléce is ezt mondja", demo.startsWith(`// Generált fájl (npm run build:site), ne szerkeszd: forrás src/site/demo.ts — v${version}`), true);
const isBeta = /export const IS_BETA = true;/.test(read("src/core/env.ts"));
check(`a „béta” címke a kapcsolót követi (IS_BETA=${isBeta})`, demo.includes('class="npu-beta"'), isBeta);

console.log("\nB) a HTML-ben nincs kézzel beírt verzió és nincs kézzel másolt panel");
const html = read("site/index.html");
check("nincs „NPU x.y.z” a HTML-ben", /NPU\s*\d+\.\d+\.\d+/.test(html), false);
check("nincs data-version számmal", /data-version>\s*\d/.test(html), false);
check("a jelvény-bemutatók helyőrzők (data-npu-badge)", (html.match(/data-npu-badge/g) ?? []).length >= 3, true);
check("a panel-bemutatók helyőrzők (data-npu-panel)", (html.match(/data-npu-panel=/g) ?? []).length, 2);
check("nincs kézzel írt panel-fejléc", html.includes("npu-panel__head"), false);
check("a demo.js az app.js ELŐTT töltődik", html.indexOf('src="/demo.js"') < html.indexOf('src="/app.js"') && html.includes('src="/demo.js"'), true);

console.log("\nC) a weboldal CSS-e nem másolja a szkript stílusait");
const css = read("site/style.css");
check("nincs .npu-panel__header/head szabály a site CSS-ben", /\.npu-panel__head(er)?\s*\{/.test(css), false);
check("nincs teljes .npu-badge háttér-definíció a site CSS-ben", /\.npu-badge\s*\{[^}]*background:\s*#1b2a5e/.test(css), false);
check("nincs .npu-item alapstílus (border) a site CSS-ben", /\.npu-item\s*\{[^}]*border:/.test(css), false);

console.log("\nD) a jelvény valódi renderelője adja a bemutató horgait");
const badge = read("src/core/badge.ts");
["npu-time", "npu-keep", "npu-watch", "npu-beta"].forEach(hook => check(`renderBadgeHtml → .${hook}`, badge.includes(hook), true));
const app = read("site/app.js");
check("app.js a .npu-time-ot lépteti", app.includes('".npu-badge .npu-time"'), true);
check("app.js a .npu-keep-et villantja", app.includes('".npu-badge .npu-keep"'), true);
check("app.js nem olvas version.json-t", app.includes("version.json"), false);

const failed = results.filter(r => !r).length;
console.log(failed === 0 ? `MIND A(Z) ${results.length} RENDBEN` : `${failed} BUKOTT`);
process.exit(failed ? 1 : 0);
