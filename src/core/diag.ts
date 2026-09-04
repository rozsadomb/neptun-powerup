import { APP_BASE } from "./base";
import { VERSION } from "./env";

// Diagnostic log for session problems ("the session expired at 12 minutes").
//
// Everything stays on this machine. Entries live in memory and are mirrored
// to the console; they leave the page only when the user presses "copy" in
// the settings panel and pastes the text somewhere themselves. There is no
// network call and no storage write anywhere in this file.
//
// What is recorded: timestamps, HTTP statuses, durations, the tab's
// visibility, the app's mount path and the browser's user-agent string.
// What is never recorded: tokens, cookies, the Neptun code, names, request
// or response bodies, URLs with parameters.

const MAX_ENTRIES = 500;

interface Entry {
  at: number;
  text: string;
}

const entries: Entry[] = [];
const startedAt = Date.now();

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

/** The whole log as text, with a header that says what it does and does not contain. */
export function diagDump(): string {
  const header = [
    `Neptun PowerUp! NG v${VERSION} — diagnosztikai napló`,
    `oldal: ${location.host}${APP_BASE}`,
    `böngésző: ${navigator.userAgent}`,
    `napló kezdete: ${new Date(startedAt).toISOString()}`,
    `tartalom: időpontok, HTTP-státuszok, időtartamok, fül-láthatóság.`,
    `NEM tartalmaz: tokent, sütit, Neptun-kódot, nevet, kérés/válasz tartalmat.`,
    "",
  ];
  return header.concat(entries.map(e => `${hhmmss(e.at)}  ${e.text}`)).join("\n");
}
