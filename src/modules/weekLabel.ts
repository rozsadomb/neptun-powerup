import { api } from "../core/api";
import { diag } from "../core/diag";
import { injectCss } from "../core/dom";
import type { NpuModule } from "../core/modules";
import { OPEN_SETTINGS_EVENT } from "../core/settings";
import * as storage from "../core/storage";
import { ensureUser } from "../core/user";

// „6. szorgalmi hét" a naptár fejlécében (egy óbudai hallgató ötlete).
//
// A Neptun naptára a háttérben tárolja a félév időszakait dátummal — a
// „Tanulmányi időszak" eseménytípus mögött —, köztük a szorgalmi időszakot.
// Ebből számoljuk a hét sorszámát: az időszak kezdőhetének hétfőjétől, hétfő-
// vasárnap hetekkel.
//
// Vizsgaidőszakot a Neptun nem listáz (sem a BME, sem az ÓE), ezért a vizsgahét
// három forrásból jöhet, ebben a bizalmi sorrendben: (1) „Vizsgaidőszak" típusú
// időszak a Neptuntól, ha egyszer mégis lesz; (2) a hallgató által a
// beállításokban megadott két dátum; (3) becslés az óbudai jelentő szabályával:
// a szorgalmi időszak utáni hétfőtől a következő félév szorgalmi időszakának
// előtti vasárnapig (ha az nem ismert, nyolc hétig). A becsült címke „≈"-vel
// és magyarázattal jelenik meg, hogy senkit ne tévesszen meg.
//
// Az időszakokat félévente elég egyszer lekérni; a válasz hallgatónként
// tárolódik és hetente frissül. Mérés: RECON.md, „Naptár API".

export interface Period {
  type: string;
  name: string;
  start: string;
  end: string;
  term?: string;
  /** Nem a Neptuntól jött: a szorgalmi időszak végéből becsültük. */
  estimated?: boolean;
}

export interface WeekInfo {
  text: string;
  estimated: boolean;
}

export interface ManualPeriod {
  start: string; // ÉÉÉÉ-HH-NN
  end: string;
}

export type PeriodKind = "study" | "exam";

export const DAY_MS = 86_400_000;
const CACHE_MAX_AGE_MS = 7 * DAY_MS;
// Ha a következő félév szorgalmi időszaka nem ismert, ennyi hétig tart a becsült vizsgaidőszak.
export const ESTIMATE_WEEKS = 8;
const ESTIMATE_TYPE = "Vizsgaidőszak (becslés)";
const MANUAL_TYPE = "Vizsgaidőszak (beállítás)";
// Fél év előre és vissza: ennyit a szerver még kiszolgál (egy év fölött 500-at ad).
const WINDOW_DAYS = 150;
const NARROW_WINDOW_DAYS = 60;
// Ha ennyi másodpercig nincs meg a naptár fejléce, a napló szól róla.
const HEADER_MISSING_TICKS = 15;
const POLL_MS = 1000;

const MONTHS = [
  "január", "február", "március", "április", "május", "június",
  "július", "augusztus", "szeptember", "október", "november", "december",
];

/** A hét hétfője, helyi éjfél. */
export function mondayOf(date: Date): Date {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (monday.getDay() + 6) % 7; // hétfő = 0
  monday.setDate(monday.getDate() - offset);
  return monday;
}

/**
 * Hányadik hete az időszaknak a dátum hete (1-től), vagy null, ha a hét az
 * időszakon kívül esik. Az időszak kezdőhete akkor is az 1. hét, ha az
 * időszak nem hétfőn kezdődik.
 */
export function weekNumber(periodStart: Date, periodEnd: Date, date: Date): number | null {
  const week = mondayOf(date);
  const first = mondayOf(periodStart);
  if (week < first || week > periodEnd) {
    return null;
  }
  // Napokban, kerekítve: az óraátállítás egy órát tol a különbségen.
  const days = Math.round((week.getTime() - first.getTime()) / DAY_MS);
  return Math.floor(days / 7) + 1;
}

export function kindOf(period: { type?: string; name?: string }): PeriodKind | null {
  const text = `${period.type ?? ""} ${period.name ?? ""}`.toLowerCase();
  // Intézményenként más lehet a neve: szorgalmi / oktatási / tanítási időszak.
  if (text.includes("szorgalmi") || text.includes("oktatási időszak") || text.includes("tanítási időszak")) {
    return "study";
  }
  // „Vizsgaidőszak" igen, „Vizsgajelentkezési időszak" nem.
  if (text.includes("vizsgaidőszak") && !text.includes("jelentkez")) {
    return "exam";
  }
  return null;
}

