import { api } from "../core/api";
import { injectCss } from "../core/dom";
import { log } from "../core/env";
import { inject, subjectCodeOf } from "../core/inject";
import type { NpuModule } from "../core/modules";
import { onApiCall } from "../core/netHook";

// Colours the subject registration list by your own history with each subject,
// in the spirit of the old NPU's coloured lists.
//
// The point is the red one: a subject you already took in an earlier term and
// still have not completed. Neptun shows it among all the others with nothing
// to distinguish it, so a retake is easy to overlook — which is expensive,
// because it is usually the one subject you cannot afford to skip.
//
// Note what green is NOT: Neptun already filters completed subjects out of
// this list (measured: every row comes back isCompleted=false), so "green =
// completed" would never fire here. Green is kept for the one case where a
// completed subject does appear — when it may be retaken to improve a grade —
// so it reads as "careful, you already have this one".

interface TakenTerm {
  text: string;
  value: string;
}

interface TakenSubject {
  subjectCode: string;
  numberOfTimesTakingSubject: number;
}

interface SchedulableSubject {
  code: string;
  isCompleted?: boolean;
  isRegistered?: boolean;
  isRetakeableCompletedSubject?: boolean;
}

// Subject code -> the earlier terms it was taken in. Null until loaded.
let history: Map<string, string[]> | null = null;
let loading: Promise<void> | null = null;
// What the app's own subject list says about each code, so a row that is
// already registered this term is not accused of being an unfinished retake.
const listed = new Map<string, SchedulableSubject>();

function normalise(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase();
}

async function loadHistory(): Promise<void> {
  // The current term is excluded: taking a subject right now is not a past
  // failure. Terms are matched by their label, because the two endpoints
  // identify terms differently (numeric value here, GUID there).
  const [appTerms, takenTerms] = await Promise.all([
    api<{ text: string; isActualTerm: boolean }[]>("SubjectApplication/Terms").catch(() => []),
    api<TakenTerm[]>("TakenSubjects/Terms"),
  ]);
  const currentLabel = appTerms.find(t => t.isActualTerm)?.text ?? "";
  const past = (takenTerms ?? []).filter(term => term.text !== currentLabel);

  const found = new Map<string, string[]>();
  // Sequential on purpose: a burst of parallel calls would also stampede the
  // token refresh, and this runs once per visit to the page.
  for (const term of past) {
    try {
      const rows = await api<TakenSubject[]>(`TakenSubjects/GetTakenSubjects?request.termId=${term.value}`);
      (rows ?? []).forEach(row => {
        const code = normalise(row.subjectCode);
        if (!code) {
          return;
        }
        const terms = found.get(code) ?? [];
        terms.push(term.text);
        found.set(code, terms);
      });
    } catch {
      // One unreadable term just means less colouring, not a broken page.
    }
  }
  history = found;
  log(`subject history loaded: ${found.size} subject(s) taken in ${past.length} earlier term(s)`);
}

function ensureHistory(): Promise<void> {
  if (history) {
    return Promise.resolve();
  }
  if (!loading) {
    loading = loadHistory()
      .catch(() => {
        history = new Map(); // do not retry in a loop on a failing account
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

type Mark = { kind: "red" | "green"; label: string; title: string };

function markFor(code: string): Mark | null {
  const info = listed.get(code);
  if (info?.isCompleted || info?.isRetakeableCompletedSubject) {
    return {
      kind: "green",
      label: "teljesítve",
      title: "Ezt a tárgyat már teljesítetted — csak jegyjavításhoz vedd fel újra.",
    };
  }
  if (info?.isRegistered) {
    return null; // taking it right now: nothing to warn about
  }
  const terms = history?.get(code);
  if (!terms || terms.length === 0) {
    return null;
  }
  const when = [...new Set(terms)].join(", ");
  return {
    kind: "red",
    label: terms.length > 1 ? `${terms.length}× felvetted, nincs meg` : "felvetted, nincs meg",
    title:
      `Ezt a tárgyat már felvetted (${when}), de nincs teljesítve — ` +
      `és most újra felvehető. Ne felejtsd el!`,
  };
}

export const subjectHistory: NpuModule = {
  id: "subjectHistory",
  matches: path => path.startsWith("/subjects/registration"),
  activate() {
    let destroyed = false;

    injectCss(`
      neptun-subject-list-item.npu-hist-red { box-shadow: inset 4px 0 0 0 #e03131; }
      neptun-subject-list-item.npu-hist-green { box-shadow: inset 4px 0 0 0 #2f9e44; }
      .npu-hist-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin-left: 8px;
        padding: 1px 8px;
        border-radius: 10px;
        font: 600 11px/1.6 system-ui, sans-serif;
        white-space: nowrap;
        vertical-align: middle;
        cursor: help;
      }
      .npu-hist-badge--red { background: #ffe3e3; color: #c92a2a; }
      .npu-hist-badge--green { background: #d3f9d8; color: #2b8a3e; }
    `);

    // Reuse the list the app already fetched rather than asking for it again.
    const unsubscribe = onApiCall(call => {
      if (call.path !== "SubjectApplication/SchedulableSubjects" || call.status < 200 || call.status >= 300) {
        return;
      }
      (call.json<{ data: SchedulableSubject[] }>()?.data ?? []).forEach(subject => {
        const code = normalise(subject.code);
        if (code) {
          listed.set(code, subject);
        }
      });
    });

    const removeMarks = inject({
      id: "subject-history",
      hostSelector: "neptun-subject-list-item",
      attach(host) {
        if (!history) {
          return false; // retried once the history is in
        }
        const target = host.querySelector<HTMLElement>(".subject-container__informations");
        if (!target) {
          return false; // row not rendered yet
        }
        // Resolved from the row's current content: Angular reuses these nodes,
        // so a cached binding would label the wrong subject after a re-sort.
        const code = normalise(subjectCodeOf(host));
        host.classList.remove("npu-hist-red", "npu-hist-green");
        const mark = code ? markFor(code) : null;
        if (!mark) {
          return true;
        }
        host.classList.add(`npu-hist-${mark.kind}`);
        const badge = document.createElement("span");
        badge.className = `npu-hist-badge npu-hist-badge--${mark.kind}`;
        badge.dataset.npuControl = "subject-history";
        badge.textContent = mark.kind === "red" ? `⚠ ${mark.label}` : `✓ ${mark.label}`;
        badge.title = mark.title;
        target.appendChild(badge);
        return true;
      },
    });

    // The rows are already on screen by the time the history arrives, and a
    // settled list produces no mutations — so ask for a re-run explicitly.
    void ensureHistory().then(() => {
      if (!destroyed) {
        removeMarks.refresh();
      }
    });

    return () => {
      destroyed = true;
      void destroyed;
      unsubscribe();
      removeMarks();
      document
        .querySelectorAll(".npu-hist-red, .npu-hist-green")
        .forEach(node => node.classList.remove("npu-hist-red", "npu-hist-green"));
    };
  },
};
