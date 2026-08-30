import { api, ApiError, apiPost } from "../core/api";
import { log } from "../core/env";
import type { NpuModule } from "../core/modules";
import { observedCallCount, onApiCall } from "../core/netHook";
import { el, createPanel } from "../core/ui";
import * as storage from "../core/storage";
import { addWatch, getWatches, isWatched, removeWatch, watchKey } from "./courseWatch";

// One-click registration of the courses planned in the built-in schedule
// planner (Órarendtervező).
//
// The signin payload needs the course id (`id`), NOT the planner record id
// (`scheduledCourseId`) — the app's own signin code sends the ids of the
// course rows. Query parameters take the numeric term id, the payload the
// term GUID.
//
// The panel tracks the planner live: the user adds and removes courses on
// this same SPA page, so a one-shot render goes stale immediately. Changes
// are detected two ways — instantly from the app's own API calls, and by
// polling a cheap endpoint as a fallback for when the hook cannot observe
// the page (isolated userscript world). Rendering reconciles existing cards
// instead of rebuilding them, so a refresh never disturbs a running
// auto-retry or an in-flight signin.
//
// No feedback loop: refresh() only issues GETs, and none of those paths are
// in MUTATING_PATHS. Our own SubjectSignin does match, which costs exactly
// one extra refresh — by design, since the planner did change.

interface SubjectTerm {
  text: string;
  value: number;
  isActualTerm: boolean;
}

interface ScheduledCourse {
  id: string; // course id, goes into courseIds
  scheduledCourseId: string | null; // planner record; null once registered
  subjectId: string;
  curriculumTemplateId: string;
  curriculumTemplateLineId: string;
  termId: string; // GUID
  title: string;
  code: string;
  type: string;
  subjectCredit: number;
  isRegistered: boolean;
  isFull: boolean;
  strength: number;
  maxLimit: number | null;
  waitingStudentsCount: number;
}

interface PlannedSubjectLite {
  id: string;
  curriculumTemplateLineId: string;
  isRegistered: boolean;
  scheduledCourseIds: string[];
}

interface PlannedSubject {
  key: string;
  subjectId: string;
  curriculumTemplateId: string;
  curriculumTemplateLineId: string;
  termId: string;
  title: string;
  credit: number;
  courses: ScheduledCourse[];
}

interface SigninResult {
  indexLineId: string;
  isWaiting: boolean;
}

// Card state lives outside the DOM so re-rendering cannot lose it.
interface Card {
  subject: PlannedSubject;
  /** Identity of the course set the user last saw and confirmed against. */
  courseSignature: string;
  element: HTMLElement;
  coursesBox: HTMLElement;
  actions: HTMLElement;
  errorBox: HTMLElement;
  attempts: number;
  status: "idle" | "signing" | "done";
  retryEnabled: boolean;
  retryTimer?: number;
}

const RETRY_INTERVAL_MS = 10_000;
const MAX_RETRIES = 30;
// Coalesce bursts: removing a subject with several courses fires one
// UnScheduleCourse per course, and each would otherwise trigger a render of a
// half-removed subject.
const HOOK_DEBOUNCE_MS = 400;
// The lightweight planner endpoint is ~0.9 KB, so polling it is cheap. Once
// the hook is proven to work it only needs to be a safety net.
const POLL_FAST_MS = 6_000;
const POLL_SLOW_MS = 30_000;
// Course head counts only come from the heavy endpoint; refresh them rarely.
const DETAIL_REFRESH_MS = 30_000;

const MUTATING_PATHS = [
  "SubjectApplication/ScheduleSubjectAndCourses",
  "SubjectApplication/UnScheduleCourse",
  "SubjectApplication/DeleteAllScheduledScheduledSubjects",
  "SubjectApplication/SubjectSignin",
  "SubjectApplication/SubjectSignout",
  "SubjectApplication/CourseChange",
];

function subjectKey(subjectId: string, lineId: string): string {
  return `${subjectId}|${lineId}`;
}

function courseSignatureOf(courses: { id: string }[]): string {
  return courses
    .map(course => course.id)
    .sort()
    .join(",");
}

