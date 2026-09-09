// A szkript letöltéseinek számlálása.
//
// A /npu.user.js a wrangler.jsonc run_worker_first listája miatt a Worker elé
// kerül: ez a modul számol egyet a Workers Analytics Engine-be, majd az assetet
// változatlanul visszaadja. A felhasználónak semmi nem változik.
//
// Mit tárol egy letöltésről: a fajtáját (lásd lent), a böngésző családját, az
// országot (a Cloudflare adja a kéréshez) és hogy Range-kérés volt-e. IP-címet,
// sütit, felhasználói azonosítót NEM tárol, ezért két letöltést nem tud
// ugyanahhoz a géphez kötni; az „aktív telepítések” száma becslés.
//
// Fajták:
//   install  — navigációs kérés: valaki rákattintott a telepítés gombra
//              (a Tampermonkey ezután a háttérben maga is letölti a fájlt)
//   check    — háttérkérés Range fejléccel: a Tampermonkey napi frissítés-
//              ellenőrzése, ami csak a fejlécet nézné (naponta kb. egy per
//              telepítés, ezért ez az aktív telepítések legjobb közelítése)
//   download — háttérkérés a teljes fájlért: telepítéskor, vagy amikor az
//              ellenőrzés új verziót talált

import { json } from "./http.js";

export const DATASET = "npu_installs";
const MAX_DAYS = 90;
const DEFAULT_DAYS = 30;

export function browserFamily(userAgent) {
  const ua = String(userAgent ?? "");
  if (/Edg(e|A|iOS)?\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/Firefox\/|FxiOS/.test(ua)) return "Firefox";
  if (/Chrome\/|CriOS/.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "egyéb";
}

export function classify(request) {
  const h = request.headers;
  const mode = h.get("Sec-Fetch-Mode");
  const dest = h.get("Sec-Fetch-Dest");
  const accept = h.get("Accept") ?? "";
  const range = h.has("Range");
  // Navigáció: a böngésző oldalként nyitja meg (a telepítés gomb). Régi
  // böngésző Sec-Fetch fejlécek nélkül: az Accept árulja el, hogy oldalt kér.
  const navigate = mode === "navigate" || dest === "document" || (mode === null && dest === null && accept.includes("text/html"));
  const kind = navigate ? "install" : range ? "check" : "download";
  return {
    kind,
    range,
    browser: browserFamily(h.get("User-Agent")),
    country: String(request.cf?.country ?? "?"),
  };
}

export function dataPoint({ kind, browser, country, range }) {
  return {
    indexes: [kind],
    blobs: [kind, browser, country, range ? "range" : "full"],
    doubles: [1],
  };
}

export async function handleScriptDownload(request, env) {
  if (env.INSTALLS && (request.method === "GET" || request.method === "HEAD")) {
    try {
      env.INSTALLS.writeDataPoint(dataPoint(classify(request)));
    } catch {
      // A számlálás sosem állhat a letöltés útjába.
    }
  }
  return env.ASSETS.fetch(request);
}

export function installStatsConfigured(env) {
  return Boolean(env.INSTALLS);
}

export function installQueryConfigured(env) {
  return Boolean(env.CF_ACCOUNT_ID && env.CF_ANALYTICS_TOKEN);
}

function clampDays(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? Math.min(n, MAX_DAYS) : DEFAULT_DAYS;
}

export function statsQuery(days) {
  return (
    `SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, ` +
    `blob1 AS kind, blob2 AS browser, blob3 AS country, SUM(_sample_interval) AS n ` +
    `FROM ${DATASET} WHERE timestamp > NOW() - INTERVAL '${days}' DAY ` +
    `GROUP BY day, kind, browser, country ORDER BY day FORMAT JSON`
  );
}

const EMPTY = () => ({ install: 0, check: 0, download: 0 });

function dayKey(value) {
  return String(value).slice(0, 10);
}

// A lekérdezés soraiból az admin oldal számai. Tiszta függvény, a teszt ezt hajtja.
// `today` az ISO-nap, amihez képest a „tegnap” számít (a mai nap még csonka).
export function aggregate(rows, days, today = dayKey(new Date().toISOString())) {
  const byDay = new Map();
  const totals = EMPTY();
  const browsers = new Map();
  const countries = new Map();
  for (const row of rows ?? []) {
    const day = dayKey(row.day);
    const kind = ["install", "check", "download"].includes(row.kind) ? row.kind : "download";
    const n = Number(row.n) || 0;
    if (!byDay.has(day)) byDay.set(day, { day, ...EMPTY() });
    byDay.get(day)[kind] += n;
    totals[kind] += n;
    if (kind !== "install") {
      browsers.set(row.browser, (browsers.get(row.browser) ?? 0) + n);
      countries.set(row.country, (countries.get(row.country) ?? 0) + n);
    }
  }
  const daily = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
  const yesterdayKey = dayKey(new Date(Date.parse(today + "T00:00:00Z") - 86400_000).toISOString());
  const top = (map) => [...map.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n).slice(0, 8);
  return {
    days,
    totals,
    daily,
    today: byDay.get(today) ?? { day: today, ...EMPTY() },
    yesterday: byDay.get(yesterdayKey) ?? { day: yesterdayKey, ...EMPTY() },
    browsers: top(browsers),
    countries: top(countries),
  };
}

export async function fetchInstallStats(env, days) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CF_ACCOUNT_ID)}/analytics_engine/sql`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}` },
    body: statsQuery(days),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`Analytics Engine ${res.status}: ${detail}`);
  }
  const payload = await res.json();
  return aggregate(payload.data ?? [], days);
}

// GET /api/admin/installs?days=30 — a token ellenőrzése a hívó (admin.js) dolga.
export async function handleInstallsApi(request, env, url) {
  if (request.method !== "GET") {
    return json(405, { error: "Csak GET kérés engedélyezett." }, { Allow: "GET" });
  }
  if (!installStatsConfigured(env)) {
    return json(503, { error: "Nincs bekötve az INSTALLS Analytics Engine-adathalmaz (lásd DEPLOY.md 2c)." });
  }
  if (!installQueryConfigured(env)) {
    return json(503, { error: "Nincs beállítva a CF_ACCOUNT_ID és CF_ANALYTICS_TOKEN secret (lásd DEPLOY.md 2c)." });
  }
  const days = clampDays(url.searchParams.get("days"));
  try {
    return json(200, await fetchInstallStats(env, days));
  } catch (error) {
    return json(502, { error: `A statisztika lekérdezése nem sikerült: ${error.message}` });
  }
}
