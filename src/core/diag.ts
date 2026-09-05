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

const MAX_ENTRIES = 1500;
// The feedback form accepts 30 000 characters; keep the dump under that with
// the start of the session always included (that is where the login is).
const MAX_DUMP_CHARS = 28_000;
const HEAD_LINES = 40;

interface Entry {
  at: number;
  text: string;
}

const entries: Entry[] = [];
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
export function diag(text: string): void {
  entries.push({ at: Date.now(), text });
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
  // eslint-disable-next-line no-console
  console.log("%c[NPU diag]", "color:#9a6700;font-weight:bold", text);
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

/** The whole log as text, bounded, with a header that says what it does and does not contain. */
export function diagDump(): string {
  const header = [
    `Neptun PowerUp! NG v${VERSION} — diagnosztikai napló`,
    `oldal: ${location.host}${APP_BASE}`,
    `böngésző: ${navigator.userAgent}`,
    `az oldal megnyitva: ${hhmmss(pageLoadedAt)}, a napló kezdete: ${hhmmss(startedAt)} (${new Date(startedAt).toISOString()})`,
    `tartalom: időpontok, HTTP-státuszok, időtartamok, fül-láthatóság, az app saját kéréseinek útvonala,`,
    `  a szerver hibaüzenete elutasított frissítésnél (token/GUID/email/hosszú szám kiszűrve), szerver-óraeltérés.`,
    `NEM tartalmaz: tokent, sütit, Neptun-kódot, nevet, kérés/válasz tartalmat (a fenti egy hibaüzeneten kívül).`,
    "",
  ].join("\n");
  const lines = entries.map(e => `${hhmmss(e.at)}  ${e.text}`);
  let body = lines.join("\n");
  if (header.length + body.length > MAX_DUMP_CHARS) {
    // Keep the first lines (login, first refreshes) and as much of the end as fits.
    const head = lines.slice(0, HEAD_LINES);
    const tail: string[] = [];
    let size = header.length + head.join("\n").length + 60;
    for (let i = lines.length - 1; i >= HEAD_LINES; i--) {
      if (size + lines[i].length + 1 > MAX_DUMP_CHARS) {
        break;
      }
      tail.unshift(lines[i]);
      size += lines[i].length + 1;
    }
    const skipped = lines.length - head.length - tail.length;
    body = [...head, `… (${skipped} sor kihagyva, hogy beférjen az űrlapba) …`, ...tail].join("\n");
  }
  return header + body;
}
