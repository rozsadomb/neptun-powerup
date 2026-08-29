import { injectCss } from "./dom";
import * as storage from "./storage";

// Shared styling and a floating panel shell for NPU's own UI. Everything
// lives outside the Angular DOM so app re-renders cannot remove it.
//
// Panels are draggable by their header and resizable from every edge and
// corner; position, size and collapsed state are remembered per panel id.

const DEFAULT_WIDTH = 360;
const DEFAULT_HEIGHT = 420;
const DEFAULT_TOP = 90;
const MARGIN = 10;
const MIN_WIDTH = 260;
const MIN_HEIGHT = 120;
// How much of the panel must stay on screen, so it can always be grabbed back.
const KEEP_VISIBLE = 60;
const DRAG_THRESHOLD_PX = 4;

interface PanelGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
  collapsed: boolean;
}

let cssInjected = false;

function ensureCss(): void {
  if (cssInjected) {
    return;
  }
  cssInjected = true;
  injectCss(`
    .npu-panel {
      position: fixed;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      z-index: 99998;
      background: #fff;
      color: #1b2a5e;
      font: 13px/1.5 system-ui, sans-serif;
      border: 1px solid #c9d2e8;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(27,42,94,.25);
    }
    .npu-panel--dragging, .npu-panel--resizing {
      user-select: none;
      box-shadow: 0 6px 22px rgba(27,42,94,.4);
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
      cursor: move;
      user-select: none;
      flex: 0 0 auto;
      touch-action: none;
    }
    .npu-panel__title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .npu-panel__buttons { display: flex; gap: 2px; flex: 0 0 auto; }
    .npu-panel__btn {
      border: 0;
      background: transparent;
      color: #fff;
      opacity: .8;
      cursor: pointer;
      font: 13px/1 system-ui, sans-serif;
      padding: 2px 5px;
      border-radius: 4px;
    }
    .npu-panel__btn:hover { opacity: 1; background: rgba(255,255,255,.15); }
    .npu-panel__body {
      padding: 10px 12px;
      overflow: auto;
      flex: 1 1 auto;
      min-height: 0;
    }
    .npu-panel--collapsed { height: auto !important; }
    .npu-panel--collapsed .npu-panel__body { display: none; }
    .npu-panel--collapsed .npu-resize { display: none; }

    /* Resize handles: thin strips just outside the border, corners on top. */
    .npu-resize { position: absolute; touch-action: none; }
    .npu-resize--n { top: -4px; left: 10px; right: 10px; height: 8px; cursor: ns-resize; }
    .npu-resize--s { bottom: -4px; left: 10px; right: 10px; height: 8px; cursor: ns-resize; }
    .npu-resize--w { left: -4px; top: 10px; bottom: 10px; width: 8px; cursor: ew-resize; }
    .npu-resize--e { right: -4px; top: 10px; bottom: 10px; width: 8px; cursor: ew-resize; }
    .npu-resize--nw { top: -4px; left: -4px; width: 14px; height: 14px; cursor: nwse-resize; }
    .npu-resize--ne { top: -4px; right: -4px; width: 14px; height: 14px; cursor: nesw-resize; }
    .npu-resize--sw { bottom: -4px; left: -4px; width: 14px; height: 14px; cursor: nesw-resize; }
    .npu-resize--se { bottom: -4px; right: -4px; width: 14px; height: 14px; cursor: nwse-resize; }

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

function defaultGeometry(): PanelGeometry {
  return {
    left: Math.max(MARGIN, window.innerWidth - DEFAULT_WIDTH - MARGIN),
    top: DEFAULT_TOP,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    collapsed: false,
  };
}

function loadGeometry(id: string): PanelGeometry {
  const saved = storage.get<Partial<PanelGeometry>>("panels", id);
  const fallback = defaultGeometry();
  if (!saved || typeof saved !== "object") {
    return fallback;
  }
  const numberOr = (value: unknown, alt: number) => (typeof value === "number" && isFinite(value) ? value : alt);
  return {
    left: numberOr(saved.left, fallback.left),
    top: numberOr(saved.top, fallback.top),
    width: Math.max(MIN_WIDTH, numberOr(saved.width, fallback.width)),
    height: Math.max(MIN_HEIGHT, numberOr(saved.height, fallback.height)),
    collapsed: saved.collapsed === true,
  };
}

// Keeps the panel reachable: never let it be dragged or left fully offscreen.
//
// Only the position is constrained, and the size only from below. Capping the
// size to the viewport used to un-anchor the opposite edge while resizing (the
// edge being dragged away from would drift once the cap was hit) and let a
// drag on a small window shrink the remembered size. A panel larger than the
// window is the user's own choice, and the header stays grabbable regardless.
function clamp(geometry: PanelGeometry): PanelGeometry {
  const width = Math.max(geometry.width, MIN_WIDTH);
  const height = Math.max(geometry.height, MIN_HEIGHT);
  return {
    left: Math.min(Math.max(geometry.left, KEEP_VISIBLE - width), window.innerWidth - KEEP_VISIBLE),
    top: Math.min(Math.max(geometry.top, 0), window.innerHeight - 32),
    width,
    height,
    collapsed: geometry.collapsed,
  };
}

export interface Panel {
  body: HTMLElement;
  destroy(): void;
}

type Direction = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";
const DIRECTIONS: Direction[] = ["n", "s", "e", "w", "nw", "ne", "sw", "se"];

export function createPanel(id: string, title: string): Panel {
  ensureCss();
  document.getElementById(id)?.remove();

  const panel = document.createElement("div");
  panel.id = id;
  panel.className = "npu-panel";
  panel.innerHTML =
    `<div class="npu-panel__header">` +
    `<span class="npu-panel__title"></span>` +
    `<span class="npu-panel__buttons">` +
    `<button class="npu-panel__btn npu-panel__reset" title="Alaphelyzetbe állítás" type="button">⤢</button>` +
    `<button class="npu-panel__btn npu-panel__toggle" title="Összecsukás" type="button">−</button>` +
    `</span></div>` +
    `<div class="npu-panel__body"></div>`;
  panel.querySelector<HTMLElement>(".npu-panel__title")!.textContent = title;

  DIRECTIONS.forEach(direction => {
    const handle = document.createElement("div");
    handle.className = `npu-resize npu-resize--${direction}`;
    handle.dataset.direction = direction;
    panel.appendChild(handle);
  });

  const header = panel.querySelector<HTMLElement>(".npu-panel__header")!;
  const toggle = panel.querySelector<HTMLButtonElement>(".npu-panel__toggle")!;
  const reset = panel.querySelector<HTMLButtonElement>(".npu-panel__reset")!;

  // What the user asked for. Clamping is presentation only: a temporarily
  // tiny viewport (which happens while the tab is closing or the window is
  // being resized) must never shrink the remembered size permanently.
  let geometry = loadGeometry(id);

  let saveTimer: number | undefined;
  const persist = () => {
    storage.set("panels", id, {
      left: Math.round(geometry.left),
      top: Math.round(geometry.top),
      width: Math.round(geometry.width),
      height: Math.round(geometry.height),
      collapsed: geometry.collapsed,
    });
  };
  const save = () => {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(persist, 250);
  };

  const apply = () => {
    const visible = clamp(geometry);
    panel.style.left = `${visible.left}px`;
    panel.style.top = `${visible.top}px`;
    panel.style.width = `${visible.width}px`;
    panel.style.height = geometry.collapsed ? "auto" : `${visible.height}px`;
    panel.classList.toggle("npu-panel--collapsed", geometry.collapsed);
    toggle.textContent = geometry.collapsed ? "+" : "−";
    toggle.title = geometry.collapsed ? "Kinyitás" : "Összecsukás";
  };
  apply();

  // --- dragging by the header ---------------------------------------------
  let dragPointer: number | null = null;
  let dragStart = { x: 0, y: 0, left: 0, top: 0 };
  let dragMoved = false;

  const onHeaderPointerDown = (event: PointerEvent) => {
    // Buttons in the header keep their own click behaviour.
    if ((event.target as HTMLElement).closest(".npu-panel__btn")) {
      return;
    }
    if (event.button !== 0 || dragPointer !== null) {
      return;
    }
    dragPointer = event.pointerId;
    dragMoved = false;
    // Start from where the panel actually is, not from the stored intent:
    // the two differ when the viewport pushed the panel back into view.
    const visible = clamp(geometry);
    dragStart = { x: event.clientX, y: event.clientY, left: visible.left, top: visible.top };
    header.setPointerCapture(event.pointerId);
    panel.classList.add("npu-panel--dragging");
    event.preventDefault();
  };

  const onHeaderPointerMove = (event: PointerEvent) => {
    if (dragPointer !== event.pointerId) {
      return;
    }
    const dx = event.clientX - dragStart.x;
    const dy = event.clientY - dragStart.y;
    if (!dragMoved && Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) {
      return; // still a click, not a drag
    }
    dragMoved = true;
    // Dragging changes position only — never the remembered size.
    const moved = clamp({ ...geometry, left: dragStart.left + dx, top: dragStart.top + dy });
    geometry = { ...geometry, left: moved.left, top: moved.top };
    apply();
  };

  const endDrag = (event: PointerEvent) => {
    if (dragPointer !== event.pointerId) {
      return;
    }
    if (header.hasPointerCapture(event.pointerId)) {
      header.releasePointerCapture(event.pointerId);
    }
    dragPointer = null;
    panel.classList.remove("npu-panel--dragging");
    if (dragMoved) {
      save();
    }
  };

  header.addEventListener("pointerdown", onHeaderPointerDown);
  header.addEventListener("pointermove", onHeaderPointerMove);
  header.addEventListener("pointerup", endDrag);
  header.addEventListener("pointercancel", endDrag);

  const toggleCollapsed = () => {
    geometry.collapsed = !geometry.collapsed;
    apply();
    save();
  };

  // Clicking the header bar toggles, but a drag that happens to end there
  // must not, and the buttons keep their own behaviour.
  header.addEventListener("click", event => {
    if (dragMoved || (event.target as HTMLElement).closest(".npu-panel__btn")) {
      return;
    }
    toggleCollapsed();
  });
  toggle.addEventListener("click", toggleCollapsed);

  // --- resizing from every edge and corner ---------------------------------
  let resizePointer: number | null = null;
  let resizeDirection: Direction | null = null;
  let resizeStart = { x: 0, y: 0, left: 0, top: 0, width: 0, height: 0 };
  let activeHandle: HTMLElement | null = null;

  const onHandlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || resizePointer !== null) {
      return;
    }
    const handle = event.currentTarget as HTMLElement;
    resizePointer = event.pointerId;
    resizeDirection = handle.dataset.direction as Direction;
    activeHandle = handle;
    const visible = clamp(geometry);
    resizeStart = {
      x: event.clientX,
      y: event.clientY,
      left: visible.left,
      top: visible.top,
      width: visible.width,
      height: visible.height,
    };
    handle.setPointerCapture(event.pointerId);
    panel.classList.add("npu-panel--resizing");
    event.preventDefault();
    event.stopPropagation();
  };

  const onHandlePointerMove = (event: PointerEvent) => {
    if (resizePointer !== event.pointerId || !resizeDirection) {
      return;
    }
    const dx = event.clientX - resizeStart.x;
    const dy = event.clientY - resizeStart.y;
    let { left, top, width, height } = resizeStart;

    if (resizeDirection.includes("e")) {
      width = Math.max(MIN_WIDTH, resizeStart.width + dx);
    }
    if (resizeDirection.includes("s")) {
      height = Math.max(MIN_HEIGHT, resizeStart.height + dy);
    }
    if (resizeDirection.includes("w")) {
      // Dragging the left edge moves the origin, so clamp the width first to
      // keep the right edge anchored.
      width = Math.max(MIN_WIDTH, resizeStart.width - dx);
      left = resizeStart.left + (resizeStart.width - width);
    }
    if (resizeDirection.includes("n")) {
      height = Math.max(MIN_HEIGHT, resizeStart.height - dy);
      top = resizeStart.top + (resizeStart.height - height);
    }
    geometry = clamp({ ...geometry, left, top, width, height });
    apply();
  };

  const endResize = (event: PointerEvent) => {
    if (resizePointer !== event.pointerId) {
      return;
    }
    if (activeHandle?.hasPointerCapture(event.pointerId)) {
      activeHandle.releasePointerCapture(event.pointerId);
    }
    resizePointer = null;
    resizeDirection = null;
    activeHandle = null;
    panel.classList.remove("npu-panel--resizing");
    save();
  };

  panel.querySelectorAll<HTMLElement>(".npu-resize").forEach(handle => {
    handle.addEventListener("pointerdown", onHandlePointerDown);
    handle.addEventListener("pointermove", onHandlePointerMove);
    handle.addEventListener("pointerup", endResize);
    handle.addEventListener("pointercancel", endResize);
  });

  reset.addEventListener("click", () => {
    geometry = clamp({ ...defaultGeometry(), collapsed: geometry.collapsed });
    apply();
    save();
  });

  // A shrinking window must not leave the panel out of reach — but it must
  // not overwrite the remembered geometry either, so the panel returns to the
  // user's own size once there is room again.
  const onWindowResize = () => apply();
  window.addEventListener("resize", onWindowResize);

  document.body.appendChild(panel);

  return {
    body: panel.querySelector<HTMLElement>(".npu-panel__body")!,
    destroy: () => {
      window.clearTimeout(saveTimer);
      persist(); // flush any pending geometry change
      window.removeEventListener("resize", onWindowResize);
      panel.remove();
    },
  };
}

export function el(html: string): HTMLElement {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild as HTMLElement;
}
