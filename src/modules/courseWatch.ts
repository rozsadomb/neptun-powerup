import { api, ApiError, apiPost, isLoggedIn } from "../core/api";
import { log } from "../core/env";
import type { NpuModule } from "../core/modules";
import * as storage from "../core/storage";
import { ensureUser, userKey } from "../core/user";

// Watches full courses and tells the user the moment a place frees up — the
// modern counterpart of the old NPU's "waiting for a free place", which could
// only retry the login dialog.
//
// The watcher runs on every page of the app (not just subject registration),
// so the user can keep working while it polls in the background. It only
// registers automatically when explicitly asked to, per watch.

export interface WatchedCourse {
  key: string;
  subjectId: string;
  courseId: string;
  curriculumTemplateId: string;
  curriculumTemplateLineId: string;
  termId: string; // GUID, for the signin payload
  termValue: number; // numeric, for queries
  subjectTitle: string;
  courseCode: string;
  courseType: string;
  autoSignup: boolean;
  addedAt: string;
  /** Set once we have notified, so the alert fires once per opening. */
  notifiedAt?: string;
}

// GetSubjectsCourses and GetScheduledCourses describe the same course with
// different field names: the former reports registeredStudentsCount/isSigned,
// the latter strength/isRegistered. Accept both.
interface CourseState {
  id: string;
  isFull: boolean;
  maxLimit: number | null;
  waitingStudentsCount: number;
  registeredStudentsCount?: number;
  strength?: number;
  isSigned?: boolean;
  isRegistered?: boolean;
}

function takenSeats(state: CourseState): number {
  return state.registeredStudentsCount ?? state.strength ?? 0;
}

function alreadySignedUp(state: CourseState): boolean {
  return state.isSigned === true || state.isRegistered === true;
}

const POLL_INTERVAL_MS = 30_000;

export function watchKey(subjectId: string, courseId: string): string {
  return `${subjectId}:${courseId}`;
}

// Watches are stored per student. Logging out and back in is only a route
// change, so with a single global list the watcher would keep running for the
// previous student in the next one's session — and an auto-signup watch would
// register a course in the new student's name that they never chose. Until the
// Neptun code is known, there are no watches: refusing to act is the only safe
// answer to "whose are these?".
const WATCH_ROOT = "watchesByUser";

export function getWatches(): Record<string, WatchedCourse> {
  const user = userKey();
  if (!user) {
    return {};
  }
  return storage.get<Record<string, WatchedCourse>>(WATCH_ROOT, user) ?? {};
}

function writeWatch(key: string, value: WatchedCourse | null): void {
  const user = userKey();
  if (!user) {
    return;
  }
  storage.set(WATCH_ROOT, user, key, value);
}

/**
 * Moves watches saved before they were per-student under the current student.
 * Auto-signup is deliberately cleared: we cannot prove these were saved by the
 * person now logged in, and registering a course for the wrong student is the
 * one outcome worth losing a preference over. The alerts keep working.
 */
function adoptLegacyWatches(user: string): void {
  const legacy = storage.get<Record<string, WatchedCourse>>("watches");
  if (!legacy || Object.keys(legacy).length === 0) {
    return;
  }
  const mine = storage.get<Record<string, WatchedCourse>>(WATCH_ROOT, user) ?? {};
  const adopted: Record<string, WatchedCourse> = {};
  Object.entries(legacy).forEach(([key, watch]) => {
    adopted[key] = { ...watch, autoSignup: false };
  });
  storage.set(WATCH_ROOT, user, { ...adopted, ...mine });
  storage.set("watches", null);
  log(`adopted ${Object.keys(legacy).length} pre-existing watch(es) for ${user}`);
  document.dispatchEvent(new CustomEvent("npu:watches-changed"));
}

export function isWatched(subjectId: string, courseId: string): boolean {
  return !!getWatches()[watchKey(subjectId, courseId)];
}

export function addWatch(watch: Omit<WatchedCourse, "key" | "addedAt">): void {
  const key = watchKey(watch.subjectId, watch.courseId);
  writeWatch(key, { ...watch, key, addedAt: new Date().toISOString() });
  void requestNotificationPermission();
  document.dispatchEvent(new CustomEvent("npu:watches-changed"));
  log(`watching course ${watch.courseCode} of ${watch.subjectTitle}`);
}

export function removeWatch(subjectId: string, courseId: string): void {
  writeWatch(watchKey(subjectId, courseId), null);
  document.dispatchEvent(new CustomEvent("npu:watches-changed"));
}

async function requestNotificationPermission(): Promise<void> {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      await Notification.requestPermission();
    }
  } catch {
    // Not fatal: the in-page panel still shows the free place.
  }
}

