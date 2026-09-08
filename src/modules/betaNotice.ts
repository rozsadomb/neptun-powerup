import { isLoggedIn, isSessionLost } from "../core/api";
import { diag, diagDump } from "../core/diag";
import { injectCss } from "../core/dom";
import { IS_BETA, VERSION } from "../core/env";
import type { NpuModule } from "../core/modules";
import { currentPath } from "../core/router";
import * as storage from "../core/storage";
import { el, ensureUiCss } from "../core/ui";

// Béta-értesítő: belépés után egyszer szól, hogy a szkript béta, és 25 perc
// használat után egyszer megkérdezi, elküldené-e a felhasználó a naplót. A
// napló akkor is számít, ha minden működött: csak abból derül ki, hogy az
// adott egyetemen tényleg kitart a munkamenet.
//
// Gyakoriság (a döntés tiszta függvényekben van, a tesztek azokat hajtják):
//   - bemutatkozó kártya: verziónként egyszer, „Ne mutasd többet” végleg elnémítja;
//   - emlékeztető: a fülön 25 perc folyamatos, bejelentkezett futás után,
//     naponta legfeljebb egyszer, és ebben a verzióban többé nem, ha a
//     felhasználó innen már másolt naplót;
//   - a másolás gomb vágólapra teszi a naplót és új fülön nyitja az űrlapot.
// Semmit nem küld magától: a napló csak a vágólapra kerül.

export const REMINDER_AFTER_MS = 25 * 60_000;
const TICK_MS = 5_000;
// Ha a vágólap-API nem válaszol (függő engedélykérés), ne lógjon a gomb.
const CLIPBOARD_TIMEOUT_MS = 1_500;
const SITE = "https://neptun-powerup.com";
const FORM_URL = `${SITE}/visszajelzes#naplo`;
const ABOUT_LOG_URL = `${SITE}/#naplo`;

export interface NoticeState {
  /** Melyik verzióban látta már a bemutatkozó kártyát. */
  introVersion?: string;
  /** „Ne mutasd többet” / „Ne kérd többet”: soha többé. */
  muted?: boolean;
  /** Melyik napon kérdezett utoljára (helyi dátum, ÉÉÉÉ-HH-NN). */
  reminderDay?: string;
  /** Melyik verzióban másolt már naplót innen: abban többé nem kér. */
  copiedVersion?: string;
}

export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function shouldShowIntro(state: NoticeState, version: string): boolean {
  return !state.muted && state.introVersion !== version;
}

export function shouldRemind(state: NoticeState, version: string, now: number): boolean {
  return !state.muted && state.copiedVersion !== version && state.reminderDay !== dayKey(now);
}

export interface DecideInput {
  state: NoticeState;
  version: string;
  now: number;
  /** Mióta fut a fül bejelentkezve (null, ha nincs belépve). */
  loggedSince: number | null;
  onLoginPage: boolean;
  visible: boolean;
  /** Ezen a fülön már volt bemutatkozó kártya: egy fülön egyszer elég. */
  introShownInTab: boolean;
  cardOpen: boolean;
}

export type Decision = "intro" | "reminder" | null;

export function decide(input: DecideInput): Decision {
  const { state, version, now, loggedSince, onLoginPage, visible, introShownInTab, cardOpen } = input;
  if (loggedSince === null || onLoginPage || cardOpen || !visible) {
    return null;
  }
  if (!introShownInTab && shouldShowIntro(state, version)) {
    return "intro";
  }
  if (now - loggedSince >= REMINDER_AFTER_MS && shouldRemind(state, version, now)) {
    return "reminder";
  }
  return null;
}

function readState(): NoticeState {
  const value = storage.get<NoticeState>("betaNotice");
  return value && typeof value === "object" ? value : {};
}

function patchState(patch: Partial<NoticeState>): void {
  Object.entries(patch).forEach(([key, value]) => storage.set("betaNotice", key, value));
}

