import { getSessionExpiration, isLoggedIn, isSessionLost } from "../core/api";
import { VERSION } from "../core/env";
import { injectCss } from "../core/dom";
import type { NpuModule } from "../core/modules";
import { lastRefresh } from "./keepAlive";

// Small fixed badge showing that NPU is active, plus session status. Lives
// outside the Angular DOM so re-renders cannot remove it.

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
  matches: () => true,
  activate() {
    injectCss(`
      #npu-badge {
        position: fixed;
        right: 10px;
        bottom: 10px;
        z-index: 99999;
        background: #1b2a5e;
        color: #fff;
        font: 12px/1.4 system-ui, sans-serif;
        padding: 6px 10px;
        border-radius: 6px;
        box-shadow: 0 1px 4px rgba(0,0,0,.35);
        opacity: .88;
      }
      #npu-badge b { font-weight: 600; }
      #npu-badge .npu-ok { color: #7ee787; }
      #npu-badge .npu-warn { color: #ffc9c9; }
    `);
    const badge = document.createElement("div");
    badge.id = "npu-badge";
    document.body.appendChild(badge);

    const render = () => {
      if (isSessionLost()) {
        badge.innerHTML = `<b>NPU ${VERSION}</b> · <span class="npu-warn">a munkamenet lejárt, lépj be újra</span>`;
      } else if (isLoggedIn()) {
        const refreshed = lastRefresh
          ? `frissítve ${lastRefresh.toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" })}`
          : "aktív";
        badge.innerHTML =
          `<b>NPU ${VERSION}</b> · munkamenet: ${formatRemaining(getSessionExpiration())} · ` +
          `<span class="npu-ok">kidobásvédelem ${refreshed}</span>`;
      } else {
        badge.innerHTML = `<b>NPU ${VERSION}</b>`;
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
