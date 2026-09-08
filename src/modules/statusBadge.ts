import { getSessionExpiration, isLoggedIn, isSessionLost } from "../core/api";
import { BADGE_CSS, renderBadgeHtml } from "../core/badge";
import { injectCss } from "../core/dom";
import type { NpuModule } from "../core/modules";
import { OPEN_SETTINGS_EVENT } from "../core/settings";
import { getWatches } from "./courseWatch";
import { lastRefresh, running as keepAliveRunning } from "./keepAlive";

// Small fixed badge showing that NPU is active, plus session status. Lives
// outside the Angular DOM so re-renders cannot remove it. Its gear button is
// the entry point to the settings panel — which is why the badge itself is
// always-on and not listed among the toggleable modules.
//
// Look and wording live in core/badge.ts, shared with the website's demos.

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
    injectCss(BADGE_CSS);
    injectCss(`
      #npu-badge {
        position: fixed;
        right: 10px;
        bottom: 10px;
        z-index: 99999;
        display: flex;
        opacity: .88;
        /* Informational, and it sits above the panels: it must never swallow
           a click meant for a panel's resize handle. Only the gear button
           accepts events. */
        pointer-events: none;
      }
      #npu-badge .npu-gear { pointer-events: auto; }
    `);
    const badge = document.createElement("div");
    badge.id = "npu-badge";
    badge.className = "npu-badge";
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
    // hover state. The keep-alive's REAL state is reported: it is switchable
    // in the settings, so claiming it is active whenever we are logged in
    // would be a comforting lie exactly when the session is unprotected.
    const render = () => {
      text.innerHTML = renderBadgeHtml({
        sessionLost: isSessionLost(),
        loggedIn: isLoggedIn(),
        remaining: formatRemaining(getSessionExpiration()),
        keepAlive: !keepAliveRunning
          ? "off"
          : lastRefresh
            ? { refreshedAt: lastRefresh.toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" }) }
            : "active",
        watchCount: Object.keys(getWatches()).length,
      });
    };
    render();
    const timer = window.setInterval(render, 1000);
    return () => {
      window.clearInterval(timer);
      badge.remove();
    };
  },
};