let cssInjected = false;
function ensureCss(): void {
  if (cssInjected) {
    return;
  }
  cssInjected = true;
  ensureUiCss();
  injectCss(`
    #npu-notice {
      position: fixed;
      right: 10px;
      bottom: 48px;
      z-index: 99998;
      width: 340px;
      max-width: calc(100vw - 20px);
      box-sizing: border-box;
      background: #fff;
      color: #1b2a5e;
      font: 13px/1.5 system-ui, sans-serif;
      border: 1px solid #c9d2e8;
      border-left: 4px solid #f08c00;
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(27,42,94,.28);
      padding: 10px 12px;
      animation: npu-notice-in .18s ease-out;
    }
    @keyframes npu-notice-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { #npu-notice { animation: none; } }
    #npu-notice.npu-notice--green { border-left-color: #2f9e44; }
    #npu-notice .npu-notice__head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    #npu-notice .npu-notice__title { font-weight: 600; flex: 1 1 auto; }
    #npu-notice .npu-notice__tag {
      font: 600 10px/1.6 system-ui, sans-serif; letter-spacing: .06em; text-transform: uppercase;
      background: #fff3e0; color: #b35c00; border: 1px solid #ffd8a8; border-radius: 10px; padding: 0 7px;
    }
    #npu-notice.npu-notice--green .npu-notice__tag { background: #f0fbf2; color: #2b8a3e; border-color: #b2f2bb; }
    #npu-notice .npu-notice__close {
      border: 0; background: transparent; color: #5a6482; cursor: pointer;
      font: 15px/1 system-ui, sans-serif; padding: 2px 4px; border-radius: 4px;
    }
    #npu-notice .npu-notice__close:hover { background: #f1f4fb; }
    #npu-notice .npu-notice__text { color: #2c3757; margin: 0 0 8px; }
    #npu-notice .npu-notice__text b { color: #1b2a5e; }
    #npu-notice .npu-notice__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    #npu-notice .npu-notice__link {
      color: #5a6482; font-size: 12px; text-decoration: underline; cursor: pointer;
      background: none; border: 0; padding: 0; font-family: inherit;
    }
    #npu-notice .npu-notice__fine { color: #5a6482; font-size: 11px; margin: 6px 0 0; }
    #npu-notice textarea { width: 100%; box-sizing: border-box; height: 120px; margin-top: 6px; font: 11px/1.4 monospace; }
  `);
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const timeout = new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("timeout")), CLIPBOARD_TIMEOUT_MS));
    await Promise.race([navigator.clipboard.writeText(text), timeout]);
    return true;
  } catch {
    return false;
  }
}

function openInNewTab(url: string): void {
  window.open(url, "_blank", "noopener");
}

type CardKind = "intro" | "reminder" | "thanks";

interface Card {
  kind: CardKind;
  element: HTMLElement;
}

function buildCard(kind: CardKind, actions: { close(): void; mute(): void; copy(): Promise<boolean> }): Card {
  ensureCss();
  let html: string;
  if (kind === "intro") {
    html =
      `<div id="npu-notice" role="status">` +
      `<div class="npu-notice__head"><span class="npu-notice__title">Neptun PowerUp! NG</span>` +
      `<span class="npu-notice__tag">béta</span>` +
      `<button class="npu-notice__close" type="button" title="Bezárás">✕</button></div>` +
      `<p class="npu-notice__text">A szkript még béta. Ha <b>20-30 perc</b> használat után elküldöd a naplót, az akkor is nagy ` +
      `segítség, ha semmi hibát nem tapasztaltál: csak ebből derül ki, hogy a te egyetemeden is kitart a munkamenet. ` +
      `25 perc múlva szólok még egyszer.</p>` +
      `<div class="npu-notice__actions">` +
      `<button class="npu-button npu-button--subtle npu-ok" type="button">Rendben</button>` +
      `<a class="npu-notice__link npu-about" href="${ABOUT_LOG_URL}" target="_blank" rel="noopener">Mit tartalmaz a napló?</a>` +
      `<button class="npu-notice__link npu-mute" type="button">Ne mutasd többet</button>` +
      `</div></div>`;
  } else if (kind === "reminder") {
    html =
      `<div id="npu-notice" role="status">` +
      `<div class="npu-notice__head"><span class="npu-notice__title">Már 25 perce fut a szkript</span>` +
      `<span class="npu-notice__tag">béta</span>` +
      `<button class="npu-notice__close" type="button" title="Bezárás">✕</button></div>` +
      `<p class="npu-notice__text">Elküldenéd a naplót? A gomb a vágólapra másolja, és megnyitja a visszajelzés-űrlapot ` +
      `egy új fülön: ott csak beilleszted, és odaírod, melyik egyetemre jársz.</p>` +
      `<div class="npu-notice__actions">` +
      `<button class="npu-button npu-copy" type="button">Napló másolása + űrlap</button>` +
      `<button class="npu-button npu-button--subtle npu-ok" type="button">Később</button>` +
      `<button class="npu-notice__link npu-mute" type="button" style="margin-left:auto">Ne kérd többet</button>` +
      `</div>` +
      `<p class="npu-notice__fine">Tokent, sütit, Neptun-kódot, nevet nem tartalmaz, és magától sehova nem megy.</p>` +
      `</div>`;
  } else {
    html =
      `<div id="npu-notice" class="npu-notice--green" role="status">` +
      `<div class="npu-notice__head"><span class="npu-notice__title">Köszönöm!</span>` +
      `<span class="npu-notice__tag">másolva ✓</span>` +
      `<button class="npu-notice__close" type="button" title="Bezárás">✕</button></div>` +
      `<p class="npu-notice__text">A napló a vágólapodon van. Az űrlapon illeszd be a leírásba (Ctrl+V), és írd oda az ` +
      `egyetemed nevét. Ebben a verzióban többet nem kérem.</p>` +
      `<div class="npu-notice__actions">` +
      `<button class="npu-button npu-button--subtle npu-form" type="button">Űrlap megnyitása újra</button>` +
      `<button class="npu-button npu-button--subtle npu-ok" type="button">Bezárás</button>` +
      `</div></div>`;
  }
  const element = el(html);
  element.querySelector(".npu-notice__close")?.addEventListener("click", actions.close);
  element.querySelector(".npu-ok")?.addEventListener("click", actions.close);
  element.querySelector(".npu-mute")?.addEventListener("click", actions.mute);
  element.querySelector(".npu-form")?.addEventListener("click", () => openInNewTab(FORM_URL));
  const copyButton = element.querySelector<HTMLButtonElement>(".npu-copy");
  copyButton?.addEventListener("click", async () => {
    copyButton.disabled = true;
    await actions.copy();
  });
  return { kind, element };
}

