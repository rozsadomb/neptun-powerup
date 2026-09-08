import { BADGE_CSS, renderBadgeHtml } from "../core/badge";
import { injectCss } from "../core/dom";
import { VERSION } from "../core/env";
import { buildPanelShell, el } from "../core/ui";

// A weboldal bemutatói (neptun-powerup.com): a szkript VALÓDI keretei és
// stílusai — a panel héja a core/ui-ból, a jelvény a core/badge-ből, a
// verziószám a buildből —, kitalált tárgyakkal. Ebből lesz a site/demo.js a
// `npm run build:site` során, ezért ami a szkripten változik (kinézet,
// verzió, „béta” címke), az a következő kiadással a weboldalon is változik,
// kézi másolás nélkül. A gombok viselkedését a site/app.js adja hozzá a
// data-act / id horgokon.

declare global {
  interface Window {
    NPU_DEMO?: { version: string };
  }
}

interface ItemSpec {
  course?: string;
  title: string;
  credit: string;
  meta: string;
  /** app.js ezt írja át, amikor „felszabadul egy hely”. */
  metaHook?: boolean;
  actions: string;
  green?: boolean;
}

const SIGNUP = `<button class="npu-button" type="button" data-act="signup">Felvétel</button>`;

const HERO_ITEMS: ItemSpec[] = [
  { course: "analizis", title: "Analízis 1 informatikusoknak", credit: "6 kredit", meta: "E1 (Elmélet) · 212/240 fő", actions: SIGNUP },
  {
    course: "digit",
    title: "Digitális technika",
    credit: "5 kredit",
    meta: "L1 (Labor) · 24/24 fő · BETELT · 3 várólistán",
    metaHook: true,
    actions: `<button class="npu-button npu-button--subtle" type="button" data-act="watch">🔔 figyelem</button>`,
  },
  { course: "prog", title: "A programozás alapjai 1", credit: "7 kredit", meta: "G2 (Gyakorlat) · 118/140 fő", actions: SIGNUP },
];

const RETRY_ITEMS: ItemSpec[] = [
  {
    title: "Számítógép-architektúrák",
    credit: "4 kredit",
    meta: "E1 (Elmélet) · 96/120 fő",
    actions: `<span class="npu-ok-text">felvéve</span>`,
    green: true,
  },
  {
    title: "Adatbázisok",
    credit: "5 kredit",
    meta: "L3 (Labor) · 20/20 fő · BETELT · 1 várólistán",
    actions:
      `<button class="npu-button" type="button" disabled tabindex="-1">Próba #4...</button>` +
      `<span class="npu-note" style="margin:0">újrapróbálás 10 mp-enként</span>`,
  },
];

function buildItem(spec: ItemSpec): HTMLElement {
  const item = el(
    `<div class="npu-item${spec.green ? " npu-item--green" : ""}">` +
      `<div class="npu-item__title"><span></span><span class="npu-credit"></span></div>` +
      `<div class="npu-item__meta"></div>` +
      `<div class="npu-actions">${spec.actions}</div>` +
      `</div>`
  );
  if (spec.course) {
    item.dataset.course = spec.course;
  }
  item.querySelector<HTMLElement>(".npu-item__title > span")!.textContent = spec.title;
  item.querySelector<HTMLElement>(".npu-credit")!.textContent = spec.credit;
  const meta = item.querySelector<HTMLElement>(".npu-item__meta")!;
  meta.textContent = spec.meta;
  if (spec.metaHook) {
    meta.dataset.meta = "";
  }
  return item;
}

function buildPanel(kind: string, host: HTMLElement): void {
  const shell = buildPanelShell(`npu-demo-${kind}`, "NPU · Gyorsfelvétel");
  // A fejléc gombjai a bemutatóban nem csinálnak semmit; ne legyenek fókuszálhatók.
  shell.panel.querySelectorAll<HTMLButtonElement>(".npu-panel__btn").forEach(button => {
    button.disabled = true;
    button.tabIndex = -1;
  });
  if (kind === "hero") {
    shell.body.appendChild(el(`<div class="npu-note">Betervezett, még fel nem vett tárgyak: <b id="demoCount">3</b></div>`));
    HERO_ITEMS.forEach(spec => shell.body.appendChild(buildItem(spec)));
    shell.body.appendChild(
      el(`<button class="npu-button npu-button--subtle" type="button" data-act="all" id="demoAll">Mindet felveszi (2)</button>`)
    );
  } else {
    RETRY_ITEMS.forEach(spec => shell.body.appendChild(buildItem(spec)));
  }
  // A helyőrző jelölői (role, aria-label) átkerülnek a kész panelre.
  Array.from(host.attributes).forEach(({ name, value }) => {
    if (name !== "data-npu-panel" && name !== "class") {
      shell.panel.setAttribute(name, value);
    }
  });
  host.replaceWith(shell.panel);
}

function renderBadges(): void {
  document.querySelectorAll<HTMLElement>("[data-npu-badge]").forEach(badge => {
    const watchCount = Number(badge.dataset.watch ?? "0");
    badge.innerHTML =
      renderBadgeHtml({ loggedIn: true, remaining: "29:54", keepAlive: "active", watchCount }) +
      `<span class="npu-gear" aria-hidden="true">⚙</span>`;
    // A figyelés-jelzés csak akkor jelenik meg, amikor a bemutatóban valaki
    // rákattint a „figyelem” gombra (app.js).
    badge.querySelectorAll<HTMLElement>(".npu-watch").forEach(watch => (watch.hidden = true));
  });
}

injectCss(BADGE_CSS);
document.querySelectorAll<HTMLElement>("[data-npu-panel]").forEach(host => buildPanel(host.dataset.npuPanel!, host));
renderBadges();
window.NPU_DEMO = { version: VERSION };
