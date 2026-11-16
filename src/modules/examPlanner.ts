import { api, ApiError, apiPost } from "../core/api";
import { diag } from "../core/diag";
import { log } from "../core/env";
import { cloneAppButton, inject, visibleText } from "../core/inject";
import type { NpuModule } from "../core/modules";
import { onApiCall } from "../core/netHook";
import * as storage from "../core/storage";
import { createPanel, el } from "../core/ui";
import { ensureUser, userKey } from "../core/user";

// The exam planner: the counterpart of the one-click subject registration
// (quickSignup) for exams. A student asked for it before an exam period: pick
// the exams while registration is still closed, then take them all with one
// click the moment it opens.
//
// Neptun lists the exams before the registration period starts (and even
// shows its own "Felvétel" button; the server is what refuses), so there is
// something to pick from. What it lacks is a planner of its own: the subject
// side rides on the app's Órarendtervező, here the plan is NPU's, kept in the
// userscript's storage, per student.
//
// Nothing here signs up on its own. Every signup starts from a click and a
// confirmation; the optional auto-retry only repeats a signup the student
// confirmed, exactly as on the subject side.
//
// What the server says (recorded in RECON.md):
//  - POST ExamRegistration/SignUpForExam { examId, courseId };
//  - a refusal is an HTTP 500 whose text is in notification[].description
//    ("A vizsgajelentkezés nem engedélyezett. Nincs vizsgajelentkezési
//    időszak!"), which ApiError carries to the card.

interface ServerExam {
  examId: string;
  courseId: string;
  courseExamId?: string;
  courseCode: string;
  examType: string;
  fromDate: string; // local time without an offset, e.g. "2026-12-14T14:00:00"
  strength?: number;
  maxStrength?: number | null;
  waitingStrength?: number;
  waitingListNumber?: number;
  examTutors?: string;
  examSignin?: boolean;
  examSignInId?: string | null;
}

interface ServerSubject {
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  examList?: ServerExam[];
}

export interface ListedExam extends ServerExam {
  key: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
}

export interface PlannedExam {
  key: string;
  examId: string;
  courseId: string;
  courseExamId: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  courseCode: string;
  examType: string;
  examTutors: string;
  fromDate: string;
  addedAt: string;
}

export const PLAN_EVENT = "npu:exam-plan-changed";
const EXAM_LIST_PATH = "ExamRegistration/GetExamsList";
const SIGNUP_PATH = "ExamRegistration/SignUpForExam";
// The app's calls after which the list we show may be out of date.
const MUTATING_PATHS = [SIGNUP_PATH, "ExamRegistration/UnSubscribe", "Exam/ChangeExam"];

const RETRY_INTERVAL_MS = 10_000;
const MAX_RETRIES = 30;
const HOOK_DEBOUNCE_MS = 400;
// Head counts change slowly outside the opening rush, and during it the
// student is clicking, not reading them.
const POLL_MS = 60_000;

export function planKey(examId: string, courseId: string): string {
  return `${examId}:${courseId}`;
}

/** The server groups exams by subject; a card and a row need them one by one. */
export function flattenExams(subjects: ServerSubject[] | null | undefined): ListedExam[] {
  const exams: ListedExam[] = [];
  (subjects ?? []).forEach(subject => {
    (subject?.examList ?? []).forEach(exam => {
      if (!exam?.examId || !exam.courseId) {
        return;
      }
      exams.push({
        ...exam,
        key: planKey(exam.examId, exam.courseId),
        subjectId: subject.subjectId,
        subjectCode: subject.subjectCode ?? "",
        subjectName: subject.subjectName ?? "",
      });
    });
  });
  return exams;
}

export async function fetchExams(): Promise<ListedExam[]> {
  // The very query the app sends on this page: no term means the current one.
  const subjects = await api<ServerSubject[]>(`${EXAM_LIST_PATH}?sortAndPage.firstRow=0&sortAndPage.lastRow=9999`);
  return flattenExams(subjects);
}

// --- the plan, stored per student ------------------------------------------
//
// Per student for the same reason as the course watches: logging out and in
// is only a route change, and one student's plan must never offer its signup
// buttons to the next one on the same machine. Until the Neptun code is
// known there is no plan.
const PLAN_ROOT = "examPlanByUser";