/** „6. szorgalmi hét" / „2. vizsgahét" a mutatott dátumra, vagy null. */
export function describeWeek(periods: Period[], date: Date): WeekInfo | null {
  for (const kind of ["study", "exam"] as const) {
    const candidates = periods
      .filter(period => kindOf(period) === kind)
      .map(period => ({ period, n: weekNumber(new Date(period.start), new Date(period.end), date) }))
      .filter(item => item.n !== null)
      // Két félév átfedésénél a később kezdődő a mostani.
      .sort((a, b) => new Date(b.period.start).getTime() - new Date(a.period.start).getTime());
    if (candidates.length > 0) {
      const { period, n } = candidates[0];
      return { text: kind === "study" ? `${n}. szorgalmi hét` : `${n}. vizsgahét`, estimated: period.estimated === true };
    }
  }
  return null;
}

export function labelFor(periods: Period[], date: Date): string | null {
  return describeWeek(periods, date)?.text ?? null;
}

function localIso(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/**
 * Becsült vizsgaidőszakok a szorgalmi időszakokból: a szorgalmi vége utáni
 * hétfőtől a következő szorgalmi időszak hetének előtti vasárnapjáig; utolsó
 * ismert félévnél ESTIMATE_WEEKS hétig.
 */
export function estimateExamPeriods(periods: Period[]): Period[] {
  const studies = periods
    .filter(period => kindOf(period) === "study")
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  const estimates: Period[] = [];
  studies.forEach((study, index) => {
    const start = mondayOf(new Date(study.end));
    start.setDate(start.getDate() + 7);
    const next = studies[index + 1];
    const end = next ? mondayOf(new Date(next.start)) : new Date(start);
    end.setDate(end.getDate() + (next ? -1 : ESTIMATE_WEEKS * 7 - 1));
    end.setHours(23, 59, 59, 0);
    if (end >= start) {
      estimates.push({ type: ESTIMATE_TYPE, name: ESTIMATE_TYPE, start: localIso(start), end: localIso(end), term: study.term, estimated: true });
    }
  });
  return estimates;
}

/** A kézi beállítás két dátuma mint időszak; hibás vagy hiányos értékre null. */
export function parseManualPeriod(value: unknown): Period | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const { start, end } = value as Partial<ManualPeriod>;
  const valid = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(`${s}T00:00:00`).getTime());
  if (!valid(start) || !valid(end) || start > end) {
    return null;
  }
  return { type: MANUAL_TYPE, name: MANUAL_TYPE, start: `${start}T00:00:00`, end: `${end}T23:59:59` };
}

/** A Neptun időszakai, kiegészítve a vizsgaidőszakkal a bizalmi sorrend szerint. */
export function effectivePeriods(periods: Period[], manual: Period | null): Period[] {
  if (periods.some(period => kindOf(period) === "exam")) {
    return periods;
  }
  if (manual) {
    return [...periods, manual];
  }
  return [...periods, ...estimateExamPeriods(periods)];
}

export function getManualExamPeriod(): ManualPeriod | null {
  const value = storage.get<ManualPeriod>("weekLabel", "examPeriod");
  return value && typeof value === "object" ? value : null;
}

export function setManualExamPeriod(value: ManualPeriod | null): void {
  storage.set("weekLabel", "examPeriod", value);
}

/**
 * A naptár fejlécének első dátuma: „2026. október 12. - 2026. október 18."
 * vagy „2026. október 13."; havi nézetben („2026. október") nincs nap, null.
 */
const HEADER_DATE_RE = /(\d{4})\.\s*([a-záéíóöőúüű]+)\s*(\d{1,2})\./i;

export interface HeaderHit {
  anchor: HTMLElement;
  text: string;
  byId: boolean;
}

/**
 * A naptár fejlécének dátum-gombja. A BME-n azonosítója van; ha egy másik
 * intézmény Neptunja máshogy nevezi, a dátumszöveg alapján keressük meg.
 */
