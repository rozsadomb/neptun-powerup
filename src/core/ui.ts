import { injectCss } from "./dom";

// Shared styling and a floating panel shell for NPU's own UI. Everything
// lives outside the Angular DOM so app re-renders cannot remove it.

let cssInjected = false;

function ensureCss(): void {
  if (cssInjected) {
    return;
  }
  cssInjected = true;
  injectCss(`
    .npu-panel {
      position: fixed;
      top: 90px;
      right: 10px;
      width: 360px;
      max-height: calc(100vh - 160px);
      display: flex;
      flex-direction: column;
      z-index: 99998;
      background: #fff;
      color: #1b2a5e;
      font: 13px/1.5 system-ui, sans-serif;
      border: 1px solid #c9d2e8;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(27,42,94,.25);
    }
    .npu-panel__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 12px;
      background: #1b2a5e;
      color: #fff;
      border-radius: 7px 7px 0 0;
      font-weight: 600;
      cursor: pointer;
      user-select: none;
    }
    .npu-panel__toggle { font-weight: 400; opacity: .8; }
    .npu-panel__body { padding: 10px 12px; overflow-y: auto; }
    .npu-panel--collapsed .npu-panel__body { display: none; }
    .npu-chiprow { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .npu-chip {
      border: 1px solid #c9d2e8;
      border-radius: 12px;
      background: #f1f4fb;
      color: #1b2a5e;
      padding: 2px 10px;
      cursor: pointer;
      font: 12px system-ui, sans-serif;
    }
    .npu-chip--active { background: #1b2a5e; color: #fff; border-color: #1b2a5e; }
    .npu-item {
      border: 1px solid #e3e7f2;
      border-left: 4px solid #adb5bd;
      border-radius: 6px;
      padding: 6px 8px;
      margin-bottom: 8px;
    }
    .npu-item__title { font-weight: 600; }
    .npu-item__meta { color: #5a6482; font-size: 12px; }
    .npu-item--green { border-left-color: #2f9e44; background: #f0fbf2; }
    .npu-item--red { border-left-color: #e03131; background: #fff5f5; }
    .npu-item--yellow { border-left-color: #f08c00; background: #fffaeb; }
    .npu-item--blue { border-left-color: #2b6cb0; background: #f3f8fd; }
    .npu-button {
      border: 0;
      border-radius: 5px;
      background: #2b6cb0;
      color: #fff;
      padding: 4px 10px;
      cursor: pointer;
      font: 12px system-ui, sans-serif;
    }
    .npu-button:disabled { opacity: .5; cursor: default; }
    .npu-button--danger { background: #e03131; }
    .npu-button--subtle { background: #f1f4fb; color: #1b2a5e; border: 1px solid #c9d2e8; }
    .npu-note { color: #5a6482; font-size: 12px; margin: 6px 0; }
    .npu-error { color: #c92a2a; font-size: 12px; margin-top: 4px; white-space: pre-wrap; }
  `);
}

export interface Panel {
  body: HTMLElement;
  destroy(): void;
}

export function createPanel(id: string, title: string): Panel {
  ensureCss();
  document.getElementById(id)?.remove();

  const panel = document.createElement("div");
  panel.id = id;
  panel.className = "npu-panel";
  panel.innerHTML =
    `<div class="npu-panel__header"><span>${title}</span>` +
    `<span class="npu-panel__toggle">−</span></div>` +
    `<div class="npu-panel__body"></div>`;
  const header = panel.querySelector<HTMLElement>(".npu-panel__header")!;
  const toggle = panel.querySelector<HTMLElement>(".npu-panel__toggle")!;
  header.addEventListener("click", () => {
    panel.classList.toggle("npu-panel--collapsed");
    toggle.textContent = panel.classList.contains("npu-panel--collapsed") ? "+" : "−";
  });
  document.body.appendChild(panel);
  return {
    body: panel.querySelector<HTMLElement>(".npu-panel__body")!,
    destroy: () => panel.remove(),
  };
}

export function el(html: string): HTMLElement {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild as HTMLElement;
}
