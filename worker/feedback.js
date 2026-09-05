// A visszajelzés-űrlapból GitHub issue-t nyit.
//
// A nyilvános issue-ba CSAK a bejelentés szövege kerül. A teljes bejelentés
// (szöveg + a megadott elérhetőség) külön, privát KV-tárolóba megy az issue
// számához kötve, lásd reports.js és az /admin oldalt. Az email cím soha nem
// kerül az issue szövegébe.
//
// Környezeti változók és kötések (Cloudflare → a Worker → Settings):
//   GITHUB_TOKEN      — fine-grained personal access token, egyetlen joggal:
//                       Issues: Read and write, csak a neptun-powerup repóra. (Secret!)
//   GITHUB_REPO       — "rozsadomb/neptun-powerup" (wrangler.jsonc, vars)
//   FEEDBACK          — KV-kötés a bejelentéseknek (wrangler.jsonc, kv_namespaces)
//   FEEDBACK_TTL_DAYS — ennyi nap után törlődik magától a privát másolat (vars, alap: 90)
//   GITHUB_API_URL    — csak helyi teszthez: hova menjen az issue-nyitó kérés
//                       (alap: https://api.github.com)

import { json } from "./http.js";
import { saveReport } from "./reports.js";

const MAX_TITLE = 120;
// A diagnosztikai napló (Beállítások → Napló másolása) több ezer karakter is lehet,
// ezért a szöveg korlátja bőven a GitHub 65 536-os határa alatt, de tágasan van.
const MAX_BODY = 30000;
const MAX_CONTACT = 120;

export async function handleFeedback(request, env) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return json(503, { error: "A visszajelzés-funkció még nincs beállítva. Kérlek, nyiss issue-t a GitHubon." });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json(400, { error: "Érvénytelen kérés." });
  }

  // Honeypot: embernek láthatatlan mező — ha ki van töltve, robot küldte.
  // Sikeres választ adunk, hogy a botnak ne legyen mit tanulnia.
  if (typeof payload.website === "string" && payload.website !== "") {
    return json(200, { url: `https://github.com/${env.GITHUB_REPO}/issues`, contactSaved: null });
  }

  const type = payload.type === "idea" ? "idea" : "bug";
  const title = String(payload.title ?? "").trim().slice(0, MAX_TITLE);
  const body = String(payload.body ?? "").trim().slice(0, MAX_BODY);
  const contact = String(payload.contact ?? "").trim().slice(0, MAX_CONTACT);

  if (title.length < 5 || body.length < 10) {
    return json(400, { error: "Kérlek, adj meg egy rövid címet és néhány mondat leírást." });
  }

  const label = type === "bug" ? "bug" : "enhancement";
  const prefix = type === "bug" ? "🐞" : "💡";
  const issueBody =
    body +
    "\n\n---\n" +
    "*A weboldal visszajelzés-űrlapjáról érkezett.*" +
    (contact ? "\n*A bejelentő megadott egy elérhetőséget. Az nem nyilvános, csak a karbantartó látja.*" : "");

  const apiBase = String(env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
  const response = await fetch(`${apiBase}/repos/${env.GITHUB_REPO}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "npu-feedback-form",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ title: `${prefix} ${title}`, body: issueBody, labels: [label] }),
  });

  if (!response.ok) {
    // A hibaszöveg a GitHubtól jön; a bejelentő adatai nincsenek benne.
    console.error("GitHub API error", response.status, await response.text());
    return json(502, {
      error: "Nem sikerült rögzíteni a bejelentést. Próbáld újra később, vagy nyiss issue-t a GitHubon.",
    });
  }

  const issue = await response.json();

  // A teljes bejelentés a privát tárolóba, az issue számához kötve. Ha ez nem
  // megy (nincs bekötve a KV, vagy hibázik), az issue akkor is megvan; a válasz
  // csak azt mondja meg az űrlapnak, hogy a megadott email cím el lett-e mentve.
  let contactSaved = contact ? false : null;
  try {
    const saved = await saveReport(env, { issueNumber: issue.number, issueUrl: issue.html_url, type, title, body, contact });
    if (saved && contact) contactSaved = true;
  } catch (err) {
    console.error("Feedback store error", err && err.message);
  }

  return json(200, { url: issue.html_url, contactSaved });
}
