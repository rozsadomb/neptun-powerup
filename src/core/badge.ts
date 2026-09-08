import { IS_BETA, VERSION } from "./env";

// A jobb alsó NPU-jelvény kinézete és szövege — egy helyen, mert két helyen
// kell: a szkript valódi jelvényén (modules/statusBadge) és a weboldal
// bemutatóin (site/demo). Ami itt változik, az a weboldalon is megváltozik a
// következő buildnél, kézi másolás nélkül.
//
// Csak a megjelenés van itt (osztályokra írva); hogy a jelvény hol ül a
// képernyőn, azt a felhasználó (statusBadge: fixen a sarokban; a weboldal: a
// bemutató keretében) dönti el.

export const BADGE_CSS = `
  .npu-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: #1b2a5e;
    color: #fff;
    font: 12px/1.4 system-ui, sans-serif;
    padding: 6px 10px;
    border-radius: 6px;
    box-shadow: 0 1px 4px rgba(0,0,0,.35);
  }
  .npu-badge b { font-weight: 600; }
  .npu-badge .npu-beta { color: #ffd8a8; font-weight: 600; letter-spacing: .04em; }
  .npu-badge .npu-ok { color: #7ee787; }
  .npu-badge .npu-warn { color: #ffc9c9; }
  .npu-badge .npu-watch { color: #ffd8a8; }
  .npu-badge .npu-off { color: #c9d1d9; opacity: .7; }
  .npu-badge .npu-time { font-variant-numeric: tabular-nums; }
  .npu-badge .npu-gear {
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
  .npu-badge .npu-gear:hover { background: rgba(255,255,255,.25); opacity: 1; }
`;

/** „NPU 0.13.0 béta” — a verziószám a buildből jön, a címke az IS_BETA kapcsolóból. */
export function versionLabel(): string {
  return `<b>NPU ${VERSION}</b>${IS_BETA ? ` <span class="npu-beta">béta</span>` : ""}`;
}

export interface BadgeState {
  sessionLost?: boolean;
  loggedIn: boolean;
  /** „29:54” */
  remaining: string;
  keepAlive: "off" | "active" | { refreshedAt: string };
  watchCount: number;
}

/**
 * A jelvény szöveges része (a fogaskerék gomb nem: az a hívóé). A weboldal
 * bemutatói a .npu-time / .npu-keep / .npu-watch osztályokon frissítik a
 * mozgó részeket, ezért ezek stabilak.
 */
export function renderBadgeHtml(state: BadgeState): string {
  const name = versionLabel();
  if (state.sessionLost) {
    return `${name} · <span class="npu-warn">a munkamenet lejárt, lépj be újra</span> · <span class="npu-off">⚙ → napló</span>`;
  }
  if (!state.loggedIn) {
    return name;
  }
  const keep =
    state.keepAlive === "off"
      ? `<span class="npu-off npu-keep">kidobásvédelem ki</span>`
      : `<span class="npu-ok npu-keep">kidobásvédelem ${
          state.keepAlive === "active" ? "aktív" : `frissítve ${state.keepAlive.refreshedAt}`
        }</span>`;
  const watching = state.watchCount > 0 ? `<span class="npu-watch"> · 🔔 ${state.watchCount} figyelve</span>` : "";
  return `${name} · munkamenet: <span class="npu-time">${state.remaining}</span> · ${keep}${watching}`;
}
