import { getSessionExpiration, isLoggedIn, isSessionLost } from "../core/api";
import { VERSION } from "../core/env";
import { injectCss } from "../core/dom";
import type { NpuModule } from "../core/modules";
import { OPEN_SETTINGS_EVENT } from "../core/settings";
import { getWatches } from "./courseWatch";
import { lastRefresh, running as keepAliveRunning } from "./keepAlive";

// Small fixed badge showing that NPU is active, plus session status. Lives
// outside the Angular DOM so re-renders cannot remove it. Its gear button is
// the entry point to the settings panel — which is why the badge itself is
// always-on and not listed among the toggleable modules.

function formatRemaining(expiration: Date | null): string {
  if (!expiration) {
    return "?";
  }
  const seconds = Math.max(0, Math.floor((expiration.getTime() - Date.now()) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export const statusBadge: NpuModule = {
  id: "statusBadge",
  alwaysOn: true,
  matches: () => true,
  activate() {
    injectCss(`
      #npu-badge {
        position: fixed;
        right: 10px;
        bottom: 10px;
        z-index: 99999;
        display: flex;
        align-items: center;
        gap: 8px;
        background: #1b2a5e;
        color: #fff;
        font: 12px/1.4 system-ui, sans-serif;
        padding: 6px 10px;
        border-radius: 6px;
        box-shadow: 0 1px 4px rgba(0,0,0,.35);
        opacity: .88;
        /* Informational, and it sits above the panels: it must never swallow
           a click meant for a panel's resize handle. Only the gear button
           accepts events. */
        pointer-events: none;
      }
      #npu-badge b { font-weight: 600; }
      #npu-badge .npu-ok { color: #7ee787; }
      #npu-badge .npu-warn { color: #ffc9c9; }
      #npu-badge .npu-watch { color: #ffd8a8; }
      #npu-badge .npu-off { color: #c9d1d9; opacity: .7; }
      #npu-badge .npu-gear {
        pointer-events: auto;
        cursor: pointer;
        border: 0;
        background: rgba(255,255,255,.12);
        color: #fff;
        font-size: 13px;
        line-height: 1;
        padding: 3px 6px;
        border-radius: 4px;
        opacity: .9;
      }
      #npu-badge .npu-gear:hover { background: rgba(255,255,255,.25); opacity: 1; }
    `);
    const badge = document.createElement("div");
    badge.id = "npu-badge";
    const text = document.createElement("span");
    const gear = document.createElement("button");
    gear.className = "npu-gear";
    gear.type = "button";
    gear.title = "NPU beállítások";
    gear.textContent = "⚙";
    gear.addEventListener("click", () => document.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT)));
    badge.append(text, gear);
    document.body.appendChild(badge);

    // Only the text span is re-rendered, so the gear keeps its listener and
    // hover state.
    const render = () => {
      if (isSessionLost()) {
        text.innerHTML = `<b>NPU ${VERSION}</b> · <span class="npu-warn">a munkamenet lejárt, lépj be újra</span>`;
      } else if (isLoggedIn()) {
        // Report the keep-alive's real state. It is switchable in the
        // settings, so claiming it is active whenever we are logged in would
        // be a comforting lie exactly when the session is unprotected.
        const keep = keepAliveRunning
          ? `<span class="npu-ok">kidobásvédelem ${
              lastRefresh
                ? `frissítve ${lastRefresh.toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" })}`
                : "aktív"
            }</span>`
          : `<span class="npu-off">kidobásvédelem ki</span>`;
        const watchCount = Object.keys(getWatches()).length;
        const watching = watchCount > 0 ? ` · <span class="npu-watch">🔔 ${watchCount} figyelve</span>` : "";
        text.innerHTML =
          `<b>NPU ${VERSION}</b> · munkamenet: ${formatRemaining(getSessionExpiration())} · ${keep}${watching}`;
      } else {
        text.innerHTML = `<b>NPU ${VERSION}</b>`;
      }
    };
    render();
    const timer = window.setInterval(render, 1000);
    return () => {
      window.clearInterval(timer);
      badge.remove();
    };
  },
};