// Groups planned (not yet registered) courses into per-subject entries.
function groupPlannedSubjects(courses: ScheduledCourse[]): PlannedSubject[] {
  const groups = new Map<string, PlannedSubject>();
  courses
    .filter(course => course.scheduledCourseId !== null && !course.isRegistered)
    .forEach(course => {
      const key = subjectKey(course.subjectId, course.curriculumTemplateLineId);
      const group = groups.get(key);
      if (group) {
        group.courses.push(course);
        return;
      }
      groups.set(key, {
        key,
        subjectId: course.subjectId,
        curriculumTemplateId: course.curriculumTemplateId,
        curriculumTemplateLineId: course.curriculumTemplateLineId,
        termId: course.termId,
        title: course.title,
        credit: course.subjectCredit,
        courses: [course],
      });
    });
  return [...groups.values()];
}

// Identity of the current planner contents; used to skip needless re-renders.
function signatureOf(subjects: { key: string; courseIds: string[] }[]): string {
  return subjects
    .map(s => `${s.key}:${[...s.courseIds].sort().join(",")}`)
    .sort()
    .join("|");
}

function signin(subject: PlannedSubject): Promise<SigninResult> {
  return apiPost<SigninResult>("SubjectApplication/SubjectSignin", {
    courseIds: subject.courses.map(course => course.id),
    curriculumTemplateId: subject.curriculumTemplateId,
    curriculumTemplateLineId: subject.curriculumTemplateLineId,
    subjectId: subject.subjectId,
    termId: subject.termId,
  }).then(response => response.data);
}

function describeCourse(course: ScheduledCourse): string {
  const limit = course.maxLimit ? `${course.strength}/${course.maxLimit}` : `${course.strength}`;
  const full = course.isFull ? " · BETELT" : "";
  const waiting = course.waitingStudentsCount > 0 ? ` · ${course.waitingStudentsCount} várólistán` : "";
  return `${course.code} (${course.type}) · ${limit} fő${full}${waiting}`;
}

