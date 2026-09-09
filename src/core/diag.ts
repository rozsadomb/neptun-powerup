import { APP_BASE } from "./base";
import { VERSION } from "./env";

// Diagnostic log for session problems ("the session expired at 12 minutes").
//
// Everything stays on this machine. Entries live in memory and are mirrored
// to the console; they leave the page only when the user presses "copy" in
// the settings panel and pastes the text somewhere themselves. There is no
// network call and no storage write anywhere in this file.
//
// Recorded: timestamps, HTTP statuses, durations, the tab's visibility, the
// paths of the app's own API calls (query strings stripped), the server's
// error message on a rejected refresh (tokens, GUIDs, e-mail addresses and
// long numbers replaced), the server's clock offset, the app's mount path
// and the browser's user-agent string.
// Never recorded: tokens, cookies, the Neptun code, names, request or
// response bodies other than that one scrubbed error message, URL parameters.
//
// The log must stay useful when it is long. A hidden tab writes one
// throttled-tick line per minute for hours (the NJE log: 5 hours, 266 lines
// pushed out of the copy), and after a 401 nothing but such lines follows —
// a plain head/tail cut would have dropped the 401 itself after ~5 hours. So
// every entry carries a level, and both the memory bound and the copied text
// shed the noise first, then the routine traffic, oldest first and never the
// head (the login); essential lines go only when they do not fit on their own.

const MAX_ENTRIES = 1500;
// The feedback form accepts 30 000 characters; keep the dump under that with
// the start of the session always included (that is where the login is).
const MAX_DUMP_CHARS = 28_000;
const HEAD_LINES = 40;
// Room kept for the one line that stands in for the dropped ones.
const SUMMARY_MAX_CHARS = 400;
const KIND_MAX_CHARS = 80;
const KINDS_LISTED = 3;

/**
 * How much a line matters when the log must be shortened.
 *  - "essential" (default): starts and stops, decisions, failures, rejections,
 *    visibility changes — anything that explains a dead session.
 *  - "routine": a successful, expected request or refresh; the timeline is
 *    nice to have, dispensable in bulk.
 *  - "noise": a repeat that carries no new information once the state is
 *    known — the throttled tick of a hidden tab, once a minute for hours.
 */
export type DiagLevel = "essential" | "routine" | "noise";

interface Entry {
  at: number;
  text: string;
  level: DiagLevel;
}

const entries: Entry[] = [];
let evicted = 0;
const startedAt = Date.now();
const pageLoadedAt = Math.round(performance.timeOrigin);
let loginAt: number | null = null;
let lastAppCall: { at: number; path: string; status: number } | null = null;

export function hhmmss(ms: number): string {
  return new Date(ms).toLocaleTimeString("hu-HU", { hour12: false });
}

export function fmtDuration(ms: number): string {
  const s = Math.round(Math.abs(ms) / 1000);
  return s < 60 ? `${s} mp` : `${Math.floor(s / 60)} p ${String(s % 60).padStart(2, "0")} mp`;
}

/** Appends one line to the diagnostic log. Keep it free of personal data. */
export function diag(text: string, level: DiagLevel = "essential"): void {
  entries.push({ at: Date.now(), text, level });
  if (entries.length > MAX_ENTRIES) {
    evict();
  }
  // eslint-disable-next-line no-console
  console.log("%c[NPU diag]", "color:#9a6700;font-weight:bold", text);
}

// Frees one slot: the oldest noise line after the head, else the oldest
// routine line, else the oldest line after the head. The head — the login
// and the first refreshes — is never touched.
function evict(): void {
  for (const level of ["noise", "routine"] as const) {
    const index = entries.findIndex((entry, i) => i >= HEAD_LINES && entry.level === level);
    if (index !== -1) {
      entries.splice(index, 1);
      evicted++;
      return;
    }
  }
  entries.splice(HEAD_LINES, 1);
  evicted++;
}

/** When the current session was logged in (the first token's issue time). */
export function setLoginTime(at: number | null): void {
  loginAt = at;
}

/** The app's own API traffic, so the log shows when Neptun itself last talked to the server. */
export function noteAppCall(path: string, status: number): void {
  lastAppCall = { at: Date.now(), path, status };
}

/** "how long since login / page load / the app's last own request" — for the moment a session dies. */
export function diagContext(): string {
  const now = Date.now();
  const parts: string[] = [];
  if (loginAt !== null) {
    parts.push(`a belépés óta ${fmtDuration(now - loginAt)}`);
  }
  parts.push(`az oldal megnyitása óta ${fmtDuration(now - pageLoadedAt)}`);
  if (lastAppCall) {
    parts.push(
      `az app utolsó saját kérése ${fmtDuration(now - lastAppCall.at)} ezelőtt (${lastAppCall.path} → ${lastAppCall.status})`
    );
  }
  return parts.join(", ");
}