export const betaNotice: NpuModule = {
  id: "betaNotice",
  matches: () => IS_BETA,
  activate() {
    let loggedSince: number | null = null;
    let introShownInTab = false;
    let card: Card | null = null;
    let deciding = false;

    const close = () => {
      card?.element.remove();
      card = null;
    };

    const show = (kind: CardKind) => {
      close();
      card = buildCard(kind, {
        close,
        mute: () => {
          patchState({ muted: true });
          diag("béta-értesítő: elnémítva");
          close();
        },
        copy: async () => {
          const text = diagDump();
          const copied = await copyToClipboard(text);
          patchState({ copiedVersion: VERSION });
          diag(`napló ${copied ? "vágólapra másolva" : "megjelenítve"} az emlékeztetőből`);
          show("thanks");
          if (!copied && card) {
            // Nincs vágólap-hozzáférés: a szöveg itt van, kijelölve.
            const area = document.createElement("textarea");
            area.readOnly = true;
            area.value = text;
            card.element.appendChild(area);
            area.select();
            card.element.querySelector(".npu-notice__title")!.textContent = "Még egy lépés";
            card.element.querySelector(".npu-notice__tag")!.textContent = "napló";
            card.element.querySelector(".npu-notice__text")!.textContent =
              "A vágólapra nem tudtam tenni: jelöld ki lent és másold (Ctrl+C), az űrlapon illeszd be, és írd oda az egyetemed nevét.";
          }
          openInNewTab(FORM_URL);
          return copied;
        },
      });
      document.body.appendChild(card.element);
    };

    const tick = async () => {
      if (deciding) {
        return;
      }
      const loggedIn = isLoggedIn() && !isSessionLost();
      if (!loggedIn) {
        loggedSince = null;
        if (card && card.kind !== "thanks") {
          close();
        }
        return;
      }
      if (loggedSince === null) {
        loggedSince = Date.now();
      }
      const now = Date.now();
      const input = {
        version: VERSION,
        now,
        loggedSince,
        onLoginPage: currentPath().startsWith("/login"),
        visible: document.visibilityState === "visible",
        introShownInTab,
        cardOpen: card !== null,
      };
      // Előszűrés a helyi állapottal; csak akkor olvasunk újra a tárolóból,
      // ha az alapján lenne mit mutatni (egy másik fül közben dönthetett).
      if (decide({ state: readState(), ...input }) === null) {
        return;
      }
      deciding = true;
      try {
        await storage.reload();
        const decision = decide({ state: readState(), ...input });
        if (decision === "intro") {
          introShownInTab = true;
          patchState({ introVersion: VERSION });
          diag("béta-értesítő: bemutatkozó kártya");
          show("intro");
        } else if (decision === "reminder") {
          patchState({ reminderDay: dayKey(now) });
          diag("béta-értesítő: napló-emlékeztető");
          show("reminder");
        }
      } finally {
        deciding = false;
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => void tick(), TICK_MS);
    void tick();

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      close();
    };
  },
};
