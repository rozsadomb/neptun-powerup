import { diagDump } from "../core/diag";
import { VERSION } from "../core/env";
import { isActivityPingEnabled, isAppRefreshEnabled, setActivityPingEnabled, setAppRefreshEnabled } from "./keepAlive";
import type { NpuModule } from "../core/modules";
import { isModuleEnabled, OPEN_SETTINGS_EVENT, setModuleEnabled } from "../core/settings";
import * as storage from "../core/storage";
import { createPanel, el, type Panel } from "../core/ui";

// Per-module switches, opened from the status badge's gear button. Toggles
// apply immediately: the module runner deactivates/reactivates the module on
// the spot, no reload needed.

interface SettingEntry {
  label: string;
  description: string;
  /** Module id toggled through the runner... */
  moduleId?: string;
  /** ...or a custom storage-backed switch (backToLastPage's own opt-in). */
  custom?: { get(): boolean; set(value: boolean): void };
}

const ENTRIES: SettingEntry[] = [
  {
    moduleId: "keepAlive",
    label: "Kidobásvédelem",
    description: "A munkamenet életben tartása, hogy a Neptun ne léptessen ki tétlenség miatt (a limit egyetemenként más: BME 30, ÓE 15 perc).",
  },
  {
    label: "Frissítés a Neptun saját mechanizmusán át (kísérleti)",
    description:
      "A token-frissítést nem a szkript küldi, hanem megkéri rá magát a Neptunt — pontosan úgy frissít, ahogy magától tenné. Ha a Neptun nem reagál 10 mp-en belül, a szkript maga frissít.",
    custom: { get: isAppRefreshEnabled, set: setAppRefreshEnabled },
  },
  {
    label: "Tevékenység-jelzés a szervernek (kísérleti)",
    description:
      "4 percenként egy apró, csak olvasó kérés (UserInfo). Egy debreceni naplóban nem segített, ezért alapból ki van kapcsolva; más egyetemen még érdemes lehet kipróbálni.",
    custom: { get: isActivityPingEnabled, set: setActivityPingEnabled },
  },
  {
    moduleId: "quickSignup",
    label: "Gyorsfelvétel panel",
    description: "A betervezett kurzusok egykattintásos felvétele a Tárgyfelvétel oldalon.",
  },
  {
    moduleId: "subjectInlineControls",
    label: "Gombok a Neptun kártyáin",
    description: "Felvétel- és figyelés-gombok közvetlenül a tárgyak és kurzusok sorában.",
  },
  {
    moduleId: "courseWatch",
    label: "Helyfigyelő",
    description: "A figyelt betelt kurzusok ellenőrzése a háttérben, értesítéssel.",
  },
  {
    moduleId: "subjectAutoSearch",
    label: "Automatikus tárgylistázás",
    description: "A tárgylista magától betölt, nem kell a „Tárgy keresése” gombra kattintani.",
  },
  {
    moduleId: "subjectHistory",
    label: "Tárgyelőzmény színezés",
    description: "A Tárgyfelvétel listáján megjelöli, amit korábbi félévben már felvettél, de nincs meg.",
  },
  {
    moduleId: "examOverview",
    label: "Vizsga-áttekintés panel",
    description: "Színezett vizsgalista félévválasztóval a Vizsgák oldalain.",
  },
  {
    moduleId: "termMemory",
    label: "Félévválasztó-memória",
    description: "A vizsgaoldalakon megjegyzi és visszaállítja az utoljára választott félévet.",
  },
  {
    moduleId: "popupDismiss",
    label: "Felugró tájékoztatók elnyelése",
    description: "A visszatérő egygombos tájékoztató ablakok automatikus becsukása.",
  },
  {
    moduleId: "pageTitle",
    label: "Oldalcím a böngészőfülön",
    description: "A fül neve az aktuális Neptun-oldalt mutatja („Tárgyfelvétel · Neptun”).",
  },
  {
    moduleId: "autoLogin",
    label: "Automatikus belépés",
    description: "Tárolt belépési adatok és visszaszámlálásos belépés a bejelentkezési oldalon.",
  },
  {
    label: "Belépés után vissza az utolsó oldalra",
    description: "Belépés után nem a kezdőoldal, hanem a legutóbb nézett oldal jön be.",
    custom: {
      get: () => storage.get<boolean>("backToLastPage", "enabled") === true,
      set: value => storage.set("backToLastPage", "enabled", value),
    },
  },
];

