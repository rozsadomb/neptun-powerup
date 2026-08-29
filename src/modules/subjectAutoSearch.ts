import { waitFor } from "../core/dom";
import { log } from "../core/env";
import type { NpuModule } from "../core/modules";

// On the subject registration page the list only loads after clicking the
// "Tárgy keresése" button; click it automatically once per visit. The form
// initializes asynchronously (terms load first), so a too-early click is
// ignored — retry until the result area actually appears.

const BUTTON_TEXT = "Tárgy keresése";
const MAX_ATTEMPTS = 5;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function findButton(): HTMLButtonElement | null {
  for (const button of document.querySelectorAll<HTMLButtonElement>("button")) {
    if ((button.textContent ?? "").includes(BUTTON_TEXT)) {
      return button;
    }
  }
  return null;
}

// The result area (with its legend) only renders once a search has run.
function resultsPresent(): boolean {
  return (document.body.textContent ?? "").includes("Jelmagyarázat");
}

export const subjectAutoSearch: NpuModule = {
  id: "subjectAutoSearch",
  matches: path => path.startsWith("/hallgatoi/subjects/registration"),
  activate() {
    let cancelled = false;
    void (async () => {
      const button = await waitFor("button", { text: BUTTON_TEXT });
      if (!button || cancelled) {
        return;
      }
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !cancelled; attempt++) {
        await sleep(attempt === 1 ? 1200 : 2500);
        if (cancelled || resultsPresent()) {
          return;
        }
        findButton()?.click();
        log(`subject search triggered automatically (attempt ${attempt})`);
      }
    })();
    return () => {
      cancelled = true;
    };
  },
};