export function getPlan(): Record<string, PlannedExam> {
  const user = userKey();
  if (!user) {
    return {};
  }
  return storage.get<Record<string, PlannedExam>>(PLAN_ROOT, user) ?? {};
}

export function isPlanned(examId: string, courseId: string): boolean {
  return !!getPlan()[planKey(examId, courseId)];
}

function announce(): void {
  document.dispatchEvent(new CustomEvent(PLAN_EVENT));
}

export function addToPlan(exam: ListedExam): void {
  const user = userKey();
  if (!user) {
    return;
  }
  const planned: PlannedExam = {
    key: exam.key,
    examId: exam.examId,
    courseId: exam.courseId,
    courseExamId: exam.courseExamId ?? "",
    subjectId: exam.subjectId,
    subjectCode: exam.subjectCode,
    subjectName: exam.subjectName,
    courseCode: exam.courseCode ?? "",
    examType: exam.examType ?? "",
    examTutors: exam.examTutors ?? "",
    fromDate: exam.fromDate,
    addedAt: new Date().toISOString(),
  };
  storage.set(PLAN_ROOT, user, exam.key, planned);
  announce();
}

export function removeFromPlan(key: string): void {
  const user = userKey();
  if (!user || !getPlan()[key]) {
    return;
  }
  storage.set(PLAN_ROOT, user, key, null);
  announce();
}

/** Drops the exams that have already started: there is nothing left to sign up for. */
export function prunePast(now: Date = new Date()): void {
  Object.values(getPlan()).forEach(planned => {
    const start = localTime(planned.fromDate);
    if (start && start.getTime() <= now.getTime()) {
      removeFromPlan(planned.key);
    }
  });
}

// --- reading the server's dates --------------------------------------------

interface DateParts {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
}

// The server sends wall-clock time without an offset. Read as written, never
// through a time zone: what the student sees in the list is exactly this.
function partsOf(value: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value ?? "");
  return match
    ? { year: +match[1], month: +match[2], day: +match[3], hour: +match[4], minute: +match[5] }
    : null;
}

function localTime(value: string): Date | null {
  const parts = partsOf(value);
  return parts ? new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) : null;
}

const HU_MONTHS = ["január", "február", "március", "április", "május", "június", "július", "augusztus", "szeptember", "október", "november", "december"];

export function formatWhen(fromDate: string): string {
  const parts = partsOf(fromDate);
  if (!parts) {
    return fromDate;
  }
  return `${parts.year}. ${HU_MONTHS[parts.month - 1]} ${parts.day}. ${parts.hour}:${String(parts.minute).padStart(2, "0")}`;
}

// --- tying a row of Neptun's table to an exam ------------------------------
//
// The rows carry no ids, only what the student reads: the subject above the
// table, the date, the course code. A planner button on the wrong row would
// plan the wrong exam, so a row is matched only when exactly one known exam
// fits everything it shows; anything ambiguous gets no button at all.

export interface RowFacts {
  subjectCode: string;
  subjectName: string;
  dateText: string;
  courseCode: string;
}

// Distinguishing prefixes of the month names in the two languages the app
// speaks ("szep", not "sze": Wednesday is "szerda").
const MONTH_PREFIXES: string[][] = [
  ["jan"], ["feb"], ["már", "mar"], ["ápr", "apr"], ["máj", "may"], ["jún", "jun"],
  ["júl", "jul"], ["aug"], ["szep", "sep"], ["okt", "oct"], ["nov"], ["dec"],
];

function monthOfWord(word: string): number | null {
  const index = MONTH_PREFIXES.findIndex(prefixes => prefixes.some(prefix => word.startsWith(prefix)));
  return index >= 0 ? index + 1 : null;
}

