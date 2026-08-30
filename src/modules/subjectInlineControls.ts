import { api, ApiError, apiPost } from "../core/api";
import { log } from "../core/env";
import { cloneAppButton, courseCodeOf, inject, subjectCodeOf } from "../core/inject";
import type { NpuModule } from "../core/modules";
import { onApiCall } from "../core/netHook";
import { addWatch, isWatched, removeWatch } from "./courseWatch";

// Puts NPU's controls where they belong: on Neptun's own subject and course
// rows, styled as the app's own buttons.
//
// Everything a control needs is resolved at click time from the row it sits
// in, because Angular reuses DOM nodes — a cached binding would silently
// point at a different subject after a re-sort.

interface SubjectMeta {
  id: string;
  code: string;
  title: string;
  curriculumTemplateId: string;
  curriculumTemplateLineId: string;
  termId: string;
  isRegistered: boolean;
  scheduledCourseIds: string[];
}

interface CourseMeta {
  id: string;
  code: string;
  type: string;
  subjectId: string;
  isFull: boolean;
  maxLimit: number | null;
  registeredStudentsCount?: number;
  strength?: number;
  isSigned?: boolean;
}

// Subject metadata keyed by subject code, harvested from the app's own calls.
const subjectsByCode = new Map<string, SubjectMeta>();
// Courses keyed by subject id, from the app's GetSubjectsCourses responses.
const coursesBySubject = new Map<string, CourseMeta[]>();
// Subject ids that currently have planned courses (from GetScheduledCourses).
let plannedSubjectIds = new Set<string>();
let termValue: number | null = null;

function rememberSubjects(list: SubjectMeta[] | null): void {
  (list ?? []).forEach(subject => {
    if (subject?.code) {
      subjectsByCode.set(subject.code.trim().toUpperCase(), subject);
    }
  });
}

function subjectOfRow(host: HTMLElement): SubjectMeta | null {
  const code = subjectCodeOf(host);
  return code ? (subjectsByCode.get(code.toUpperCase()) ?? null) : null;
}

function courseOfRow(courseRow: HTMLElement): { subject: SubjectMeta; course: CourseMeta } | null {
  const subjectRow = courseRow.closest<HTMLElement>("neptun-subject-list-item");
  const subject = subjectRow ? subjectOfRow(subjectRow) : null;
  const code = courseCodeOf(courseRow);
  if (!subject || !code) {
    return null;
  }
  const normalise = (value: string) => value.replace(/\s+/g, "").toUpperCase();
  const course = (coursesBySubject.get(subject.id) ?? []).find(c => normalise(c.code) === normalise(code));
  return course ? { subject, course } : null;
}

async function refreshPlanned(): Promise<void> {
  try {
    if (termValue === null) {
      const terms = await api<{ value: number; isActualTerm: boolean }[]>("SubjectApplication/Terms");
      termValue = (terms.find(t => t.isActualTerm) ?? terms[0])?.value ?? null;
    }
    if (termValue === null) {
      return;
    }
    const courses = await api<{ subjectId: string; scheduledCourseId: string | null; isRegistered: boolean }[]>(
      `SubjectApplication/GetScheduledCourses?request.termId=${termValue}`
    );
    plannedSubjectIds = new Set(
      (courses ?? []).filter(c => c.scheduledCourseId !== null && !c.isRegistered).map(c => c.subjectId)
    );
  } catch {
    // Leave the previous set in place; the controls simply do not appear.
  }
}

function seatsOf(course: CourseMeta): string {
  const taken = course.registeredStudentsCount ?? course.strength ?? 0;
  return course.maxLimit ? `${taken}/${course.maxLimit}` : `${taken}`;
}