export const quickSignup: NpuModule = {
  id: "quickSignup",
  matches: path => path.startsWith("/subjects/registration"),
  activate() {
    const panel = createPanel("npu-quick-signup", "NPU · Gyorsfelvétel");
    let destroyed = false;

    const header = el(`<div class="npu-note">Betervezett kurzusok betöltése...</div>`);
    const list = el(`<div class="npu-list"></div>`);
    const emptyNote = el(
      `<div class="npu-note" style="display:none">Nincs betervezett kurzus. Tervezz be kurzusokat az ` +
        `Órarendtervezőben (a tárgy alatti „Tervezőhöz adás” kapcsolóval), és itt egy kattintással ` +
        `felveheted őket.</div>`
    );
    // Kept in the layout even when unusable, so cards never jump under the
    // cursor when the count crosses the threshold.
    const allButton = el(
      `<button class="npu-button" style="width:100%; visibility:hidden"></button>`
    ) as HTMLButtonElement;
    const watchSection = el(`<div class="npu-watchlist" style="display:none"></div>`);
    panel.body.append(header, allButton, list, emptyNote, watchSection);

    const cards = new Map<string, Card>();
    // Every timer we ever arm, so cleanup can clear one that was armed by a
    // signin which settled after cleanup started.
    const timers = new Set<number>();
    let term: SubjectTerm | null = null;
    let lastSignature: string | null = null;
    let lastDetailFetch = 0;
    let refreshing = false;
    let refreshQueued = false;
    let consecutiveErrors = 0;
    let debounceTimer: number | undefined;
    let pendingSubjects: PlannedSubject[] | null = null;
    let wasVisible = document.visibilityState === "visible";

    const stopRetry = (card: Card) => {
      if (card.retryTimer !== undefined) {
        window.clearInterval(card.retryTimer);
        timers.delete(card.retryTimer);
        card.retryTimer = undefined;
      }
    };

    const renderActions = (card: Card): void => {
      card.actions.innerHTML = "";
      if (card.status === "done") {
        return;
      }
      const button = el(
        `<button class="npu-button">${card.attempts > 0 ? "Újra" : "Felvétel"}</button>`
      ) as HTMLButtonElement;
      const retryLabel = el(
        `<label class="npu-item__meta" style="display:flex;align-items:center;gap:4px;cursor:pointer">` +
          `<input type="checkbox" class="npu-retry">auto-újrapróba</label>`
      );
      const retryBox = retryLabel.querySelector<HTMLInputElement>(".npu-retry")!;
      retryBox.checked = card.retryEnabled;
      button.disabled = card.status === "signing";

      button.addEventListener("click", () => {
        // Snapshot what the user is looking at: a refresh must never swap the
        // course set out from under an approved signin.
        const subject = card.subject;
        const courseList = subject.courses.map(c => c.code).join(", ");
        // Always confirm, including retries: a click that landed on the wrong
        // card (after a refresh shifted the list) must not register anything.
        if (confirm(`Felveszed a(z) "${subject.title}" tárgyat?\n\nKurzusok: ${courseList}`)) {
          void attemptSignin(card, subject, false);
        }
      });
      retryBox.addEventListener("change", () => {
        card.retryEnabled = retryBox.checked;
        if (!card.retryEnabled) {
          stopRetry(card);
        }
      });
      card.actions.append(button, retryLabel);
    };

    const attemptSignin = async (card: Card, subject: PlannedSubject, viaRetry: boolean) => {
      card.attempts++;
      card.status = "signing";
      const button = card.actions.querySelector<HTMLButtonElement>(".npu-button");
      if (button) {
        button.disabled = true;
        button.textContent = viaRetry ? `Próba #${card.attempts}...` : "Felvétel...";
      }
      try {
        const result = await signin(subject);
        stopRetry(card);
        card.status = "done";
        card.retryEnabled = false;
        card.element.className = "npu-item npu-item--green";
        card.errorBox.style.display = "none";
        card.actions.innerHTML = "";
        card.actions.appendChild(
          el(`<span class="npu-item__meta">${result.isWaiting ? "várólistára kerültél" : "sikeresen felvéve ✓"}</span>`)
        );
        log(`subject ${subject.title} signed in (waiting: ${result.isWaiting})`);
        void refresh({ force: true });
      } catch (error) {
        card.status = "idle";
        const message = error instanceof ApiError ? error.message : String(error);
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
              return; // a previous attempt is still in flight
            }
            void attemptSignin(card, card.subject, true);
          }, RETRY_INTERVAL_MS);
          card.retryTimer = timer;
          timers.add(timer);
        }
      }
    };

    const createCard = (subject: PlannedSubject): Card => {
      const element = el(
        `<div class="npu-item">` +
          `<div class="npu-item__title"></div>` +
          `<div class="npu-item__meta npu-credit"></div>` +
          `<div class="npu-courses"></div>` +
          `<div class="npu-actions" style="margin-top:6px; display:flex; gap:8px; align-items:center; flex-wrap:wrap"></div>` +
          `<div class="npu-error" style="display:none"></div>` +
          `</div>`
      );
      const card: Card = {
        subject,
        courseSignature: courseSignatureOf(subject.courses),
        element,
        coursesBox: element.querySelector<HTMLElement>(".npu-courses")!,
        actions: element.querySelector<HTMLElement>(".npu-actions")!,
        errorBox: element.querySelector<HTMLElement>(".npu-error")!,
        attempts: 0,
        status: "idle",
        retryEnabled: false,
      };
      renderActions(card);
      return card;
    };

    // Updates the parts of a card that can change while it stays on screen.
    const updateCard = (card: Card, subject: PlannedSubject): void => {
      const signature = courseSignatureOf(subject.courses);
      // A different course set is a different thing to register: cancel any
      // armed retry and require a fresh confirmation, or we would silently
      // sign the user up for courses they never approved.
      if (signature !== card.courseSignature && card.status !== "done") {
        stopRetry(card);
        card.attempts = 0;
        card.retryEnabled = false;
        card.errorBox.style.display = "none";
        card.errorBox.textContent = "";
        card.courseSignature = signature;
        card.subject = subject;
        renderActions(card);
      }
      card.subject = subject;
      card.courseSignature = signature;
      card.element.querySelector<HTMLElement>(".npu-item__title")!.textContent = subject.title;
      card.element.querySelector<HTMLElement>(".npu-credit")!.textContent = `${subject.credit} kredit`;

      const description = subject.courses
        .map(course => `${describeCourse(course)}|${isWatched(subject.subjectId, course.id)}`)
        .join("\n");
      if (card.coursesBox.dataset.description !== description) {
        card.coursesBox.dataset.description = description;
        card.coursesBox.innerHTML = "";
        subject.courses.forEach(course => {
          const row = document.createElement("div");
          row.className = "npu-item__meta";
          row.style.display = "flex";
          row.style.alignItems = "center";
          row.style.gap = "6px";
          const text = document.createElement("span");
          // textContent, not innerHTML: these strings come from the server.
          text.textContent = describeCourse(course);
          row.appendChild(text);
          // A full course is the one worth watching for a free place.
          if (course.isFull) {
            const watching = isWatched(subject.subjectId, course.id);
            const button = el(
              `<button class="npu-button npu-button--subtle" style="padding:1px 6px">` +
                `${watching ? "🔔 figyelve" : "🔔 figyelem"}</button>`
            ) as HTMLButtonElement;
            button.title = watching
              ? "Figyelés leállítása"
              : "Szólok, amint felszabadul egy hely ezen a kurzuson";
            button.addEventListener("click", () => {
              if (isWatched(subject.subjectId, course.id)) {
                removeWatch(subject.subjectId, course.id);
              } else {
                addWatch({
                  subjectId: subject.subjectId,
                  courseId: course.id,
                  curriculumTemplateId: subject.curriculumTemplateId,
                  curriculumTemplateLineId: subject.curriculumTemplateLineId,
                  termId: subject.termId,
                  termValue: term?.value ?? 0,
                  subjectTitle: subject.title,
                  courseCode: course.code,
                  courseType: course.type,
                  autoSignup: false,
                });
              }
              card.coursesBox.dataset.description = ""; // force a redraw
              updateCard(card, card.subject);
              renderWatchList();
            });
            row.appendChild(button);
          }
          card.coursesBox.appendChild(row);
        });
      }
      if (card.status !== "done") {
        card.element.className = `npu-item npu-item--${subject.courses.some(c => c.isFull) ? "yellow" : "blue"}`;
      }
    };

    const applySubjects = (subjects: PlannedSubject[]): void => {
      const incoming = new Map(subjects.map(subject => [subject.key, subject]));

      cards.forEach((card, key) => {
        const subject = incoming.get(key);
        if (!subject) {
          // Cards mid-signin stay; a finished one stays as the receipt of
          // what just happened.
          if (card.status === "signing" || card.status === "done") {
            return;
          }
          stopRetry(card);
          card.element.remove();
          cards.delete(key);
          return;
        }
        // A subject that is planned again after we registered it (e.g. the
        // user signed out) must become actionable instead of staying a green
        // receipt with no buttons.
        if (card.status === "done") {
          card.status = "idle";
          card.attempts = 0;
          card.retryEnabled = false;
          card.courseSignature = "";
          card.errorBox.style.display = "none";
          renderActions(card);
        }
      });

      subjects.forEach(subject => {
        const existing = cards.get(subject.key);
        if (existing) {
          updateCard(existing, subject);
          return;
        }
        const card = createCard(subject);
        updateCard(card, subject);
        cards.set(subject.key, card);
        list.appendChild(card.element);
      });

      const registerable = [...cards.values()].filter(card => card.status === "idle");
      emptyNote.style.display = cards.size === 0 ? "block" : "none";
      allButton.style.visibility = registerable.length > 1 ? "visible" : "hidden";
      allButton.disabled = registerable.length < 2;
      allButton.textContent = `Mindet felveszi (${registerable.length})`;
    };

    // Destructive DOM changes are deferred while the pointer is over the
    // panel, so cards never shift out from under a click.
    const reconcile = (subjects: PlannedSubject[]): void => {
      if (panel.body.matches(":hover")) {
        pendingSubjects = subjects;
        return;
      }
      pendingSubjects = null;
      applySubjects(subjects);
    };

    const flushPending = () => {
      if (pendingSubjects && !destroyed) {
        const subjects = pendingSubjects;
        pendingSubjects = null;
        applySubjects(subjects);
      }
    };
    panel.body.addEventListener("mouseleave", flushPending);

    allButton.addEventListener("click", () => {
      const registerable = [...cards.values()].filter(card => card.status === "idle");
      if (registerable.length === 0) {
        return;
      }
      if (confirm(`Mind a(z) ${registerable.length} betervezett tárgyat felveszed?`)) {
        // Sequential, not parallel: Neptun handles one signin at a time and
        // parallel calls would also stampede the token refresh.
        void (async () => {
          for (const card of registerable) {
            if (destroyed) {
              return;
            }
            await attemptSignin(card, card.subject, false);
          }
        })();
      }
    });

    const setHeader = (text: string, isError = false) => {
      header.textContent = text;
      header.className = isError ? "npu-error" : "npu-note";
    };

    // Watched (full) courses: the background watcher polls these even on other
    // pages, so the list is shown here as the place to manage them.
    const renderWatchList = () => {
      const watches = Object.values(getWatches());
      watchSection.innerHTML = "";
      if (watches.length === 0) {
        watchSection.style.display = "none";
        return;
      }
      watchSection.style.display = "block";
      watchSection.appendChild(
        el(
          `<div class="npu-note" style="border-top:1px solid #e3e7f2;padding-top:8px;margin-top:10px">` +
            `<b>Figyelt kurzusok (${watches.length})</b> — szólok, amint felszabadul egy hely.</div>`
        )
      );
      watches.forEach(watch => {
        const item = el(
          `<div class="npu-item npu-item--yellow">` +
            `<div class="npu-item__title"></div>` +
            `<div class="npu-item__meta npu-watch-course"></div>` +
            `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:4px">` +
            `<label class="npu-item__meta" style="display:flex;align-items:center;gap:4px;cursor:pointer">` +
            `<input type="checkbox" class="npu-auto">azonnal fel is veszi</label>` +
            `<button class="npu-button npu-button--danger npu-stop" style="padding:1px 6px">Figyelés vége</button>` +
            `</div></div>`
        );
        item.querySelector<HTMLElement>(".npu-item__title")!.textContent = watch.subjectTitle;
        item.querySelector<HTMLElement>(".npu-watch-course")!.textContent = `${watch.courseCode} (${watch.courseType})`;
        const auto = item.querySelector<HTMLInputElement>(".npu-auto")!;
        auto.checked = watch.autoSignup;
        auto.addEventListener("change", () => {
          if (
            !auto.checked ||
            confirm(
              `Ha felszabadul egy hely a(z) ${watch.courseCode} kurzuson, azonnal felveszem a(z) ` +
                `"${watch.subjectTitle}" tárgyat, külön rákérdezés nélkül. Biztos?`
            )
          ) {
            storage.set("watches", watchKey(watch.subjectId, watch.courseId), {
              ...watch,
              autoSignup: auto.checked,
            });
          } else {
            auto.checked = false;
          }
        });
        item.querySelector<HTMLElement>(".npu-stop")!.addEventListener("click", () => {
          removeWatch(watch.subjectId, watch.courseId);
          renderWatchList();
          void refresh({ force: true });
        });
        watchSection.appendChild(item);
      });
    };

    const refresh = async (options: { force?: boolean } = {}): Promise<void> => {
      if (destroyed) {
        return;
      }
      if (refreshing) {
        refreshQueued = true;
        return;
      }
      refreshing = true;
      try {
        if (!term) {
          const terms = await api<SubjectTerm[]>("SubjectApplication/Terms");
          term = terms.find(t => t.isActualTerm) ?? terms[0] ?? null;
          if (!term) {
            consecutiveErrors++;
            setHeader("Nem található aktuális félév.", true);
            return;
          }
        }
        if (destroyed) {
          return;
        }

        // Cheap check first: has the set of planned courses changed at all?
        let signature: string | null = null;
        try {
          const lite = await api<PlannedSubjectLite[]>(
            `SubjectApplication/ScheduledSubjectsWithScheduledCourses?request.termId=${term.value}`
          );
          signature = signatureOf(
            (lite ?? [])
              .filter(subject => !subject.isRegistered)
              .map(subject => ({
                key: subjectKey(subject.id, subject.curriculumTemplateLineId),
                courseIds: subject.scheduledCourseIds ?? [],
              }))
          );
        } catch {
          // Unknown, not "changed": treating a failure as a change would pin
          // the expensive endpoint to the fast poll interval.
        }
        if (destroyed) {
          return;
        }

        const detailsStale = Date.now() - lastDetailFetch > DETAIL_REFRESH_MS;
        const changed = signature !== null && signature !== lastSignature;
        if (!changed && !detailsStale && !options.force) {
          consecutiveErrors = 0;
          return;
        }

        const courses = await api<ScheduledCourse[]>(
          `SubjectApplication/GetScheduledCourses?request.termId=${term.value}`
        );
        if (destroyed) {
          return;
        }
        lastDetailFetch = Date.now();
        lastSignature = signature;
        consecutiveErrors = 0;
        reconcile(groupPlannedSubjects(courses ?? []));
        setHeader(
          `${term.text} · Órarendtervezőbe betervezett, még fel nem vett tárgyak ` +
            `(frissítve ${new Date().toLocaleTimeString("hu-HU")})`
        );
      } catch (error) {
        // A single hiccup during the registration rush should not make the
        // panel flash red every few seconds.
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          setHeader(`Hiba: ${error instanceof Error ? error.message : error}`, true);
        }
      } finally {
        refreshing = false;
        if (refreshQueued && !destroyed) {
          refreshQueued = false;
          void refresh({ force: true });
        }
      }
    };

    // Instant reaction to the user's own planner changes made in the app,
    // debounced so a multi-course removal renders once, not once per course.
    const unsubscribe = onApiCall(call => {
      if (call.status >= 200 && call.status < 300 && MUTATING_PATHS.includes(call.path)) {
        window.clearTimeout(debounceTimer);
        debounceTimer = window.setTimeout(() => void refresh({ force: true }), HOOK_DEBOUNCE_MS);
      }
    });

    // Fallback for when the hook cannot see the page's requests. Once the
    // hook has proven itself, this only needs to be a safety net.
    let currentPollInterval = POLL_FAST_MS;
    const tick = () => {
      if (destroyed) {
        return;
      }
      if (document.visibilityState === "visible") {
        void refresh();
      }
      const wanted = observedCallCount() > 0 ? POLL_SLOW_MS : POLL_FAST_MS;
      if (wanted !== currentPollInterval) {
        currentPollInterval = wanted;
        window.clearInterval(pollTimer);
        pollTimer = window.setInterval(tick, wanted);
      }
    };
    let pollTimer = window.setInterval(tick, currentPollInterval);

    // Only a genuine hidden→visible transition is a reason to catch up;
    // keepAlive dispatches synthetic visibilitychange events every 20s.
    const onVisible = () => {
      const visible = document.visibilityState === "visible";
      if (visible && !wasVisible) {
        void refresh();
      }
      wasVisible = visible;
    };
    document.addEventListener("visibilitychange", onVisible);

    // The background watcher can change the list from anywhere.
    const onWatchesChanged = () => {
      renderWatchList();
      void refresh({ force: true });
    };
    document.addEventListener("npu:watches-changed", onWatchesChanged);
    document.addEventListener("npu:place-free", onWatchesChanged);
    document.addEventListener("npu:auto-signed-up", onWatchesChanged);

    renderWatchList();
    void refresh({ force: true });

    return () => {
      destroyed = true;
      unsubscribe();
      window.clearTimeout(debounceTimer);
      window.clearInterval(pollTimer);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("npu:watches-changed", onWatchesChanged);
      document.removeEventListener("npu:place-free", onWatchesChanged);
      document.removeEventListener("npu:auto-signed-up", onWatchesChanged);
      panel.body.removeEventListener("mouseleave", flushPending);
      timers.forEach(timer => window.clearInterval(timer));
      timers.clear();
      cards.clear();
      panel.destroy();
    };
  },
};