function dateTextShows(text: string, parts: DateParts): boolean {
  const lower = (text ?? "").toLowerCase();
  const time = /(\d{1,2}):(\d{2})/.exec(lower);
  if (!time) {
    return false;
  }
  let hour = +time[1];
  const words: string[] = lower.match(/\p{L}+/gu) ?? [];
  if (words.includes("pm") && hour < 12) {
    hour += 12;
  }
  if (words.includes("am") && hour === 12) {
    hour = 0;
  }
  if (hour !== parts.hour || +time[2] !== parts.minute) {
    return false;
  }
  const numbers = (lower.replace(time[0], " ").match(/\d+/g) ?? []).map(Number);
  const take = (value: number): boolean => {
    const index = numbers.indexOf(value);
    if (index < 0) {
      return false;
    }
    numbers.splice(index, 1);
    return true;
  };
  if (!take(parts.year) || !take(parts.day)) {
    return false;
  }
  const namedMonths = words.map(monthOfWord).filter((month): month is number => month !== null);
  // A written-out month decides; a numeric date has to show the month's number.
  return namedMonths.length > 0 ? namedMonths.includes(parts.month) : take(parts.month);
}

const squash = (value: string): string => (value ?? "").replace(/\s+/g, "").toUpperCase();

export function matchExam(row: RowFacts, exams: ListedExam[]): ListedExam | null {
  const code = squash(row.subjectCode);
  const name = squash(row.subjectName);
  const course = squash(row.courseCode);
  if ((!code && !name) || !course) {
    return null;
  }
  const fits = exams.filter(exam => {
    if (code ? squash(exam.subjectCode) !== code : squash(exam.subjectName) !== name) {
      return false;
    }
    if (squash(exam.courseCode) !== course) {
      return false;
    }
    const parts = partsOf(exam.fromDate);
    return !!parts && dateTextShows(row.dateText, parts);
  });
  return fits.length === 1 ? fits[0] : null;
}

// --- what a card says about an exam ----------------------------------------

export type ExamState = "registered" | "full" | "open";

export function examState(exam: ServerExam): ExamState {
  if (exam.examSignin === true || !!exam.examSignInId) {
    return "registered";
  }
  const limit = exam.maxStrength ?? 0;
  return limit > 0 && (exam.strength ?? 0) >= limit ? "full" : "open";
}

export function describeExam(exam: ListedExam): string {
  const taken = exam.strength ?? 0;
  const parts = [exam.courseCode, exam.examTutors, exam.maxStrength ? `${taken}/${exam.maxStrength} fő` : `${taken} fő`];
  if (examState(exam) === "full") {
    parts.push("BETELT");
  }
  if ((exam.waitingStrength ?? 0) > 0) {
    parts.push(`${exam.waitingStrength} várólistán`);
  }
  return parts.filter(Boolean).join(" · ");
}

/** Signs up for one exam, with exactly the request the app's own button sends. */
export function signUp(exam: { examId: string; courseId: string }): Promise<{ isWaiting: boolean }> {
  return apiPost<{ isWaiting?: boolean } | null>(SIGNUP_PATH, { examId: exam.examId, courseId: exam.courseId }).then(
    response => ({ isWaiting: response?.data?.isWaiting === true })
  );
}

// --- the page ---------------------------------------------------------------

interface Card {
  planned: PlannedExam;
  element: HTMLElement;
  actions: HTMLElement;
  errorBox: HTMLElement;
  attempts: number;
  status: "idle" | "signing" | "done";
  /** When we saw the signup succeed; a list older than this cannot undo it. */
  doneAt: number;
  doneText: string;
  retryEnabled: boolean;
  retryTimer?: number;
}

function rowFacts(row: HTMLElement): RowFacts | null {
  // The subject's title sits above the table, in the nearest block that has one.
  let title: Element | null = null;
  for (let node = row.parentElement; node && !title; node = node.parentElement) {
    title = node.querySelector(":scope > neptun-secondary-title");
    if (node.tagName === "NEPTUN-EXAM-REGISTRATION") {
      break;
    }
  }
  const dateText = visibleText(row.querySelector(".cdk-column-fromDate"));
  const courseCode = visibleText(row.querySelector(".cdk-column-courseCode"));
  if (!title || !dateText || !courseCode) {
    return null;
  }
  return {
    subjectName: visibleText(title.querySelector(".title-wrapper__title")),
    subjectCode: visibleText(title.querySelector(".title-wrapper__description")),
    dateText,
    courseCode,
  };
}

