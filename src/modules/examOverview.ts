import { api } from "../core/api";
import type { NpuModule } from "../core/modules";
import * as storage from "../core/storage";
import { createPanel, el } from "../core/ui";

// Colored overview of registered exams on the exam pages, in the spirit of
// the old NPU exam list coloring: green = completed, red = failed,
// yellow = missed, blue = registered without a result yet. Term selection is
// remembered, so past terms are one click away (the app always defaults to
// the current term, which is empty outside the exam period).

interface ExamTerm {
  text: string;
  value: string;
}

interface RegisteredExam {
  courseCode: string;
  examType: string;
  examTutors: string;
  examRooms: string;
  fromDate: string;
  missed: boolean;
  justifiedMissing: boolean;
  isWaiting: boolean;
  strength: number;
  maxStrength: number | null;
  uiDisplayState: { reasons: string[]; type: number };
}

interface RegisteredExamSubject {
  subjectCode: string;
  subjectName: string;
  registeredExamList: RegisteredExam[];
}

function classify(exam: RegisteredExam): { color: string; label: string } {
  const reasons = exam.uiDisplayState.reasons.map(r => r.toLowerCase());
  const has = (needle: string) => reasons.some(r => r.includes(needle));
  if (has("teljesített") || has("sikeres")) {
    return { color: "green", label: "teljesítve" };
  }
  if (has("sikertelen") || has("elégtelen")) {
    return { color: "red", label: "sikertelen" };
  }
  if (exam.missed && !exam.justifiedMissing) {
    return { color: "yellow", label: "nem jelent meg" };
  }
  if (exam.isWaiting) {
    return { color: "yellow", label: "várólistán" };
  }
  return { color: "blue", label: "felvett vizsga" };
}

function formatDate(value: string): string {
  const date = new Date(value);
  return isNaN(date.getTime())
    ? value
    : date.toLocaleString("hu-HU", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export const examOverview: NpuModule = {
  id: "examOverview",
  matches: path => path.startsWith("/hallgatoi/exams"),
  activate() {
    const panel = createPanel("npu-exam-overview", "NPU · Vizsga-áttekintés");
    let destroyed = false;

    const render = async (terms: ExamTerm[], selected: string) => {
      if (destroyed) {
        return;
      }
      storage.set("examOverview", "term", selected);
      panel.body.innerHTML = "";

      const chips = el(`<div class="npu-chiprow"></div>`);
      terms.slice(0, 6).forEach(term => {
        const chip = el(
          `<button class="npu-chip${term.value === selected ? " npu-chip--active" : ""}">${term.text}</button>`
        );
        chip.addEventListener("click", () => void render(terms, term.value));
        chips.appendChild(chip);
      });
      panel.body.appendChild(chips);

      const status = el(`<div class="npu-note">Betöltés...</div>`);
      panel.body.appendChild(status);

      try {
        const subjects = await api<RegisteredExamSubject[]>(
          `ExamRegisteredExams/GetRegisteredExamsList?request.termId=${selected}` +
            `&sortAndPage.firstRow=0&sortAndPage.lastRow=9999`
        );
        if (destroyed) {
          return;
        }
        status.remove();
        if (!subjects || subjects.length === 0) {
          panel.body.appendChild(el(`<div class="npu-note">Ebben a félévben nincs felvett vizsga.</div>`));
          return;
        }
        subjects.forEach(subject => {
          subject.registeredExamList.forEach(exam => {
            const { color, label } = classify(exam);
            const strength = exam.maxStrength ? ` · ${exam.strength}/${exam.maxStrength} fő` : "";
            panel.body.appendChild(
              el(
                `<div class="npu-item npu-item--${color}">` +
                  `<div class="npu-item__title">${subject.subjectName}</div>` +
                  `<div class="npu-item__meta">${subject.subjectCode} · ${exam.examType} · ${formatDate(exam.fromDate)}</div>` +
                  `<div class="npu-item__meta">${label}${exam.examTutors ? ` · ${exam.examTutors}` : ""}${strength}</div>` +
                  `</div>`
              )
            );
          });
        });
      } catch (error) {
        status.textContent = `Hiba a vizsgák betöltésekor: ${error instanceof Error ? error.message : error}`;
        status.className = "npu-error";
      }
    };

    void (async () => {
      try {
        const terms = await api<ExamTerm[]>("Exam/GetTerms");
        if (destroyed || !terms || terms.length === 0) {
          return;
        }
        const stored = storage.get<string>("examOverview", "term");
        const selected = terms.some(t => t.value === stored) ? stored! : terms[0].value;
        await render(terms, selected);
      } catch (error) {
        panel.body.innerHTML = "";
        panel.body.appendChild(
          el(`<div class="npu-error">Hiba: ${error instanceof Error ? error.message : error}</div>`)
        );
      }
    })();

    return () => {
      destroyed = true;
      panel.destroy();
    };
  },
};
