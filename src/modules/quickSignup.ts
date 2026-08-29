import { api, ApiError, apiPost } from "../core/api";
import { log } from "../core/env";
import type { NpuModule } from "../core/modules";
import { el, createPanel } from "../core/ui";

// One-click registration of the courses planned in the built-in schedule
// planner (Órarendtervező). Everything comes from GetScheduledCourses, which
// returns both planned courses (scheduledCourseId set, not yet registered)
// and already registered ones. Note that the signin payload needs the course
// id (`id`), NOT the planner record id (`scheduledCourseId`) — the app's own
// signin code sends the ids of the course rows.
// Every signin requires an explicit confirmation; optional auto-retry keeps
// trying full courses.

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
  tutorName: string;
  subjectCredit: number;
  isRegistered: boolean;
  isFull: boolean;
  strength: number;
  maxLimit: number | null;
  waitingStudentsCount: number;
  willBeOnWaitingList: boolean;
}

interface PlannedSubject {
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

const RETRY_INTERVAL_MS = 10_000;
const MAX_RETRIES = 30;

// Groups planned (not yet registered) courses into per-subject entries.
function groupPlannedSubjects(courses: ScheduledCourse[]): PlannedSubject[] {
  const groups = new Map<string, PlannedSubject>();
  courses
    .filter(course => course.scheduledCourseId !== null && !course.isRegistered)
    .forEach(course => {
      const key = `${course.subjectId}|${course.curriculumTemplateLineId}`;
      const group = groups.get(key);
      if (group) {
        group.courses.push(course);
        return;
      }
      groups.set(key, {
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
  matches: path => path.startsWith("/hallgatoi/subjects/registration"),
  activate() {
    const panel = createPanel("npu-quick-signup", "NPU · Gyorsfelvétel");
    let destroyed = false;
    const retryTimers = new Map<string, number>();

    const stopRetry = (key: string) => {
      const timer = retryTimers.get(key);
      if (timer !== undefined) {
        window.clearInterval(timer);
        retryTimers.delete(key);
      }
    };

    const renderSubject = (subject: PlannedSubject): HTMLElement => {
      const key = `${subject.subjectId}|${subject.curriculumTemplateLineId}`;
      const anyFull = subject.courses.some(course => course.isFull);
      const item = el(
        `<div class="npu-item npu-item--${anyFull ? "yellow" : "blue"}">` +
          `<div class="npu-item__title">${subject.title}</div>` +
          `<div class="npu-item__meta">${subject.credit} kredit</div>` +
          subject.courses.map(c => `<div class="npu-item__meta">${describeCourse(c)}</div>`).join("") +
          `<div class="npu-actions" style="margin-top:6px; display:flex; gap:8px; align-items:center; flex-wrap:wrap"></div>` +
          `<div class="npu-error" style="display:none"></div>` +
          `</div>`
      );
      const actions = item.querySelector<HTMLElement>(".npu-actions")!;
      const errorBox = item.querySelector<HTMLElement>(".npu-error")!;

      const button = el(`<button class="npu-button">Felvétel</button>`) as HTMLButtonElement;
      const retryLabel = el(
        `<label class="npu-item__meta" style="display:flex;align-items:center;gap:4px;cursor:pointer">` +
          `<input type="checkbox" class="npu-retry">auto-újrapróba</label>`
      );
      const retryBox = retryLabel.querySelector<HTMLInputElement>(".npu-retry")!;
      actions.appendChild(button);
      actions.appendChild(retryLabel);

      let attempts = 0;
      const attempt = async (viaRetry: boolean) => {
        attempts++;
        button.disabled = true;
        button.textContent = viaRetry ? `Próba #${attempts}...` : "Felvétel...";
        try {
          const result = await signin(subject);
          stopRetry(key);
          item.className = "npu-item npu-item--green";
          actions.innerHTML = "";
          errorBox.style.display = "none";
          actions.appendChild(
            el(
              `<span class="npu-item__meta">${result.isWaiting ? "várólistára kerültél" : "sikeresen felvéve ✓"}</span>`
            )
          );
          log(`subject ${subject.title} signed in (waiting: ${result.isWaiting})`);
        } catch (error) {
          const message = error instanceof ApiError ? error.message : String(error);
          errorBox.textContent = `${new Date().toLocaleTimeString("hu-HU")} · ${message}`;
          errorBox.style.display = "block";
          button.disabled = false;
          button.textContent = "Újra";
          if (retryBox.checked && attempts < MAX_RETRIES && !retryTimers.has(key)) {
            const timer = window.setInterval(() => {
              if (destroyed || !retryBox.checked || attempts >= MAX_RETRIES) {
                stopRetry(key);
                return;
              }
              void attempt(true);
            }, RETRY_INTERVAL_MS);
            retryTimers.set(key, timer);
          }
        }
      };

      button.addEventListener("click", () => {
        const skipConfirm = attempts > 0 || button.dataset.skipConfirm === "1";
        delete button.dataset.skipConfirm;
        const courseList = subject.courses.map(c => c.code).join(", ");
        if (skipConfirm || confirm(`Felveszed a(z) "${subject.title}" tárgyat?\n\nKurzusok: ${courseList}`)) {
          void attempt(false);
        }
      });
      retryBox.addEventListener("change", () => {
        if (!retryBox.checked) {
          stopRetry(key);
        }
      });
      return item;
    };

    const render = async () => {
      panel.body.innerHTML = "";
      const status = el(`<div class="npu-note">Betervezett kurzusok betöltése...</div>`);
      panel.body.appendChild(status);
      try {
        const terms = await api<SubjectTerm[]>("SubjectApplication/Terms");
        const term = terms.find(t => t.isActualTerm) ?? terms[0];
        if (destroyed || !term) {
          return;
        }
        const courses = await api<ScheduledCourse[]>(
          `SubjectApplication/GetScheduledCourses?request.termId=${term.value}`
        );
        if (destroyed) {
          return;
        }
        status.remove();
        const subjects = groupPlannedSubjects(courses ?? []);
        panel.body.appendChild(
          el(`<div class="npu-note">${term.text} · Órarendtervezőbe betervezett, még fel nem vett tárgyak:</div>`)
        );
        if (subjects.length === 0) {
          panel.body.appendChild(
            el(
              `<div class="npu-note">Nincs betervezett kurzus. Tervezz be kurzusokat az Órarendtervezőben ` +
                `(vagy a tárgy alatti „Tervezőhöz adás” kapcsolóval), és itt egy kattintással felveheted őket.</div>`
            )
          );
        } else {
          subjects.forEach(subject => panel.body.appendChild(renderSubject(subject)));
          if (subjects.length > 1) {
            const all = el(`<button class="npu-button" style="width:100%">Mindet felveszi (${subjects.length})</button>`);
            all.addEventListener("click", () => {
              if (confirm(`Mind a(z) ${subjects.length} betervezett tárgyat felveszed?`)) {
                panel.body.querySelectorAll<HTMLButtonElement>(".npu-item .npu-button").forEach(button => {
                  if (button.textContent === "Felvétel") {
                    button.dataset.skipConfirm = "1";
                    button.click();
                  }
                });
              }
            });
            panel.body.insertBefore(all, panel.body.children[1]);
          }
        }
        const refresh = el(`<button class="npu-button npu-button--subtle" style="margin-top:6px">Frissítés</button>`);
        refresh.addEventListener("click", () => void render());
        panel.body.appendChild(refresh);
      } catch (error) {
        status.textContent = `Hiba: ${error instanceof Error ? error.message : error}`;
        status.className = "npu-error";
      }
    };

    void render();

    return () => {
      destroyed = true;
      retryTimers.forEach(timer => window.clearInterval(timer));
      retryTimers.clear();
      panel.destroy();
    };
  },
};