export const examPlanner: NpuModule = {
  id: "examPlanner",
  matches: path => path.startsWith("/exams/overview/registration"),
  activate() {
    // Bottom left by default: the exam overview panel owns the top right, and
    // the rows the planner buttons sit on start at the top of the page.
    const panel = createPanel("npu-exam-planner", "NPU · Vizsgatervező", () => ({
      left: 10,
      height: 300,
      top: Math.max(90, window.innerHeight - 300 - 44),
    }));
    let destroyed = false;

    const header = el(`<div class="npu-note">Vizsgák betöltése...</div>`);
    const reloadNote = el(
      `<div class="npu-note" style="display:none">A Neptun saját listája az oldal újratöltése után mutatja a ` +
        `felvételt. <button class="npu-button npu-button--subtle" type="button" style="padding:1px 6px">Újratöltés</button></div>`
    );
    reloadNote.querySelector("button")!.addEventListener("click", () => window.location.reload());
    // Kept in the layout even when unusable, so cards never jump under the cursor.
    const allButton = el(`<button class="npu-button" type="button" style="width:100%; visibility:hidden"></button>`) as HTMLButtonElement;
    const list = el(`<div class="npu-list" style="margin-top:8px"></div>`);
    const emptyNote = el(
      `<div class="npu-note" style="display:none">Még nincs betervezett vizsga. A vizsgalista soraiban az ` +
        `„NPU: tervezőbe” gombbal válogathatsz, akár a jelentkezés nyitása előtt is; nyitás után innen egy ` +
        `kattintással felveheted őket.</div>`
    );
    panel.body.append(header, reloadNote, allButton, list, emptyNote);

    const cards = new Map<string, Card>();
    const timers = new Set<number>();
    // Everything we have seen listed, for the cards' details and for matching rows.
    const known = new Map<string, ListedExam>();
    // Our own latest full list, and when it was asked for: the only thing
    // allowed to say "registered" or "not registered any more".
    let own = new Map<string, ListedExam>();
    let ownAsOf = 0;
    let rowSignature = "";
    let refreshing = false;
    let refreshQueued = false;
    let consecutiveErrors = 0;
    let debounceTimer: number | undefined;
    let wasVisible = document.visibilityState === "visible";

    const setHeader = (text: string, isError = false) => {
      header.textContent = text;
      header.className = isError ? "npu-error" : "npu-note";
    };

    const stopRetry = (card: Card) => {
      if (card.retryTimer !== undefined) {
        window.clearInterval(card.retryTimer);
        timers.delete(card.retryTimer);
        card.retryTimer = undefined;
      }
    };

    const describePlanned = (planned: PlannedExam): string =>
      `${planned.subjectName}\n${formatWhen(planned.fromDate)} · ${planned.courseCode}` +
      (planned.examTutors ? ` · ${planned.examTutors}` : "");

    const removeButton = (card: Card): HTMLButtonElement => {
      const button = el(
        `<button class="npu-button npu-button--subtle" type="button" style="padding:1px 6px;margin-left:auto" ` +
          `title="Kivétel a tervezőből">Kivesz</button>`
      ) as HTMLButtonElement;
      button.addEventListener("click", () => removeFromPlan(card.planned.key));
      return button;
    };

    const renderActions = (card: Card): void => {
      card.actions.innerHTML = "";
      if (card.status === "done") {
        const text = el(`<span class="npu-item__meta"></span>`);
        text.textContent = card.doneText;
        card.actions.append(text, removeButton(card));
        return;
      }
      const button = el(`<button class="npu-button" type="button">${card.attempts > 0 ? "Újra" : "Felvétel"}</button>`) as HTMLButtonElement;
      const retryLabel = el(
        `<label class="npu-item__meta" style="display:flex;align-items:center;gap:4px;cursor:pointer">` +
          `<input type="checkbox" class="npu-retry">auto-újrapróba</label>`
      );
      const retryBox = retryLabel.querySelector<HTMLInputElement>(".npu-retry")!;
      retryBox.checked = card.retryEnabled;
      button.disabled = card.status === "signing";
      button.addEventListener("click", () => {
        // Always confirm, including a repeat: a click that landed on the wrong
        // card must not sign anyone up for anything.
        if (confirm(`Jelentkezel erre a vizsgára?\n\n${describePlanned(card.planned)}`)) {
          void attemptSignup(card, false);
        }
      });
      retryBox.addEventListener("change", () => {
        card.retryEnabled = retryBox.checked;
        if (!card.retryEnabled) {
          stopRetry(card);
        }
      });
      card.actions.append(button, retryLabel, removeButton(card));
    };

    const markDone = (card: Card, text: string): void => {
      stopRetry(card);
      card.status = "done";
      card.doneAt = Date.now();
      card.doneText = text;
      card.retryEnabled = false;
      card.errorBox.style.display = "none";
      renderActions(card);
    };

    const attemptSignup = async (card: Card, viaRetry: boolean) => {
      card.attempts++;
      card.status = "signing";
      const button = card.actions.querySelector<HTMLButtonElement>(".npu-button");
      if (button) {
        button.disabled = true;
        button.textContent = viaRetry ? `Próba #${card.attempts}...` : "Felvétel...";
      }
      try {
        const result = await signUp(card.planned);
        markDone(card, result.isWaiting ? "várólistára kerültél" : "sikeresen felvéve ✓");
        reloadNote.style.display = "block";
        diag(`vizsgatervező: jelentkezés sikeres (${card.attempts}. próba)`);
        log(`exam signup succeeded for ${card.planned.subjectCode}`);
        updateSummary();
        void refresh();
      } catch (error) {
        card.status = "idle";
        const message = error instanceof ApiError ? error.message : String(error);
        const status = error instanceof ApiError ? `HTTP ${error.status}` : "hálózati hiba";
        diag(`vizsgatervező: jelentkezés elutasítva (${status}, ${card.attempts}. próba)`, "routine");
        card.errorBox.textContent = `${new Date().toLocaleTimeString("hu-HU")} · ${message}`;
        card.errorBox.style.display = "block";
        renderActions(card);
        // Never arm a timer after cleanup: nothing would be left to clear it.
        if (!destroyed && card.retryEnabled && card.attempts < MAX_RETRIES && card.retryTimer === undefined) {
          const timer = window.setInterval(() => {
            if (destroyed || !card.retryEnabled || card.attempts >= MAX_RETRIES || card.status === "done") {
              stopRetry(card);
              return;
            }
            if (card.status === "signing") {
              return; // the previous attempt is still in flight
            }
            void attemptSignup(card, true);
          }, RETRY_INTERVAL_MS);
          card.retryTimer = timer;
          timers.add(timer);
        }
      }
    };

    const createCard = (planned: PlannedExam): Card => {
      const element = el(
        `<div class="npu-item">` +
          `<div class="npu-item__title"></div>` +
          `<div class="npu-item__meta npu-exam-when"></div>` +
          `<div class="npu-item__meta npu-exam-detail"></div>` +
          `<div class="npu-actions" style="margin-top:6px; display:flex; gap:8px; align-items:center; flex-wrap:wrap"></div>` +
          `<div class="npu-error" style="display:none"></div>` +
          `</div>`
      );
      const card: Card = {
        planned,
        element,
        actions: element.querySelector<HTMLElement>(".npu-actions")!,
        errorBox: element.querySelector<HTMLElement>(".npu-error")!,
        attempts: 0,
        status: "idle",
        doneAt: 0,
        doneText: "",
        retryEnabled: false,
      };
      renderActions(card);
      return card;
    };

    const updateCard = (card: Card, planned: PlannedExam): void => {
      card.planned = planned;
      const live = known.get(planned.key);
      const current = own.get(planned.key);

      if (current && card.status !== "signing") {
        const registered = examState(current) === "registered";
        if (registered && card.status !== "done") {
          markDone(card, (current.waitingListNumber ?? 0) > 0 ? "várólistán vagy" : "felvéve ✓");
        } else if (!registered && card.status === "done" && ownAsOf > card.doneAt) {
          // Dropped again (in the app, or elsewhere): make it actionable.
          card.status = "idle";
          card.attempts = 0;
          renderActions(card);
        }
      }

      // textContent throughout: these strings come from the server.
      card.element.querySelector<HTMLElement>(".npu-item__title")!.textContent = planned.subjectName;
      card.element.querySelector<HTMLElement>(".npu-exam-when")!.textContent =
        [formatWhen(planned.fromDate), planned.examType, planned.subjectCode].filter(Boolean).join(" · ");
      const missing = ownAsOf > 0 && !current && card.status !== "done";
      card.element.querySelector<HTMLElement>(".npu-exam-detail")!.textContent = missing
        ? `${[planned.courseCode, planned.examTutors].filter(Boolean).join(" · ")} · most nem szerepel a vizsgalistán`
        : live
          ? describeExam(live)
          : [planned.courseCode, planned.examTutors].filter(Boolean).join(" · ");
      const colour =
        card.status === "done" ? "green" : missing || (live && examState(live) === "full") ? "yellow" : "blue";
      card.element.className = `npu-item npu-item--${colour}`;
    };

    const updateSummary = (): void => {
      const idle = [...cards.values()].filter(card => card.status === "idle");
      emptyNote.style.display = cards.size === 0 ? "block" : "none";
      allButton.style.visibility = idle.length > 1 ? "visible" : "hidden";
      allButton.disabled = idle.length < 2;
      allButton.textContent = `Mindet felveszi (${idle.length})`;
    };

    const render = (): void => {
      if (destroyed) {
        return;
      }
      const plan = Object.values(getPlan()).sort((a, b) => a.fromDate.localeCompare(b.fromDate));
      const wanted = new Set(plan.map(planned => planned.key));
      cards.forEach((card, key) => {
        // A card in the middle of a signup stays until that signup settles.
        if (!wanted.has(key) && card.status !== "signing") {
          stopRetry(card);
          card.element.remove();
          cards.delete(key);
        }
      });
      plan.forEach(planned => {
        let card = cards.get(planned.key);
        if (!card) {
          card = createCard(planned);
          cards.set(planned.key, card);
        }
        updateCard(card, planned);
        list.appendChild(card.element); // also puts the cards in date order
      });
      updateSummary();
    };

    allButton.addEventListener("click", () => {
      const idle = [...cards.values()].filter(card => card.status === "idle");
      if (idle.length === 0) {
        return;
      }
      const lines = idle.map(card => `• ${card.planned.subjectName}, ${formatWhen(card.planned.fromDate)}`).join("\n");
      if (confirm(`Jelentkezel mind a(z) ${idle.length} betervezett vizsgára?\n\n${lines}`)) {
        // One after the other: Neptun takes one signup at a time, and parallel
        // calls would also stampede the token refresh.
        void (async () => {
          for (const card of idle) {
            if (destroyed) {
              return;
            }
            if (card.status === "idle" && cards.get(card.planned.key) === card) {
              await attemptSignup(card, false);
            }
          }
        })();
      }
    });

    // --- the planner button on Neptun's own rows ----------------------------
    const examOfRow = (row: HTMLElement): ListedExam | null => {
      const facts = rowFacts(row);
      return facts ? matchExam(facts, [...known.values()]) : null;
    };

    const rowControls = inject({
      id: "exam-plan",
      hostSelector: "neptun-exam-registration tr.mat-mdc-row",
      attach(row) {
        const actions =
          row.querySelector<HTMLElement>("td.table-actions .table-actions__wrapper") ??
          row.querySelector<HTMLElement>("td.table-actions");
        if (!actions) {
          return false;
        }
        const exam = examOfRow(row);
        if (!exam) {
          return false; // list not loaded yet, or the row is not unambiguous
        }
        if (examState(exam) === "registered") {
          return true; // already taken: nothing to plan
        }
        const planned = isPlanned(exam.examId, exam.courseId);
        const label = planned ? "NPU: tervezve ✓" : "NPU: tervezőbe";
        const button = cloneAppButton(actions.querySelector<HTMLElement>("button.table-action"), label);
        button.dataset.npuControl = "exam-plan";
        button.setAttribute("aria-label", label);
        button.removeAttribute("aria-describedby");
        button.title = planned ? "Kivétel az NPU vizsgatervezőjéből" : "Hozzáadás az NPU vizsgatervezőjéhez";
        button.addEventListener("click", event => {
          event.stopPropagation();
          // Resolve again at click time: Angular reuses rows, and after a
          // re-sort this one may show a different exam.
          const now = examOfRow(row);
          if (!now) {
            return;
          }
          if (isPlanned(now.examId, now.courseId)) {
            removeFromPlan(now.key);
          } else {
            addToPlan(now);
          }
        });
        actions.insertBefore(button, actions.firstChild);
        return true;
      },
    });

    // The buttons depend on the list and on the plan; redraw them only when
    // either really changed, so the periodic refresh does not make them blink.
    const syncRows = (): void => {
      const signature =
        [...known.values()].map(exam => `${exam.key}:${examState(exam) === "registered" ? 1 : 0}`).sort().join("|") +
        "#" +
        Object.keys(getPlan()).sort().join("|");
      if (signature !== rowSignature) {
        rowSignature = signature;
        rowControls.refresh();
      }
    };

    const remember = (exams: ListedExam[]): void => {
      exams.forEach(exam => known.set(exam.key, exam));
    };

    const refresh = async (): Promise<void> => {
      if (destroyed) {
        return;
      }
      if (refreshing) {
        refreshQueued = true;
        return;
      }
      refreshing = true;
      const askedAt = Date.now();
      try {
        await ensureUser();
        const exams = await fetchExams();
        if (destroyed) {
          return;
        }
        own = new Map(exams.map(exam => [exam.key, exam]));
        ownAsOf = askedAt;
        remember(exams);
        consecutiveErrors = 0;
        prunePast();
        setHeader(
          `Betervezett vizsgák: a jelentkezés nyitása után innen egy kattintással felveheted őket ` +
            `(frissítve ${new Date().toLocaleTimeString("hu-HU")}).`
        );
      } catch (error) {
        // One hiccup in the opening rush should not paint the panel red.
        consecutiveErrors++;
        if (consecutiveErrors >= 2 || ownAsOf === 0) {
          setHeader(`A vizsgalista nem töltődött be: ${error instanceof Error ? error.message : error}`, true);
        }
      } finally {
        refreshing = false;
        if (!destroyed) {
          render();
          syncRows();
          if (refreshQueued) {
            refreshQueued = false;
            void refresh();
          }
        }
      }
    };

    // The app's own list responses cover what our query may not (another term
    // picked in its filter), and its signups and drops change what we show.
    const unsubscribe = onApiCall(call => {
      if (call.status < 200 || call.status >= 300) {
        return;
      }
      if (call.path === EXAM_LIST_PATH) {
        remember(flattenExams(call.json<{ data: ServerSubject[] }>()?.data ?? null));
        render();
        syncRows();
      }
      if (MUTATING_PATHS.includes(call.path)) {
        window.clearTimeout(debounceTimer);
        debounceTimer = window.setTimeout(() => void refresh(), HOOK_DEBOUNCE_MS);
      }
    });

    const onPlanChanged = () => {
      render();
      syncRows();
    };
    document.addEventListener(PLAN_EVENT, onPlanChanged);

    const pollTimer = window.setInterval(() => {
      if (!destroyed && document.visibilityState === "visible") {
        void refresh();
      }
    }, POLL_MS);

    // Only a genuine hidden→visible transition is a reason to catch up;
    // keepAlive dispatches synthetic visibilitychange events of its own.
    const onVisible = () => {
      const visible = document.visibilityState === "visible";
      if (visible && !wasVisible) {
        void refresh();
      }
      wasVisible = visible;
    };
    document.addEventListener("visibilitychange", onVisible);

    void ensureUser().then(() => {
      if (!destroyed) {
        diag(`vizsgatervező: ${Object.keys(getPlan()).length} betervezett vizsga`, "routine");
        render();
      }
    });
    void refresh();

    return () => {
      destroyed = true;
      unsubscribe();
      rowControls();
      window.clearTimeout(debounceTimer);
      window.clearInterval(pollTimer);
      document.removeEventListener(PLAN_EVENT, onPlanChanged);
      document.removeEventListener("visibilitychange", onVisible);
      timers.forEach(timer => window.clearInterval(timer));
      timers.clear();
      cards.clear();
      panel.destroy();
    };
  },
};
