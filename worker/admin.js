// A karbantartó privát felülete a bejelentésekhez.
//
//   GET    /admin                     — az oldal (HTML; adatot nem tartalmaz, azt tokennel kéri le)
//   GET    /api/admin/reports         — lista, szöveg nélkül (Authorization: Bearer <ADMIN_TOKEN>)
//   GET    /api/admin/reports/<szám>  — egy bejelentés teljes egészében (szöveggel)
//   DELETE /api/admin/reports/<szám>  — egy bejelentés törlése a privát tárolóból
//
// Az ADMIN_TOKEN Cloudflare Secret (DEPLOY.md 2b). Hosszú, véletlen érték legyen:
// nincs külön korlátozás a próbálkozásokra, a token hossza a védelem.

import { json } from "./http.js";
import { listReports, getReport, deleteReport, feedbackTtlDays } from "./reports.js";

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
<title>Bejelentések, Neptun PowerUp! NG</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="/style.css">
<style>
  .admin { max-width: 1080px; margin: 0 auto; padding: clamp(32px, 6vw, 72px) clamp(20px, 4vw, 40px) 80px; }
  .admin h1 { font-size: clamp(2rem, 1.2rem + 2.5vw, 2.75rem); }
  .admin > .hint { margin-top: 12px; max-width: 62ch; }
  .card { margin-top: 28px; padding: 24px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card); }
  .card label { display: block; font-weight: 600; font-size: .9375rem; margin-bottom: 8px; color: var(--ink); }
  .card input[type="password"] { width: 100%; font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--line-strong); border-radius: var(--radius-input); padding: 12px 14px; }
  .card input:focus-visible { outline: 0; border-color: var(--ink); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 45%, transparent); }
  .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
  .card > .row { margin-top: 16px; }
  .card > .toolbar { margin-top: 0; justify-content: space-between; }
  .status { margin-top: 20px; }
  .tablewrap { overflow-x: auto; margin-top: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: .9375rem; }
  th, td { text-align: left; vertical-align: top; padding: 12px 10px; border-bottom: 1px solid var(--line); }
  th { font-size: .8125rem; font-weight: 600; color: var(--muted); white-space: nowrap; }
  td.issue { min-width: 240px; }
  tr:last-child td { border-bottom: 0; }
  td .title { display: block; color: var(--text); }
  td .kind { display: inline-block; margin-top: 4px; font-size: .75rem; font-weight: 600; color: var(--muted); border: 1px solid var(--line-strong); border-radius: 999px; padding: 1px 8px; }
  td.contact { overflow-wrap: anywhere; min-width: 180px; }
  td.contact a { font-family: var(--mono); font-size: .875em; }
  td.when { white-space: nowrap; color: var(--muted); font-size: .875rem; }
  td.acts { white-space: nowrap; }
  td.acts .row { gap: 8px; flex-wrap: nowrap; }
  tr.text td { padding-top: 0; }
  tr.text pre { margin: 0; padding: 14px 16px; white-space: pre-wrap; word-break: break-word; font: inherit; font-size: .9375rem; line-height: 1.55; background: var(--bg); border: 1px solid var(--line); border-radius: var(--radius-input); }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  @media (max-width: 860px) {
    thead { display: none; }
    table, tbody, tr, td { display: block; }
    tr { padding: 12px 0; border-bottom: 1px solid var(--line); }
    tr.text { padding-top: 0; }
    tr:last-child { border-bottom: 0; }
    td { border: 0; padding: 4px 0; }
    td.when, td.acts { white-space: normal; }
    td[data-l]:not([data-l=""])::before { content: attr(data-l); display: block; font-size: .75rem; color: var(--muted); }
  }
</style>
</head>
<body>
<main class="admin">
  <h1>Bejelentések</h1>
  <p class="hint">A visszajelzés-űrlapról érkezett bejelentések privát másolata, a megadott email címekkel együtt. A nyilvános GitHub-issue-ba csak a szöveg kerül; ez a lista <span id="ttl">…</span> nap után magától ürül.</p>

  <form class="card" id="login" hidden>
    <label for="token">Admin token</label>
    <input type="password" id="token" autocomplete="current-password" required>
    <div class="row">
      <button class="btn btn--ink btn--sm" type="submit">Belépés</button>
      <span class="hint">Az <code>ADMIN_TOKEN</code> nevű Cloudflare-secret értéke. Ez a böngésző megjegyzi.</span>
    </div>
  </form>

  <div id="status" class="form-status status" hidden></div>

  <section class="card" id="panel" hidden aria-live="polite">
    <div class="row toolbar">
      <strong id="count"></strong>
      <span class="row">
        <button class="btn btn--ghost btn--sm" type="button" id="refresh">Frissítés</button>
        <button class="btn btn--ghost btn--sm" type="button" id="logout">Kilépés</button>
      </span>
    </div>
    <div class="tablewrap">
      <table>
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
      tdIssue.appendChild(el("span", { class: "kind" }, it.type === "idea" ? "Ötlet" : "Hiba"));
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
        if (textRow) { textRow.remove(); textRow = null; open.setAttribute("aria-expanded", "false"); return; }
        open.disabled = true;
        api("GET", "/api/admin/reports/" + it.issue).then(function (r) {
          open.disabled = false;
          if (r.status !== 200) { show("err", r.data.error || "Nem sikerült betölteni."); return; }
          textRow = el("tr", { class: "text" });
          var td = el("td", { colspan: "5", "data-l": "" });
          td.appendChild(el("pre", null, r.data.body || ""));
          textRow.appendChild(td);
          tr.after(textRow);
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

  function load() {
    if (!getToken()) { panel.hidden = true; login.hidden = false; return; }
    hideStatus();
    api("GET", "/api/admin/reports").then(function (r) {
      if (r.status === 200) {
        login.hidden = true; panel.hidden = false;
        render(r.data.items || [], r.data.ttlDays);
        return;
      }
      panel.hidden = true; login.hidden = false;
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
    setToken(""); rows.textContent = ""; panel.hidden = true; login.hidden = false; hideStatus();
  });
  load();
})();
</script>
</body>
</html>
`;