export function findHeader(root: ParentNode = document): HeaderHit | null {
  const byId = (root as Document).getElementById?.("toolbar-actual-date-btn") ?? root.querySelector<HTMLElement>("#toolbar-actual-date-btn");
  if (byId) {
    return { anchor: byId, text: byId.textContent?.trim() ?? "", byId: true };
  }
  for (const element of root.querySelectorAll<HTMLElement>("main button, main h4, main h3, main h2")) {
    const text = element.textContent?.trim() ?? "";
    if (text.length < 60 && HEADER_DATE_RE.test(text)) {
      return { anchor: element.closest<HTMLElement>("button") ?? element, text, byId: false };
    }
  }
  return null;
}

export function parseHeaderDate(text: string): Date | null {
  const match = HEADER_DATE_RE.exec(text);
  if (!match) {
    return null;
  }
  const month = MONTHS.indexOf(match[2].toLowerCase());
  if (month < 0) {
    return null;
  }
  return new Date(Number(match[1]), month, Number(match[3]));
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatApiDate(date: Date, endOfDay = false): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`;
}

export function periodsWindow(now: Date, days = WINDOW_DAYS): { startDate: string; endDate: string } {
  const start = new Date(now);
  start.setDate(start.getDate() - days);
  const end = new Date(now);
  end.setDate(end.getDate() + days);
  return { startDate: formatApiDate(start), endDate: formatApiDate(end, true) };
}

/** A naptár saját lekérdezése, csak az időszakokra szűkítve. */
export function periodsQuery(trainingIds: string[], now: Date, days = WINDOW_DAYS): string {
  const { startDate, endDate } = periodsWindow(now, days);
  const flags =
    "isPeriodsVisible=true&isClassesVisible=false&isExamsVisible=false&isFinalExamsVisible=false" +
    "&isOnlineMeetingsVisible=false&isOtherEventsVisible=false&isTasksVisible=false";
  const ids = trainingIds.map((id, i) => `&studentTrainingIds[${i}]=${encodeURIComponent(id)}`).join("");
  return `Calendar/GetCalendarEvents?startDate=${startDate}&endDate=${endDate}&${flags}${ids}`;
}

interface Training {
  studentTrainingId: string;
  isArchived?: boolean;
}

interface CalendarEvent {
  intervalType?: string;
  name?: string;
  startDate: string;
  endDate: string;
  term?: string;
}

interface Cached {
  at: number;
  periods: Period[];
}

function summarize(periods: Period[]): string {
  return periods.map(p => `${kindOf(p)} ${p.start.slice(0, 10)}…${p.end.slice(0, 10)}`).join(", ") || "nincs";
}

async function fetchPeriodEvents(ids: string[], now: Date): Promise<CalendarEvent[]> {
  try {
    return (await api<CalendarEvent[]>(periodsQuery(ids, now, WINDOW_DAYS))) ?? [];
  } catch (error) {
    // A BME egy évnél tágabb ablakra 500-at ad; más intézmény lehet, hogy
    // szűkebbre is. Egy rövidebb ablak a mostani félévet még lefedi.
    diag(`hétszám: a ±${WINDOW_DAYS} napos lekérés nem sikerült (${error instanceof Error ? error.message : String(error)}), szűkebb ablakkal újra`);
    return (await api<CalendarEvent[]>(periodsQuery(ids, now, NARROW_WINDOW_DAYS))) ?? [];
  }
}

export async function loadPeriods(now = new Date()): Promise<Period[]> {
  const user = (await ensureUser()) ?? "anon";
  const cached = storage.get<Cached>("weekLabel", user);
  if (cached && typeof cached.at === "number" && now.getTime() - cached.at < CACHE_MAX_AGE_MS && Array.isArray(cached.periods)) {
    diag(`hétszám: ${cached.periods.length} időszak a tárolóból (${summarize(cached.periods)})`, "routine");
    return cached.periods;
  }
  const trainings = (await api<Training[]>("MyTrainings")) ?? [];
  const active = trainings.filter(t => !t.isArchived);
  const ids = (active.length > 0 ? active : trainings).map(t => t.studentTrainingId).filter(Boolean);
  if (ids.length === 0) {
    diag("hétszám: a MyTrainings nem adott képzést, nincs mit lekérni");
    return [];
  }
  const events = await fetchPeriodEvents(ids, now);
  const periods: Period[] = events
    .filter(event => kindOf({ type: event.intervalType, name: event.name }) !== null)
    .map(event => ({
      type: event.intervalType ?? "",
      name: event.name ?? "",
      start: event.startDate,
      end: event.endDate,
      term: event.term,
    }));
  storage.set("weekLabel", user, { at: now.getTime(), periods } satisfies Cached);
  // Az intézmény időszak-típusai nem személyes adatok, és pont ezekből derül
  // ki, miért nincs címke egy másik egyetemen.
  const types = [...new Set(events.map(event => event.intervalType ?? "(típus nélkül)"))].sort().join(", ") || "semmi";
  if (periods.length === 0) {
    diag(`hétszám: a Neptun ${events.length} időszakot adott, de szorgalmi időszak nincs köztük — típusok: ${types}`);
  } else {
    diag(`hétszám: a Neptun ${events.length} időszakot adott (típusok: ${types}); felismerve: ${summarize(periods)}`, "routine");
  }
  return periods;
}

export const weekLabel: NpuModule = {
  id: "weekLabel",
  matches: path => path.startsWith("/calendar"),
  activate() {
    injectCss(`
      .npu-week-chip {
        display: inline-flex;
        align-items: center;
        margin-left: 10px;
        padding: 2px 10px;
        border-radius: 12px;
        background: #1b2a5e;
        color: #fff;
        font: 600 12px/1.6 system-ui, sans-serif;
        white-space: nowrap;
        vertical-align: middle;
      }
      .npu-week-chip--estimate {
        background: #eef2fb;
        color: #1b2a5e;
        border: 1px dashed #8a97c2;
        cursor: pointer;
      }
    `);
    let destroyed = false;
    let periods: Period[] | null = null;
    let chip: HTMLElement | null = null;
    let lastText = "";

    void loadPeriods()
      .then(loaded => {
        periods = loaded;
      })
      .catch(error => {
        periods = [];
        diag(`hétszám: az időszakok lekérése nem sikerült: ${error instanceof Error ? error.message : String(error)}`);
      });

    // A fejléc gombját az app újrarajzolja nézetváltáskor és lapozáskor, ezért
    // nem egy elemre akaszkodunk, hanem másodpercenként megnézzük, mi látszik.
    let missingTicks = 0;
    let fallbackLogged = false;
    const refresh = () => {
      if (destroyed || periods === null) {
        return;
      }
      const header = findHeader();
      if (!header) {
        missingTicks++;
        if (missingTicks === HEADER_MISSING_TICKS) {
          diag("hétszám: a naptár fejlécét (toolbar-actual-date-btn, vagy dátumszövegű gomb/cím) nem találom, címke nélkül");
        }
        chip?.remove();
        chip = null;
        lastText = "";
        return;
      }
      if (!header.byId && !fallbackLogged) {
        fallbackLogged = true;
        diag("hétszám: a naptár fejlécét azonosító nélkül, a dátumszöveg alapján találtam meg", "routine");
      }
      const { anchor, text } = header;
      const manualRaw = getManualExamPeriod();
      const key = `${text}|${JSON.stringify(manualRaw)}`;
      const attached = chip !== null && chip.previousElementSibling === anchor;
      if (key === lastText && attached) {
        return;
      }
      lastText = key;
      const date = parseHeaderDate(text);
      const info = date ? describeWeek(effectivePeriods(periods, parseManualPeriod(manualRaw)), date) : null;
      if (!info) {
        if (date) {
          diag(`hétszám: a mutatott hétre nincs időszak (${text})`, "routine");
        }
        chip?.remove();
        chip = null;
        return;
      }
      diag(`hétszám: ${info.estimated ? "≈ " : ""}${info.text} (${text})`, "routine");
      if (!attached) {
        chip?.remove();
        chip = document.createElement("span");
        chip.className = "npu-week-chip";
        // A becsült címke a beállításokhoz visz, ahol pontosítható.
        chip.addEventListener("click", () => {
          if (chip?.classList.contains("npu-week-chip--estimate")) {
            document.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT));
          }
        });
        anchor.insertAdjacentElement("afterend", chip);
      }
      chip!.classList.toggle("npu-week-chip--estimate", info.estimated);
      chip!.textContent = info.estimated ? `≈ ${info.text}` : info.text;
      chip!.title = info.estimated
        ? "Becslés: a szorgalmi időszak utáni hétfőtől számolva, mert a Neptun nem listázza a vizsgaidőszakot. " +
          "Kattints, és az NPU beállításaiban megadhatod a pontos dátumokat."
        : "";
    };
    const timer = window.setInterval(refresh, POLL_MS);

    return () => {
      destroyed = true;
      window.clearInterval(timer);
      chip?.remove();
      chip = null;
    };
  },
};
