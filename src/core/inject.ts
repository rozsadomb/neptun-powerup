// Helpers for placing NPU controls inside Neptun's own UI.
//
// The app rebuilds parts of the DOM on its own schedule (changing the sort
// order rebuilds the whole subject list, for example), so injected controls
// disappear without warning. Two rules follow, and both are enforced here:
//
//  1. Re-inject continuously — a MutationObserver re-runs the placement after
//     every render, and `data-npu-*` markers keep it idempotent.
//  2. Never cache which row a control belongs to. Angular reuses DOM nodes,
//     so after a re-sort the same element shows a different subject. Every
//     control resolves its target from the row's current content at click
//     time, which is why `attach` receives the host element, not an id.

export interface InjectionSpec {
  /** Marker used to recognise our own node; also the data attribute suffix. */
  id: string;
  /** Rows to decorate, e.g. "neptun-subject-list-item". */
  hostSelector: string;
  /**
   * Places the control inside one row. Called again after re-renders, so it
   * must be cheap and must read everything it needs from `host`.
   * Return false if the row is not ready yet (it will be retried).
   */
  attach(host: HTMLElement): boolean;
}

/**
 * Clones one of the app's own buttons so ours inherits the exact styling,
 * then rewrites its label and icon. Falls back to a plain button when no
 * template is available.
 */
export function cloneAppButton(template: HTMLElement | null, label: string, iconClass?: string): HTMLButtonElement {
  if (template) {
    const button = template.cloneNode(true) as HTMLButtonElement;
    button.removeAttribute("id");
    button.disabled = false;
    const labelNode = button.querySelector<HTMLElement>(".neptun-button__label");
    if (labelNode) {
      labelNode.textContent = label;
    } else {
      button.textContent = label;
    }
    const icon = button.querySelector<HTMLElement>(".neptun-button__prefix-icon");
    if (icon && iconClass) {
      icon.className = icon.className.replace(/icon-[a-z0-9-]+/, iconClass);
    }
    // Hidden helper text used by the app for screen readers would now lie.
    button.querySelectorAll(".cdk-visually-hidden").forEach(node => node.remove());
    return button;
  }
  const fallback = document.createElement("button");
  fallback.type = "button";
  fallback.textContent = label;
  return fallback;
}

// Neptun renders a spelled-out copy of codes for screen readers next to the
// visible one ("Kurzuskód: T 0" beside "T0"). It is invisible but lands in
// textContent, so it has to be stripped before any code can be matched.
export function visibleText(node: Element | null | undefined): string {
  if (!node) {
    return "";
  }
  const clone = node.cloneNode(true) as HTMLElement;
  // Replaced by a space rather than removed: the hidden spans also carry the
  // separators between fields, so deleting them glues values together
  // ("Évközi jegyBMETE47A004") and defeats word-boundary matching.
  clone.querySelectorAll(".cdk-visually-hidden, [hidden]").forEach(hidden => hidden.replaceWith(" "));
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Reads the subject code (e.g. "BMETE47A004") out of a subject row. */
export function subjectCodeOf(host: HTMLElement): string | null {
  const info = visibleText(host.querySelector(".subject-container__informations"));
  const match = info.match(/\b[A-Z]{2,}[A-Z0-9]*\d[A-Z0-9-]*\b/);
  return match ? match[0] : null;
}

/** Reads the course code (e.g. "T0") out of a course row. */
export function courseCodeOf(host: HTMLElement): string | null {
  const code = visibleText(host.querySelector(".code-with-time__code"));
  return code ? code.replace(/\s+/g, " ") : null;
}

const observers = new Map<string, MutationObserver>();

/**
 * Keeps a control present in every matching row, re-injecting after the app
 * re-renders. Returns a function that stops observing and removes the nodes.
 */
export function inject(spec: InjectionSpec): () => void {
  // An attribute, not dataset: ids contain hyphens, and dataset rejects those
  // property names with a SyntaxError.
  const marker = `data-npu-done-${spec.id}`;
  let scheduled = false;

  const run = () => {
    scheduled = false;
    document.querySelectorAll<HTMLElement>(spec.hostSelector).forEach(host => {
      // The marker lives on the host, so a rebuilt row (new node, no marker)
      // is decorated again automatically.
      if (host.getAttribute(marker) === "1" && host.querySelector(`[data-npu-control="${spec.id}"]`)) {
        return;
      }
      try {
        if (spec.attach(host)) {
          host.setAttribute(marker, "1");
        }
      } catch (error) {
        console.error(`[NPU] injection ${spec.id} failed`, error);
      }
    });
  };

  const schedule = () => {
    if (!scheduled) {
      scheduled = true;
      // Coalesce the burst of mutations a single Angular render produces.
      window.requestAnimationFrame(run);
    }
  };

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  observers.set(spec.id, observer);
  run();

  return () => {
    observer.disconnect();
    observers.delete(spec.id);
    document.querySelectorAll(`[data-npu-control="${spec.id}"]`).forEach(node => node.remove());
    document.querySelectorAll<HTMLElement>(spec.hostSelector).forEach(host => host.removeAttribute(marker));
  };
}
