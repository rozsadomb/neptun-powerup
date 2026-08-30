import { waitFor } from "../core/dom";
import { log } from "../core/env";
import type { NpuModule } from "../core/modules";
import * as storage from "../core/storage";

// The exam pages always default to the current term, so outside the exam
// period they open empty ("Nincsenek felvett vizsgák"). Remember the term the
// user last filtered to — per page — and re-apply it automatically, like the
// old NPU's term selector memory.
//
// The Félév filter is an Angular Material select with a stable id
// (#termIdSelect). Driving it means real clicks: open the select, click the
// matching mat-option in the overlay, then press "Lista szűrése". Verified
// live on the results page.

const SUBMIT_LABEL = "Lista szűrése";

function normalise(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function termSelect(): HTMLElement | null {
  return document.getElementById("termIdSelect");
}

function submitButton(): HTMLButtonElement | null {
  return (
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      button => normalise(button.textContent ?? "") === SUBMIT_LABEL
    ) ?? null
  );
}

function filterToggle(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>("neptun-filter-button button");
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

export const termMemory: NpuModule = {
  id: "termMemory",
  matches: path => path.startsWith("/exams"),
  activate() {
    let cancelled = false;
    const pageKey = location.pathname;

    // Remember what the user filters to: at the moment of submitting, the
    // select shows the term they chose.
    const saveListener = (event: Event) => {
      const button = (event.target as HTMLElement).closest("button");
      if (!button || normalise(button.textContent ?? "") !== SUBMIT_LABEL) {
        return;
      }
      const value = normalise(termSelect()?.textContent ?? "");
      if (value) {
        storage.set("termMemory", pageKey, value);
      }
    };
    document.addEventListener("click", saveListener, true);

    // Re-apply the stored term once per visit.
    void (async () => {
      const stored = storage.get<string>("termMemory", pageKey);
      if (!stored) {
        return;
      }
      // The page builds asynchronously, and its own default query races us:
      // filtering too early gets overwritten when the slower initial load
      // lands. Wait for the filter controls AND the first result set (cards
      // or the "no data" placeholder) before re-applying the stored term.
      const anchor = await waitFor("#termIdSelect, neptun-filter-button button", { timeoutMs: 10_000 });
      if (!anchor || cancelled) {
        return;
      }
      await waitFor(
        "neptun-result-card, neptun-card, neptun-data-missing-placeholder, [class*='list-item']",
        { timeoutMs: 12_000 }
      );
      if (cancelled) {
        return;
      }
      await sleep(600);
      if (cancelled) {
        return;
      }

      let openedPanel = false;
      if (!termSelect()) {
        filterToggle()?.click();
        openedPanel = true;
        await waitFor("#termIdSelect", { timeoutMs: 5000 });
        await sleep(400);
      }

      // Click, then VERIFY before submitting: a Material select sometimes
      // swallows an early click, and filtering with the wrong (default) value
      // was exactly the failure this loop eliminates. The select is re-read
      // every round — Angular may have re-rendered it under our feet.
      let optionExisted = false;
      for (let attempt = 1; attempt <= 3 && !cancelled; attempt++) {
        const select = termSelect();
        if (!select) {
          await sleep(600);
          continue;
        }
        if (normalise(select.textContent ?? "").includes(stored)) {
          if (attempt === 1) {
            // Nothing to change; close the panel if we opened it to check.
            if (openedPanel) {
              filterToggle()?.click();
            }
            return;
          }
          submitButton()?.click();
          log(`term "${stored}" re-applied on ${pageKey}`);
          return;
        }
        select.click();
        await sleep(700);
        const option = [...document.querySelectorAll<HTMLElement>("mat-option")].find(
          candidate => normalise(candidate.textContent ?? "") === stored
        );
        if (option) {
          optionExisted = true;
          option.click();
          await sleep(600);
        } else {
          document.querySelector<HTMLElement>(".cdk-overlay-backdrop")?.click();
          await sleep(400);
        }
      }

      // Could not apply. If the stored term does not exist any more (a new
      // academic year), forget it so we stop trying on every visit.
      if (!optionExisted) {
        storage.set("termMemory", pageKey, null);
      }
      if (openedPanel) {
        filterToggle()?.click();
      }
    })();

    return () => {
      cancelled = true;
      document.removeEventListener("click", saveListener, true);
    };
  },
};
