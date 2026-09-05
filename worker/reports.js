// A bejelentések privát tárolója: Cloudflare KV.
//
// A nyilvános GitHub-issue-ba csak a bejelentés szövege kerül. Ide a teljes
// bejelentés megy (szöveg + a megadott elérhetőség), az issue számához kötve,
// és FEEDBACK_TTL_DAYS nap után magától lejár (GDPR: a tárolás korlátozása).
// Az /admin oldal innen listáz, olvas és töröl.

const KEY_PREFIX = "report:";
const DEFAULT_TTL_DAYS = 90;
const META_LIMIT_BYTES = 1000; // a KV metaadat-korlátja 1024 bájt

export function feedbackTtlDays(env) {
  const n = Number(env?.FEEDBACK_TTL_DAYS);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_TTL_DAYS;
}

// Nullákkal feltöltve, hogy a KV szöveges kulcsrendezése számsorrendet adjon.
export function reportKey(issueNumber) {
  return KEY_PREFIX + String(issueNumber).padStart(8, "0");
}

function bytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export async function saveReport(env, { issueNumber, issueUrl, type, title, body, contact }) {
  if (!env.FEEDBACK) return false;
  const ttlSeconds = feedbackTtlDays(env) * 86400;
  const now = Date.now();
  const record = {
    issue: issueNumber,
    url: issueUrl,
    type,
    title: String(title ?? ""),
    body: String(body ?? ""),
    contact: String(contact ?? ""),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlSeconds * 1000).toISOString(),
  };
  // A lista a metaadatból megy (egyetlen list() hívás, nem kulcsonkénti olvasás);
  // a szöveg a teljes rekordban van, azt kérésre olvassuk. Ha a kivonat (elvileg)
  // nem férne a korlátba, a cím marad ki belőle.
  const { body: _omitted, ...summary } = record;
  summary.title = summary.title.slice(0, 80);
  const metadata = bytes(summary) > META_LIMIT_BYTES ? { ...summary, title: "" } : summary;
  await env.FEEDBACK.put(reportKey(issueNumber), JSON.stringify(record), {
    expirationTtl: ttlSeconds,
    metadata,
  });
  return true;
}

export async function listReports(env) {
  const items = [];
  let cursor;
  do {
    const page = await env.FEEDBACK.list({ prefix: KEY_PREFIX, cursor });
    for (const key of page.keys) {
      if (key.metadata) {
        items.push(key.metadata);
      } else {
        const value = await env.FEEDBACK.get(key.name, "json");
        if (value) {
          const { body: _omitted, ...summary } = value;
          items.push(summary);
        }
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  items.sort((a, b) => Number(b.issue) - Number(a.issue));
  return items;
}

export async function getReport(env, issueNumber) {
  return env.FEEDBACK.get(reportKey(issueNumber), "json");
}

export async function deleteReport(env, issueNumber) {
  await env.FEEDBACK.delete(reportKey(issueNumber));
}