export const subjectInlineControls: NpuModule = {
  id: "subjectInlineControls",
  matches: path => path.startsWith("/subjects/registration"),
  activate() {
    let destroyed = false;

    // Reuse what the app already fetched instead of asking for it again.
    const unsubscribe = onApiCall(call => {
      if (call.status < 200 || call.status >= 300) {
        return;
      }
      if (call.path === "SubjectApplication/SchedulableSubjects") {
        rememberSubjects(call.json<{ data: SubjectMeta[] }>()?.data ?? null);
      }
      if (call.path === "SubjectApplication/GetSubjectsCourses") {
        const courses = call.json<{ data: CourseMeta[] }>()?.data ?? [];
        if (courses.length > 0 && courses[0].subjectId) {
          coursesBySubject.set(courses[0].subjectId, courses);
        }
      }
      if (
        call.path === "SubjectApplication/ScheduleSubjectAndCourses" ||
        call.path === "SubjectApplication/UnScheduleCourse" ||
        call.path === "SubjectApplication/SubjectSignin" ||
        call.path === "SubjectApplication/SubjectSignout"
      ) {
        void refreshPlanned();
      }
    });

    void refreshPlanned();

    // --- subject rows: one-click signup of the planned courses -------------
    const removeSubjectControls = inject({
      id: "quick-signup",
      hostSelector: "neptun-subject-list-item",
      attach(host) {
        const actions = host.querySelector<HTMLElement>("section.actions");
        if (!actions) {
          return false; // row is collapsed; nothing to decorate yet
        }
        const subject = subjectOfRow(host);
        if (!subject || subject.isRegistered || !plannedSubjectIds.has(subject.id)) {
          return true; // nothing to offer here, but the row was handled
        }
        const template = actions.querySelector<HTMLElement>("button.link.primary");
        const button = cloneAppButton(template, "NPU: felvétel a betervezett kurzusokkal", "icon-check");
        button.dataset.npuControl = "quick-signup";
        button.addEventListener("click", async event => {
          event.stopPropagation();
          // Resolve again at click time: the row may show a different subject.
          const current = subjectOfRow(host);
          if (!current) {
            return;
          }
          const planned = (coursesBySubject.get(current.id) ?? []).filter(course =>
            current.scheduledCourseIds?.includes(course.id)
          );
          const courseIds = planned.length > 0 ? planned.map(c => c.id) : current.scheduledCourseIds;
          const label = button.querySelector<HTMLElement>(".neptun-button__label") ?? button;
          if (!courseIds || courseIds.length === 0) {
            label.textContent = "NPU: nincs betervezett kurzus";
            return;
          }
          const names = planned.length > 0 ? planned.map(c => c.code).join(", ") : `${courseIds.length} kurzus`;
          if (!confirm(`Felveszed a(z) "${current.title}" tárgyat?\n\nKurzusok: ${names}`)) {
            return;
          }
          label.textContent = "NPU: felvétel...";
          try {
            const result = await apiPost<{ isWaiting: boolean }>("SubjectApplication/SubjectSignin", {
              courseIds,
              curriculumTemplateId: current.curriculumTemplateId,
              curriculumTemplateLineId: current.curriculumTemplateLineId,
              subjectId: current.id,
              termId: current.termId,
            });
            label.textContent = result.data.isWaiting ? "NPU: várólistán ✓" : "NPU: felvéve ✓";
            log(`inline signup succeeded for ${current.code}`);
            void refreshPlanned();
          } catch (error) {
            const message = error instanceof ApiError ? error.message : String(error);
            label.textContent = "NPU: nem sikerült — újra";
            button.title = message;
          }
        });
        actions.appendChild(button);
        return true;
      },
    });

    // --- course rows: watch a full course for a free place -----------------
    const removeCourseControls = inject({
      id: "watch",
      hostSelector: "neptun-course-list-item",
      attach(host) {
        const match = courseOfRow(host);
        if (!match) {
          return false; // course data not loaded yet
        }
        const { subject, course } = match;
        if (!course.isFull || course.isSigned) {
          return true;
        }
        const container = host.querySelector<HTMLElement>("article.course-list-item-container") ?? host;
        const template =
          host.closest<HTMLElement>("neptun-subject-list-item")?.querySelector<HTMLElement>("button.link.primary") ??
          null;
        const watching = isWatched(subject.id, course.id);
        const button = cloneAppButton(
          template,
          watching ? "NPU: figyelve" : "NPU: szólj, ha felszabadul",
          "icon-bell"
        );
        button.dataset.npuControl = "watch";
        button.style.marginLeft = "auto";
        button.addEventListener("click", event => {
          event.stopPropagation();
          const now = courseOfRow(host);
          if (!now) {
            return;
          }
          const label = button.querySelector<HTMLElement>(".neptun-button__label") ?? button;
          if (isWatched(now.subject.id, now.course.id)) {
            removeWatch(now.subject.id, now.course.id);
            label.textContent = "NPU: szólj, ha felszabadul";
          } else {
            addWatch({
              subjectId: now.subject.id,
              courseId: now.course.id,
              curriculumTemplateId: now.subject.curriculumTemplateId,
              curriculumTemplateLineId: now.subject.curriculumTemplateLineId,
              termId: now.subject.termId,
              termValue: termValue ?? 0,
              subjectTitle: now.subject.title,
              courseCode: now.course.code,
              courseType: now.course.type,
              autoSignup: false,
            });
            label.textContent = "NPU: figyelve";
          }
        });
        button.title = `${seatsOf(course)} fő — szólok, amint felszabadul egy hely`;
        container.appendChild(button);
        return true;
      },
    });

    return () => {
      destroyed = true;
      void destroyed;
      unsubscribe();
      removeSubjectControls();
      removeCourseControls();
    };
  },
};