function buildPanel(onClose: () => void): Panel {
  const panel = createPanel("npu-settings", "NPU · Beállítások");

  panel.body.appendChild(
    el(
      `<div class="npu-note">Neptun PowerUp! NG <b>v${VERSION}</b> · a változtatások azonnal érvényesek.</div>`
    )
  );

  ENTRIES.forEach(entry => {
    const row = el(
      `<label class="npu-item" style="display:flex;gap:10px;align-items:flex-start;cursor:pointer">` +
        `<input type="checkbox" style="margin-top:3px;flex:0 0 auto">` +
        `<span><span class="npu-item__title" style="display:block"></span>` +
        `<span class="npu-item__meta"></span></span></label>`
    );
    row.querySelector<HTMLElement>(".npu-item__title")!.textContent = entry.label;
    row.querySelector<HTMLElement>(".npu-item__meta")!.textContent = entry.description;
    const checkbox = row.querySelector<HTMLInputElement>("input")!;
    checkbox.checked = entry.custom ? entry.custom.get() : isModuleEnabled(entry.moduleId!);
    checkbox.addEventListener("change", () => {
      if (entry.custom) {
        entry.custom.set(checkbox.checked);
      } else {
        setModuleEnabled(entry.moduleId!, checkbox.checked);
      }
    });
    panel.body.appendChild(row);
  });

  // Diagnostics: the log never leaves the machine on its own. The button puts
  // it on the clipboard; where it goes from there is the user's decision.
  const diagBox = el(
    `<div class="npu-item" style="display:block">` +
      `<span class="npu-item__title" style="display:block">Diagnosztika</span>` +
      `<span class="npu-item__meta" style="display:block">A napló időpontokat, HTTP-státuszokat, időtartamokat, ` +
      `a fül láthatóságát, a Neptun saját kéréseinek útvonalát (paraméterek nélkül), elutasított frissítésnél a szerver ` +
      `hibaüzenetét (token, azonosító, email kiszűrve) és a szerver óraeltérését tartalmazza — tokent, sütit, Neptun-kódot, ` +
      `nevet, kérés- vagy válasz-tartalmat nem. Sehova nem küldjük el: a gombbal a vágólapra másolod, és te döntöd el, ` +
      `hova illeszted be (a visszajelzés-űrlapba belefér).</span>` +
      `<button class="npu-button npu-copy-diag" style="margin-top:6px">Napló másolása</button>` +
      `</div>`
  );
  const copyButton = diagBox.querySelector<HTMLButtonElement>(".npu-copy-diag")!;
  copyButton.addEventListener("click", async () => {
    const text = diagDump();
    try {
      await navigator.clipboard.writeText(text);
      copyButton.textContent = "Másolva ✓";
    } catch {
      // No clipboard access (older browser / no permission): show it for manual copying.
      const area = document.createElement("textarea");
      area.readOnly = true;
      area.value = text;
      area.style.cssText = "width:100%;height:160px;margin-top:6px;font:11px/1.4 monospace";
      diagBox.appendChild(area);
      area.select();
      copyButton.textContent = "Jelöld ki és másold (Ctrl+C)";
    }
    window.setTimeout(() => (copyButton.textContent = "Napló másolása"), 2500);
  });
  panel.body.appendChild(diagBox);

  const footer = el(
    `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px">` +
      `<button class="npu-button npu-close">Bezárás</button>` +
      `<button class="npu-button npu-button--danger npu-reset">Minden NPU-adat törlése</button>` +
      `</div>`
  );
  footer.querySelector(".npu-close")!.addEventListener("click", onClose);
  footer.querySelector(".npu-reset")!.addEventListener("click", () => {
    if (
      confirm(
        "Minden NPU-beállítás törlődik: kapcsolók, figyelt kurzusok, félév-memória, tárolt belépési adatok, panel-pozíciók. Biztos?"
      )
    ) {
      storage.resetAll();
      location.reload();
    }
  });
  panel.body.appendChild(footer);

  panel.body.appendChild(
    el(
      `<div class="npu-note" style="margin-top:8px">` +
        `<a href="https://neptun-powerup.com" target="_blank" rel="noopener">Weboldal</a> · ` +
        `<a href="https://neptun-powerup.com/visszajelzes" target="_blank" rel="noopener">Hibabejelentés / ötlet</a> · ` +
        `<a href="https://github.com/rozsadomb/neptun-powerup" target="_blank" rel="noopener">Forráskód</a></div>`
    )
  );

  return panel;
}

export const settingsPanel: NpuModule = {
  id: "settingsPanel",
  alwaysOn: true,
  matches: () => true,
  activate() {
    let panel: Panel | null = null;

    const close = () => {
      panel?.destroy();
      panel = null;
    };
    const toggle = () => {
      if (panel) {
        close();
      } else {
        panel = buildPanel(close);
      }
    };
    document.addEventListener(OPEN_SETTINGS_EVENT, toggle);

    return () => {
      document.removeEventListener(OPEN_SETTINGS_EVENT, toggle);
      close();
    };
  },
};
