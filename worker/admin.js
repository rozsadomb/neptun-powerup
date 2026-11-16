// A karbantartó privát felülete a bejelentésekhez.
//
//   GET    /admin                     — az oldal (HTML; adatot nem tartalmaz, azt tokennel kéri le)
//   GET    /api/admin/reports         — lista, szöveg nélkül (Authorization: Bearer <ADMIN_TOKEN>)
//   GET    /api/admin/reports/<szám>  — egy bejelentés teljes egészében (szöveggel)
//   DELETE /api/admin/reports/<szám>  — egy bejelentés törlése a privát tárolóból
//   GET    /api/admin/installs?days=30 — a szkript letöltéseinek összesítése (installs.js; days: 1, 3, 7, 30 vagy 90)
//
// Az ADMIN_TOKEN Cloudflare Secret (DEPLOY.md 2b). Hosszú, véletlen érték legyen:
// nincs külön korlátozás a próbálkozásokra, a token hossza a védelem.

import { json } from "./http.js";
import { listReports, getReport, deleteReport, feedbackTtlDays } from "./reports.js";
import { handleInstallsApi } from "./installs.js";

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

// Állandó idejű összehasonlítás: a két token SHA-256-át vetjük össze, így sem a
// hossz, sem az első eltérő karakter helye nem szivárog ki az időzítésből.
async function tokenMatches(given, expected) {
  if (typeof given !== "string" || given === "") return false;
  const [a, b] = await Promise.all([sha256(given), sha256(String(expected))]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function bearer(request) {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

export async function handleAdminApi(request, env, url) {
  if (!env.ADMIN_TOKEN) {
    return json(503, { error: "Nincs beállítva az ADMIN_TOKEN secret (lásd DEPLOY.md 2b)." });
  }
  if (!(await tokenMatches(bearer(request), env.ADMIN_TOKEN))) {
    return json(401, { error: "Hibás vagy hiányzó token." });
  }
  // A letöltés-statisztikának nem kell a KV: a bejelentés-tároló nélkül is megy.
  if (url.pathname === "/api/admin/installs") {
    return handleInstallsApi(request, env, url);
  }
  if (!env.FEEDBACK) {
    return json(503, { error: "Nincs bekötve a FEEDBACK KV-tároló (lásd DEPLOY.md 2b)." });
  }

  const match = url.pathname.match(/^\/api\/admin\/reports(?:\/(\d{1,9}))?$/);
  if (!match) return json(404, { error: "Ismeretlen végpont." });
  const issueNumber = match[1] ? Number(match[1]) : null;

  if (request.method === "GET" && issueNumber === null) {
    return json(200, { ttlDays: feedbackTtlDays(env), items: await listReports(env) });
  }
  if (request.method === "GET") {
    const report = await getReport(env, issueNumber);
    return report ? json(200, report) : json(404, { error: "Nincs ilyen bejelentés a tárolóban." });
  }
  if (request.method === "DELETE" && issueNumber !== null) {
    await deleteReport(env, issueNumber);
    return json(200, { ok: true });
  }
  return json(405, { error: "Nem engedélyezett metódus." }, { Allow: issueNumber === null ? "GET" : "GET, DELETE" });
}

export function adminPage() {
  return new Response(ADMIN_HTML, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });
}

// Az oldal a weboldal stíluslapját használja (tokenek, betűk, gombok), a saját
// részei alább. Adatot nem tartalmaz: a listát a böngésző tokennel kéri le.
const ADMIN_HTML = `<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Admin, Neptun PowerUp! NG</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="/style.css">
<style>
  /* Az oldal a weboldal lapjára ül (krém lap, sötétben éjszakai lap), és csak a lap
     szerepeit használja: --sheet, --ink, --ink-display, --ink-soft, --ink-2, --rule,
     --field. Minden tagolás vonal: 2px a dobozok és a fejlécek, 1px a sorok között. */
  .admin { --row-line: color-mix(in srgb, var(--ink) 34%, transparent); max-width: 1080px; margin: 0 auto; padding: clamp(32px, 6vw, 72px) clamp(20px, 4vw, 40px) 80px; }
  .admin h1 { font-size: clamp(2.4rem, 1.4rem + 3vw, 3.6rem); }
  .admin > .hint { margin-top: 14px; max-width: 62ch; }
  .card { margin-top: 28px; border: var(--rule-w) solid var(--rule); }
  form.card { padding: 20px; }
  .card label { display: block; font-family: var(--display); font-weight: 750; font-stretch: 92%; font-size: .9rem; text-transform: uppercase; letter-spacing: .03em; margin-bottom: 8px; color: var(--ink-display); }
  .card input[type="password"], .card select { font: inherit; color: var(--ink); background: var(--sheet); border: var(--rule-w) solid var(--ink-display); border-radius: 0; }
  .card input[type="password"] { width: 100%; padding: 12px 14px; }
  .card select { padding: 6px 10px; cursor: pointer; }
  .card input:focus-visible, .card select:focus-visible { outline: 0; box-shadow: 4px 4px 0 var(--ink-2); }
  .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
  form.card > .row { margin-top: 16px; }
  .btn--sm { padding: .5rem .8rem; font-size: .8125rem; }
  /* A doboz feje: cím balra, vezérlők jobbra, alatta 2px-es vonal. */
  .card > .toolbar { justify-content: space-between; padding: 12px 20px; border-bottom: var(--rule-w) solid var(--rule); }
  .toolbar > strong { font-family: var(--display); font-weight: 750; font-stretch: 92%; font-size: 1.05rem; text-transform: uppercase; letter-spacing: .03em; color: var(--ink-display); }
  .toolbar label { margin: 0; font-size: .8rem; }
  .card > .hint { margin: 14px 20px; }
  .status { margin-top: 20px; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

  /* Számok: vonalazott tábla, a becslés a fordított mező. */
  .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--rule-w); background: var(--rule); border-bottom: var(--rule-w) solid var(--rule); }
  .stat { padding: 16px 20px 18px; background: var(--sheet); }
  .stat b { display: block; font-family: var(--display); font-size: 2.3rem; font-weight: 800; font-stretch: 80%; line-height: 1; font-variant-numeric: tabular-nums; color: var(--ink-display); }
  .stat span { display: block; margin-top: 8px; font-size: .8125rem; line-height: 1.35; color: var(--ink-soft); }
  .stat--hero { background: var(--ink-display); }
  .stat--hero b, .stat--hero span { color: var(--sheet); }

  /* Táblázat: tintás fejléc-vonal, minden sor alatt vonal. */
  .tablewrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: .9375rem; }
  th, td { text-align: left; vertical-align: top; padding: 11px 12px; border-bottom: 1px solid var(--row-line); }
  th:first-child, td:first-child { padding-left: 20px; }
  th:last-child, td:last-child { padding-right: 20px; }
  thead th { font-family: var(--display); font-size: .78rem; font-weight: 750; font-stretch: 92%; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-display); background: var(--field); border-bottom: var(--rule-w) solid var(--rule); white-space: nowrap; vertical-align: bottom; }
  tbody tr:last-child td { border-bottom: 0; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  /* A napi számok rácsa: oszlopvonal és váltakozó sor, hogy a szem ne csússzon el. */
  table.grid td { padding-top: 8px; padding-bottom: 8px; }
  table.grid td.num, table.grid th.num { border-left: 1px solid var(--row-line); }
  table.grid tbody tr:nth-child(even) td { background: var(--field); }
  table.grid td:first-child { font-weight: 600; }
  table.grid .sub { font-weight: 400; color: var(--ink-soft); }
  #dailyWrap { border-bottom: var(--rule-w) solid var(--rule); }

  td.issue { min-width: 240px; }
  td.issue a { font-weight: 700; }
  td .title { display: block; margin-top: 2px; color: var(--ink); }
  td .kind { display: inline-block; margin-top: 6px; font-family: var(--display); font-size: .68rem; font-weight: 750; font-stretch: 92%; text-transform: uppercase; letter-spacing: .05em; line-height: 1; padding: 3px 6px; border: 1px solid var(--ink-display); color: var(--ink-display); }
  td .kind--bug { background: var(--ink-display); color: var(--sheet); }
  td.contact { overflow-wrap: anywhere; min-width: 180px; }
  td.contact a { font-family: var(--mono); font-size: .875em; }
  td.when { white-space: nowrap; color: var(--ink-soft); font-size: .875rem; }
  td.acts { white-space: nowrap; text-align: right; }
  td.acts .row { gap: 8px; flex-wrap: nowrap; justify-content: flex-end; }
  tr.open td { border-bottom-color: transparent; }
  tr.text td { padding-top: 0; }
  tr.text p { margin: 0 0 8px; font-weight: 600; }
  tr.text pre { margin: 0; padding: 14px 16px; white-space: pre-wrap; word-break: break-word; font: inherit; font-size: .9375rem; line-height: 1.55; background: var(--field); border-left: 4px solid var(--ink-display); }

  /* Bontások: két hasáb a vonalazott rácson. */
  .breakdown { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--rule-w); background: var(--rule); border-bottom: var(--rule-w) solid var(--rule); }
  .breakdown > div { padding: 14px 20px 10px; background: var(--sheet); }
  .breakdown h3 { font-size: .78rem; font-weight: 750; font-stretch: 92%; text-transform: uppercase; letter-spacing: .04em; margin: 0 0 6px; padding-bottom: 8px; border-bottom: var(--rule-w) solid var(--rule); }
  .breakdown ul { list-style: none; margin: 0; padding: 0; font-size: .9375rem; }
  .breakdown li { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--row-line); }
  .breakdown li:last-child { border-bottom: 0; }
  .breakdown li span:last-child { font-weight: 600; font-variant-numeric: tabular-nums; }

  @media (max-width: 860px) {
    .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .breakdown { grid-template-columns: minmax(0, 1fr); }
    table.grid { font-size: .875rem; }
    table.grid th, table.grid td { padding-left: 10px; padding-right: 10px; }
    table.grid th:first-child, table.grid td:first-child { padding-left: 14px; white-space: nowrap; }
    table.grid th:last-child, table.grid td:last-child { padding-right: 14px; }
    table.grid thead th { white-space: normal; font-size: .68rem; letter-spacing: .02em; }
    table.grid .sub { display: block; font-size: .75rem; }
    /* A bejelentések sorai kártyává esnek szét; a napi rács táblázat marad. */
    table.stack thead { display: none; }
    table.stack, table.stack tbody, table.stack tr, table.stack td { display: block; }
    table.stack tr { padding: 12px 20px; border-bottom: 1px solid var(--row-line); }
    table.stack tr.open { border-bottom-color: transparent; }
    table.stack tr.text { padding-top: 0; }
    table.stack tr:last-child { border-bottom: 0; }
    table.stack td { border: 0; padding: 4px 0; }
    table.stack td.when, table.stack td.acts { white-space: normal; text-align: left; }
    table.stack td.acts .row { justify-content: flex-start; margin-top: 6px; }
    table.stack td[data-l]:not([data-l=""])::before { content: attr(data-l); display: block; font-family: var(--display); font-size: .68rem; font-weight: 750; font-stretch: 92%; text-transform: uppercase; letter-spacing: .05em; color: var(--ink-soft); }
  }
  @media (max-width: 480px) {
    .card > .toolbar { padding: 12px 14px; }
    .stat { padding: 14px; }
    .stat b { font-size: 1.9rem; }
  }
</style>
</head>
<body>
<main class="admin">
  <h1>Admin</h1>
  <p class="hint">A szkript letöltéseinek számai, és a visszajelzés-űrlapról érkezett bejelentések privát másolata a megadott email címekkel. A nyilvános GitHub-issue-ba csak a szöveg kerül; a bejelentések <span id="ttl">…</span> nap után maguktól törlődnek.</p>

  <form class="card" id="login" hidden>
    <label for="token">Admin token</label>
    <input type="password" id="token" autocomplete="current-password" required>
    <div class="row">
      <button class="btn btn--sm" type="submit">Belépés</button>
      <span class="hint">Az <code>ADMIN_TOKEN</code> nevű Cloudflare-secret értéke. Ez a böngésző megjegyzi.</span>
    </div>
  </form>

  <div id="status" class="form-status status" hidden></div>

  <section class="card" id="installs" hidden aria-live="polite">
    <div class="row toolbar">
      <strong>Telepítések</strong>
      <span class="row">
        <label class="hint" for="days">Időszak</label>
        <select id="days"><option value="1">24 óra</option><option value="3">3 nap</option><option value="7">7 nap</option><option value="30" selected>30 nap</option><option value="90">90 nap</option></select>
      </span>
    </div>
    <p class="hint" id="installsNote" hidden></p>
    <div class="stats" id="stats" hidden></div>
    <div class="tablewrap" id="dailyWrap" hidden>
      <table class="grid">
        <thead><tr><th>Nap</th><th class="num">Ellenőrzés</th><th class="num">Letöltés</th><th class="num">Telepítés-kattintás</th></tr></thead>
        <tbody id="dailyRows"></tbody>
      </table>
    </div>
    <div class="breakdown" id="breakdown" hidden></div>
    <p class="hint">A szkript letöltéseiből számolva, IP-cím és süti nélkül. <b>Ellenőrzés:</b> a userscript-kezelő (Tampermonkey, Violentmonkey) napi frissítés-ellenőrzése, naponta kb. egy minden telepítésről, ezért a tegnapi érték az aktív telepítések becslése. <b>Letöltés:</b> a teljes fájl (új telepítés, vagy frissítés kiadás után). <b>Telepítés-kattintás:</b> a telepítés gomb megnyitása. 2026-09-11 előtt az ellenőrzések a Letöltés oszlopban vannak: a számláló addig egy Range-fejlécet figyelt, amit a Tampermonkey nem küld.</p>
  </section>

  <section class="card" id="panel" hidden aria-live="polite">
    <div class="row toolbar">
      <strong id="count"></strong>
      <span class="row">
        <button class="btn btn--ghost btn--sm" type="button" id="refresh">Frissítés</button>
        <button class="btn btn--ghost btn--sm" type="button" id="logout">Kilépés</button>
      </span>
    </div>
    <div class="tablewrap">
      <table class="stack">
        <thead><tr><th>Bejelentés</th><th>Elérhetőség</th><th>Beérkezett</th><th>Törlődik</th><th><span class="sr">Műveletek</span></th></tr></thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
    <p class="hint" id="empty" hidden>Nincs tárolt bejelentés.</p>
  </section>
</main>
<script>
(function () {
  "use strict";
  var KEY = "npu-admin-token";
  var login = document.getElementById("login");
  var tokenInput = document.getElementById("token");
  var status = document.getElementById("status");
  var panel = document.getElementById("panel");
  var rows = document.getElementById("rows");
  var empty = document.getElementById("empty");
  var count = document.getElementById("count");

  function getToken() { try { return localStorage.getItem(KEY) || ""; } catch (e) { return ""; } }
  function setToken(t) { try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch (e) {} }
  function show(kind, text) { status.hidden = false; status.className = "form-status status " + kind; status.textContent = text; }
  function hideStatus() { status.hidden = true; }
  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }
  function fmt(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleString("hu-HU", { dateStyle: "medium", timeStyle: "short" });
  }
  function api(method, path) {
    return fetch(path, { method: method, headers: { Authorization: "Bearer " + getToken() } }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, data: d }; });
    });
  }
  function mailto(contact, title, issue) {
    var addr = contact.replace(/[#?&%]/g, function (c) { return encodeURIComponent(c); });
    return "mailto:" + addr + "?subject=" + encodeURIComponent("Re: " + (title || "#" + issue) + " (Neptun PowerUp!)");
  }

  function render(items, ttl) {
    document.getElementById("ttl").textContent = ttl;
    rows.textContent = "";
    empty.hidden = items.length > 0;
    count.textContent = items.length ? items.length + " bejelentés" : "Üres";
    items.forEach(function (it) {
      var tr = el("tr");
      var tdIssue = el("td", { "data-l": "Bejelentés", class: "issue" });
      tdIssue.appendChild(el("a", { href: it.url, target: "_blank", rel: "noopener" }, "#" + it.issue));
      if (it.title) tdIssue.appendChild(el("span", { class: "title" }, it.title));
      tdIssue.appendChild(el("span", { class: it.type === "idea" ? "kind kind--idea" : "kind kind--bug" }, it.type === "idea" ? "Ötlet" : "Hiba"));
      var tdContact = el("td", { "data-l": "Elérhetőség", class: "contact" });
      if (!it.contact) {
        tdContact.appendChild(el("span", { class: "hint" }, "nincs"));
      } else if (/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(it.contact)) {
        tdContact.appendChild(el("a", { href: mailto(it.contact, it.title, it.issue) }, it.contact));
      } else {
        tdContact.textContent = it.contact;
      }
      var tdIn = el("td", { "data-l": "Beérkezett", class: "when" }, fmt(it.createdAt));
      var tdOut = el("td", { "data-l": "Törlődik", class: "when" }, fmt(it.expiresAt));
      var tdActs = el("td", { "data-l": "", class: "acts" });
      var acts = el("span", { class: "row" });
      var open = el("button", { type: "button", class: "btn btn--ghost btn--sm", "aria-expanded": "false" }, "Szöveg");
      var textRow = null;
      open.addEventListener("click", function () {
        if (textRow) { textRow.remove(); textRow = null; tr.classList.remove("open"); open.setAttribute("aria-expanded", "false"); return; }
        open.disabled = true;
        api("GET", "/api/admin/reports/" + it.issue).then(function (r) {
          open.disabled = false;
          if (r.status !== 200) { show("err", r.data.error || "Nem sikerült betölteni."); return; }
          textRow = el("tr", { class: "text" });
          var td = el("td", { colspan: "5", "data-l": "" });
          if (r.data.university) {
            td.appendChild(el("p", null, "Egyetem: " + r.data.university));
          }
          td.appendChild(el("pre", null, r.data.body || ""));
          textRow.appendChild(td);
          tr.after(textRow);
          tr.classList.add("open");
          open.setAttribute("aria-expanded", "true");
        });
      });
      var del = el("button", { type: "button", class: "btn btn--ghost btn--sm" }, "Törlés");
      del.addEventListener("click", function () {
        if (!confirm("Törlöd a #" + it.issue + " bejelentés privát másolatát (az elérhetőséggel együtt)?")) return;
        del.disabled = true;
        api("DELETE", "/api/admin/reports/" + it.issue).then(function (r) {
          if (r.status === 200) load();
          else { del.disabled = false; show("err", r.data.error || "Nem sikerült törölni."); }
        });
      });
      acts.appendChild(open); acts.appendChild(del);
      tdActs.appendChild(acts);
      [tdIssue, tdContact, tdIn, tdOut, tdActs].forEach(function (td) { tr.appendChild(td); });
      rows.appendChild(tr);
    });
  }

  // ---- telepítések ----
  var installs = document.getElementById("installs");
  var installsNote = document.getElementById("installsNote");
  var stats = document.getElementById("stats");
  var dailyWrap = document.getElementById("dailyWrap");
  var dailyRows = document.getElementById("dailyRows");
  var breakdown = document.getElementById("breakdown");
  var daysSelect = document.getElementById("days");
  var nf = new Intl.NumberFormat("hu-HU");

  function stat(value, label, hero) {
    var d = el("div", { class: "stat" + (hero ? " stat--hero" : "") });
    d.appendChild(el("b", null, nf.format(value)));
    d.appendChild(el("span", null, label));
    return d;
  }
  function list(title, items) {
    var box = el("div");
    box.appendChild(el("h3", null, title));
    var ul = el("ul");
    if (!items.length) ul.appendChild(el("li", null, "nincs adat"));
    items.forEach(function (it) {
      var li = el("li");
      li.appendChild(el("span", null, it.name));
      li.appendChild(el("span", null, nf.format(it.n)));
      ul.appendChild(li);
    });
    box.appendChild(ul);
    return box;
  }
  // Az időszak szövege a számokhoz: az 1 nap a lekérdezésben gördülő 24 óra.
  function period(days) { return days === 1 ? "24 óra" : days + " nap"; }
  function renderInstalls(d) {
    installsNote.hidden = true;
    stats.textContent = "";
    // Az aktív telepítések becslése: naponta kb. egy háttérkérés telepítésenként.
    // Hosszabb időszaknál a tegnapi (teljes) nap a mérce; a 24 órás ablakban a
    // tegnap csak részben van benne, ott maga az ablak a teljes nap.
    if (d.days === 1) {
      stats.appendChild(stat(d.totals.check + d.totals.download, "aktív telepítés, becslés (az elmúlt 24 óra háttérkérései)", true));
    } else {
      stats.appendChild(stat(d.yesterday.check + d.yesterday.download, "aktív telepítés, becslés (tegnapi háttérkérések)", true));
    }
    stats.appendChild(stat(d.totals.install, "telepítés-kattintás, " + period(d.days)));
    stats.appendChild(stat(d.totals.download, "teljes letöltés, " + period(d.days)));
    stats.appendChild(stat(d.totals.check, "ellenőrzés, " + period(d.days)));
    stats.hidden = false;
    dailyRows.textContent = "";
    d.daily.slice().reverse().slice(0, 14).forEach(function (row) {
      var tr = el("tr");
      var dayNote = row.day === d.today.day ? "ma, csonka" : d.days === 1 && row.day === d.yesterday.day ? "tegnap, csak az ablakba eső rész" : "";
      var tdDay = el("td", { "data-l": "Nap" }, row.day);
      if (dayNote) tdDay.appendChild(el("span", { class: "sub" }, " (" + dayNote + ")"));
      tr.appendChild(tdDay);
      tr.appendChild(el("td", { class: "num", "data-l": "Ellenőrzés" }, nf.format(row.check)));
      tr.appendChild(el("td", { class: "num", "data-l": "Letöltés" }, nf.format(row.download)));
      tr.appendChild(el("td", { class: "num", "data-l": "Telepítés-kattintás" }, nf.format(row.install)));
      dailyRows.appendChild(tr);
    });
    dailyWrap.hidden = d.daily.length === 0;
    breakdown.textContent = "";
    breakdown.appendChild(list("Böngésző (háttérkérések)", d.browsers));
    breakdown.appendChild(list("Ország (háttérkérések)", d.countries));
    breakdown.hidden = false;
  }
  function loadInstalls() {
    installs.hidden = false;
    api("GET", "/api/admin/installs?days=" + encodeURIComponent(daysSelect.value)).then(function (r) {
      if (r.status === 200) { renderInstalls(r.data); return; }
      stats.hidden = true; dailyWrap.hidden = true; breakdown.hidden = true;
      installsNote.hidden = false;
      installsNote.textContent = r.data.error || ("Hiba: " + r.status);
    }).catch(function () {
      installsNote.hidden = false; installsNote.textContent = "Hálózati hiba.";
    });
  }
  daysSelect.addEventListener("change", loadInstalls);

  function load() {
    if (!getToken()) { panel.hidden = true; installs.hidden = true; login.hidden = false; return; }
    hideStatus();
    api("GET", "/api/admin/reports").then(function (r) {
      if (r.status === 200 || r.status === 503) {
        // 503: a KV nincs bekötve, de a token jó — a telepítés-blokk ettől még megy.
        login.hidden = true;
        loadInstalls();
        if (r.status === 200) { panel.hidden = false; render(r.data.items || [], r.data.ttlDays); }
        else { panel.hidden = true; show("err", r.data.error || "A bejelentés-tároló nincs bekötve."); }
        return;
      }
      panel.hidden = true; installs.hidden = true; login.hidden = false;
      if (r.status === 401) setToken("");
      show("err", r.data.error || ("Hiba: " + r.status));
    }).catch(function () { show("err", "Hálózati hiba."); });
  }

  login.addEventListener("submit", function (e) {
    e.preventDefault();
    setToken(tokenInput.value.trim());
    tokenInput.value = "";
    load();
  });
  document.getElementById("refresh").addEventListener("click", load);
  document.getElementById("logout").addEventListener("click", function () {
    setToken(""); rows.textContent = ""; panel.hidden = true; installs.hidden = true; login.hidden = false; hideStatus();
  });
  load();
})();
</script>
</body>
</html>
`;