/** Strips anything that could identify a person or a session from a server error message. */
export function sanitize(text: string): string {
  return text
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "<token>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<guid>")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>")
    .replace(/\d{7,}/g, "<szám>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

interface Row extends Entry {
  line: string;
}

function size(rows: Row[]): number {
  return rows.reduce((sum, row) => sum + row.line.length + 1, 0);
}

// The text without the parts that differ from one repeat to the next (clock
// times, durations), so repeats can be counted: "tick N p N mp késéssel …".
function kind(text: string): string {
  const stripped = text.replace(/\d{1,2}:\d{2}:\d{2}/g, "⋯").replace(/-?\d+ (p|mp)\b/g, "N $1");
  return stripped.length > KIND_MAX_CHARS ? `${stripped.slice(0, KIND_MAX_CHARS)}…` : stripped;
}

// One line in place of the dropped ones: how many, when, and what they were.
function summaryRow(dropped: Row[]): Row {
  const first = dropped[0];
  const last = dropped[dropped.length - 1];
  const counts = new Map<string, number>();
  dropped.forEach(row => {
    const key = kind(row.text);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const kinds =
    ranked
      .slice(0, KINDS_LISTED)
      .map(([key, count]) => `${count}× „${key}”`)
      .join(", ") + (ranked.length > KINDS_LISTED ? ` és ${ranked.length - KINDS_LISTED} másféle` : "");
  const text = `… ${dropped.length} sor kihagyva ${hhmmss(first.at)} és ${hhmmss(last.at)} között, hogy beférjen az űrlapba: ${kinds} …`.slice(
    0,
    SUMMARY_MAX_CHARS
  );
  return { at: first.at, level: "essential", text, line: `${hhmmss(first.at)}  ${text}` };
}

// Drops lines of one level, oldest first and never from the head, until the
// dump fits; the summary stands where the first dropped line was.
function thin(rows: Row[], level: DiagLevel, budget: number): Row[] {
  let total = size(rows) + SUMMARY_MAX_CHARS;
  const kept: Row[] = [];
  const dropped: Row[] = [];
  let summaryAt = -1;
  rows.forEach((row, i) => {
    if (i >= HEAD_LINES && row.level === level && total > budget) {
      if (summaryAt === -1) {
        summaryAt = kept.length;
      }
      dropped.push(row);
      total -= row.line.length + 1;
    } else {
      kept.push(row);
    }
  });
  if (dropped.length === 0) {
    return rows;
  }
  kept.splice(summaryAt, 0, summaryRow(dropped));
  return kept;
}

// The last resort, for essential lines that still do not fit: the first lines
// (login, first refreshes) and as much of the end as fits.
function headTail(rows: Row[], budget: number): Row[] {
  const head = rows.slice(0, HEAD_LINES);
  const tail: Row[] = [];
  let total = size(head) + 60;
  for (let i = rows.length - 1; i >= HEAD_LINES; i--) {
    if (total + rows[i].line.length + 1 > budget) {
      break;
    }
    tail.unshift(rows[i]);
    total += rows[i].line.length + 1;
  }
  const skipped = rows.length - head.length - tail.length;
  const marker = `… (${skipped} sor kihagyva, hogy beférjen az űrlapba) …`;
  return [...head, { at: 0, level: "essential", text: marker, line: marker }, ...tail];
}

/** The whole log as text, bounded, with a header that says what it does and does not contain. */
export function diagDump(): string {
  const header = [
    `Neptun PowerUp! NG v${VERSION} — diagnosztikai napló`,
    `oldal: ${location.host}${APP_BASE}`,
    `böngésző: ${navigator.userAgent}`,
    `az oldal megnyitva: ${hhmmss(pageLoadedAt)}, a napló kezdete: ${hhmmss(startedAt)} (${new Date(startedAt).toISOString()})`,
    ...(evicted > 0 ? [`a memóriakorlát miatt ${evicted} régi sor már nincs meg (a zaj és a rutin sorok mennek először)`] : []),
    `tartalom: időpontok, HTTP-státuszok, időtartamok, fül-láthatóság, az app saját kéréseinek útvonala,`,
    `  a szerver hibaüzenete elutasított frissítésnél (token/GUID/email/hosszú szám kiszűrve), szerver-óraeltérés.`,
    `NEM tartalmaz: tokent, sütit, Neptun-kódot, nevet, kérés/válasz tartalmat (a fenti egy hibaüzeneten kívül).`,
    "",
  ].join("\n");
  const budget = MAX_DUMP_CHARS - header.length;
  let rows: Row[] = entries.map(entry => ({ ...entry, line: `${hhmmss(entry.at)}  ${entry.text}` }));
  for (const level of ["noise", "routine"] as const) {
    if (size(rows) <= budget) {
      break;
    }
    rows = thin(rows, level, budget);
  }
  if (size(rows) > budget) {
    rows = headTail(rows, budget);
  }
  return header + rows.map(row => row.line).join("\n");
}
