import { log } from "../core/env";
import type { NpuModule } from "../core/modules";

// Auto-dismisses Neptun's recurring informational modals — the ones that
// interrupt with a single "Rendben" button and a "Ne jelenjen meg többször"
// checkbox (e.g. "A tervezőhöz adott kurzusok az Órarendtervezőben
// találhatóak").
//
// Safety rule: a dialog is only dismissed when BOTH conditions hold —
//   1. it contains the "ne jelenjen meg többször" checkbox (that marks it as
//      a recurring informational nag, by the app's own admission), and
//   2. it has exactly ONE labelled button, whose text is a pure
//      acknowledgement ("Rendben"/"Bezárás"/"OK").
// Anything with two buttons (Megerősítés/Mégse, Tárgyak megjelenítése/
// Kihagyás...) is a real decision and is never touched. We close the dialog
// but do NOT tick the checkbox: that would permanently change the user's
// Neptun profile, and this behaviour should stop when NPU is removed.

const CHECKBOX_NEEDLE = "ne jelenjen meg többször";
const SAFE_LABELS = new Set(["rendben", "bezárás", "ok", "értem"]);

export const popupDismiss: NpuModule = {
  id: "popupDismiss",
  matches: () => true,
  activate() {
    const seen = new WeakSet<Element>();
    let scheduled = false;

    const scan = () => {
      scheduled = false;
      const dialogs = document.querySelectorAll(
        ".cdk-overlay-container [role='dialog'], .cdk-overlay-container mat-dialog-container"
      );
      dialogs.forEach(dialog => {
        if (seen.has(dialog)) {
          return;
        }
        const text = (dialog.textContent ?? "").toLowerCase();
        if (!text.includes(CHECKBOX_NEEDLE)) {
          seen.add(dialog);
          return;
        }
        const labelled = [...dialog.querySelectorAll<HTMLButtonElement>("button")].filter(
          button => (button.textContent ?? "").trim().length > 0
        );
        if (labelled.length !== 1) {
          seen.add(dialog); // a real decision — leave it to the user
          return;
        }
        const label = labelled[0].textContent!.trim().toLowerCase();
        if (!SAFE_LABELS.has(label)) {
          seen.add(dialog);
          return;
        }
        seen.add(dialog);
        labelled[0].click();
        log(`informational popup dismissed ("${labelled[0].textContent!.trim()}")`);
      });
    };

    const schedule = () => {
      if (!scheduled) {
        scheduled = true;
        window.requestAnimationFrame(scan);
      }
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    scan();
    return () => observer.disconnect();
  },
};