function notify(watch: WatchedCourse, state: CourseState): void {
  const places = state.maxLimit ? `${takenSeats(state)}/${state.maxLimit}` : `${takenSeats(state)}`;
  const title = "Felszabadult hely!";
  const body = `${watch.subjectTitle} · ${watch.courseCode} (${places} fő)`;
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      const notification = new Notification(title, { body, tag: watch.key, requireInteraction: true });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    }
  } catch {
    // fall through to the in-page signal below
  }
  document.dispatchEvent(new CustomEvent("npu:place-free", { detail: { watch, state } }));
}

// A short two-tone chime, so a free place is noticed even off-screen.
function playChime(): void {
  try {
    const Ctx =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) {
      return;
    }
    const ctx = new Ctx();
    [880, 1320].forEach((frequency, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.frequency.value = frequency;
      oscillator.type = "sine";
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02 + index * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3 + index * 0.18);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(ctx.currentTime + index * 0.18);
      oscillator.stop(ctx.currentTime + 0.4 + index * 0.18);
    });
    window.setTimeout(() => void ctx.close(), 1200);
  } catch {
    // audio is a nicety, never a requirement
  }
}

async function fetchCourses(watch: WatchedCourse): Promise<CourseState[]> {
  return api<CourseState[]>(
    `SubjectApplication/GetSubjectsCourses?subjectId=${watch.subjectId}&termId=${watch.termId}` +
      `&curriculumTemplateId=${watch.curriculumTemplateId}` +
      `&curriculumTemplateLineId=${watch.curriculumTemplateLineId}`
  );
}

async function signup(watch: WatchedCourse): Promise<{ isWaiting: boolean }> {
  const response = await apiPost<{ isWaiting: boolean }>("SubjectApplication/SubjectSignin", {
    courseIds: [watch.courseId],
    curriculumTemplateId: watch.curriculumTemplateId,
    curriculumTemplateLineId: watch.curriculumTemplateLineId,
    subjectId: watch.subjectId,
    termId: watch.termId,
  });
  return response.data;
}

async function checkWatch(watch: WatchedCourse): Promise<void> {
  const courses = await fetchCourses(watch);
  const state = courses?.find(course => course.id === watch.courseId);
  if (!state) {
    return;
  }

  // Registered elsewhere in the meantime: the watch has done its job.
  if (alreadySignedUp(state)) {
    removeWatch(watch.subjectId, watch.courseId);
    return;
  }

  const hasPlace = !state.isFull && (state.maxLimit === null || takenSeats(state) < state.maxLimit);
  if (!hasPlace) {
    // Course filled up again: allow a fresh alert next time it opens.
    if (watch.notifiedAt) {
      writeWatch(watch.key, { ...watch, notifiedAt: undefined });
    }
    return;
  }
  if (watch.notifiedAt) {
    return; // already announced this opening
  }

  writeWatch(watch.key, { ...watch, notifiedAt: new Date().toISOString() });
  log(`place opened on ${watch.courseCode} (${takenSeats(state)}/${state.maxLimit})`);
  notify(watch, state);
  playChime();

  if (!watch.autoSignup) {
    return;
  }
  try {
    const result = await signup(watch);
    removeWatch(watch.subjectId, watch.courseId);
    log(`auto-signup succeeded for ${watch.courseCode} (waiting: ${result.isWaiting})`);
    document.dispatchEvent(
      new CustomEvent("npu:auto-signed-up", { detail: { watch, isWaiting: result.isWaiting } })
    );
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification("Sikeres tárgyfelvétel!", {
          body: `${watch.subjectTitle} · ${watch.courseCode}`,
          tag: `${watch.key}:done`,
          requireInteraction: true,
        });
      }
    } catch {
      // notification already delivered in-page via the event above
    }
  } catch (error) {
    const message = error instanceof ApiError ? error.message : String(error);
    log(`auto-signup failed for ${watch.courseCode}: ${message}`);
    document.dispatchEvent(new CustomEvent("npu:auto-signup-failed", { detail: { watch, message } }));
    // Let the next poll try again: the place may still be there.
    writeWatch(watch.key, { ...watch, notifiedAt: undefined });
  }
}

async function tick(): Promise<void> {
  // Never act on someone else's watches: resolve who is logged in first.
  if (!(await ensureUser())) {
    return;
  }
  const watches = Object.values(getWatches());
  if (watches.length === 0) {
    return;
  }
  // Sequential: a burst of parallel calls would also stampede token refresh.
  for (const watch of watches) {
    try {
      await checkWatch(watch);
    } catch (error) {
      log(`watch check failed for ${watch.courseCode}`, error);
    }
  }
}

export const courseWatch: NpuModule = {
  id: "courseWatch",
  matches: () => isLoggedIn(),
  activate() {
    let stopped = false;
    const timer = window.setInterval(() => {
      if (!stopped) {
        void tick();
      }
    }, POLL_INTERVAL_MS);
    void ensureUser().then(user => {
      if (user && !stopped) {
        adoptLegacyWatches(user);
      }
      if (!stopped) {
        void tick();
      }
    });
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  },
};
