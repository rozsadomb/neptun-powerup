// Cloudflare Pages Function: a visszajelzés-űrlapból GitHub issue-t nyit.
//
// Szükséges környezeti változók (Cloudflare Pages → Settings → Variables):
//   GITHUB_TOKEN — fine-grained personal access token, egyetlen joggal:
//                  Issues: Read and write, csak a neptun-powerup repóra.
//   GITHUB_REPO  — "rozsadomb/neptun-powerup"

const MAX_TITLE = 120;
const MAX_BODY = 4000;
const MAX_CONTACT = 120;

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

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
    return json(200, { url: "https://github.com/" + env.GITHUB_REPO + "/issues" });
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
    `*A weboldal visszajelzés-űrlapjáról érkezett.*` +
    (contact ? `\n*Megadott elérhetőség: ${contact}*` : "");

  const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "npu-feedback-form",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ title: `${prefix} ${title}`, body: issueBody, labels: [label] }),
  });

  if (!response.ok) {
    console.error("GitHub API error", response.status, await response.text());
    return json(502, { error: "Nem sikerült rögzíteni a bejelentést. Próbáld újra később, vagy nyiss issue-t a GitHubon." });
  }

  const issue = await response.json();
  return json(200, { url: issue.html_url });
}
