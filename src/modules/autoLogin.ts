import { log } from "../core/env";
import { waitFor } from "../core/dom";
import type { NpuModule } from "../core/modules";
import * as storage from "../core/storage";
import { el, createPanel } from "../core/ui";

// Stored credentials + auto-login on the new login page. Credentials are
// kept on this machine only (base64, like the old NPU — documented caveat).
// The login form is an Angular reactive form: values must be set on the
// inputs followed by an "input" event so the form controls pick them up.
// If a captcha or two-factor prompt is present, we only fill, never submit.

const COUNTDOWN_SECONDS = 3;

interface StoredUser {
  password: string; // base64
  lastUsed?: string;
}

function host(): string {
  return location.host;
}

function getUsers(): Record<string, StoredUser> {
  return storage.get<Record<string, StoredUser>>("logins", host()) ?? {};
}

function findUserNameInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>("input#userName, input[name=userName]");
}

function findPasswordInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(
    "#password input, input#password[type=password], input[type=password]"
  );
}

function findSubmitButton(): HTMLButtonElement | null {
  const form = findUserNameInput()?.closest("form");
  return form?.querySelector<HTMLButtonElement>("button[type=submit]") ?? null;
}

function captchaPresent(): boolean {
  return !!document.querySelector("input[formcontrolname=captcha], img[src*=captcha], neptun-captcha");
}

function setAngularInputValue(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new Event("blur", { bubbles: true }));
}

export const autoLogin: NpuModule = {
  id: "autoLogin",
  matches: path => path.startsWith("/hallgatoi/login"),
  activate() {
    let destroyed = false;
    let countdownTimer: number | undefined;

    const stopCountdown = () => {
      if (countdownTimer !== undefined) {
        window.clearInterval(countdownTimer);
        countdownTimer = undefined;
      }
    };

    void (async () => {
      const userNameInput = await waitFor("input#userName, input[name=userName]");
      if (!userNameInput || destroyed) {
        return;
      }

      // Offer to save credentials when the user logs in manually. Capture
      // phase, so it runs before Angular's own submit handling.
      const captureListener = (event: Event) => {
        const target = event.target as HTMLElement;
        if (!target.closest("button[type=submit]")) {
          return;
        }
        const userName = findUserNameInput()?.value.trim().toUpperCase() ?? "";
        const password = findPasswordInput()?.value ?? "";
        if (!userName || !password) {
          return;
        }
        const users = getUsers();
        const stored = users[userName];
        if (stored && atob(stored.password) === password) {
          storage.set("logins", host(), userName, "lastUsed", new Date().toISOString());
          return;
        }
        const question = stored
          ? `Megváltoztatod a(z) ${userName} tárolt jelszavát a most beírtra?`
          : `Elmented a(z) ${userName} belépési adatait, hogy legközelebb egy kattintással beléphess erről a gépről?`;
        if (confirm(question)) {
          storage.set("logins", host(), userName, "password", btoa(password));
          storage.set("logins", host(), userName, "lastUsed", new Date().toISOString());
        }
      };
      document.addEventListener("click", captureListener, true);

      const users = getUsers();
      const codes = Object.keys(users);
      if (codes.length === 0) {
        return;
      }

      const panel = createPanel("npu-auto-login", "NPU · Belépés");
      const fillAndMaybeSubmit = (code: string, submit: boolean) => {
        const userInput = findUserNameInput();
        const passwordInput = findPasswordInput();
        if (!userInput || !passwordInput) {
          return;
        }
        userInput.removeAttribute("readonly");
        setAngularInputValue(userInput, code);
        setAngularInputValue(passwordInput, atob(users[code].password));
        if (!submit) {
          return;
        }
        if (captchaPresent()) {
          log("captcha detected, auto-submit disabled");
          return;
        }
        storage.set("logins", host(), code, "lastUsed", new Date().toISOString());
        findSubmitButton()?.click();
      };

      const renderPanel = (info: string) => {
        panel.body.innerHTML = "";
        panel.body.appendChild(el(`<div class="npu-note">${info}</div>`));
        codes.forEach(code => {
          const row = el(
            `<div class="npu-item npu-item--blue" style="display:flex;justify-content:space-between;align-items:center">` +
              `<span class="npu-item__title" style="font-family:monospace">${code}</span>` +
              `<span style="display:flex;gap:6px">` +
              `<button class="npu-button npu-login">Belépés</button>` +
              `<button class="npu-button npu-button--danger npu-delete" title="Tárolt adat törlése">✕</button>` +
              `</span></div>`
          );
          row.querySelector(".npu-login")!.addEventListener("click", () => {
            stopCountdown();
            fillAndMaybeSubmit(code, true);
          });
          row.querySelector(".npu-delete")!.addEventListener("click", () => {
            if (confirm(`Törlöd a(z) ${code} tárolt belépési adatait?`)) {
              storage.set("logins", host(), code, null);
              row.remove();
            }
          });
          panel.body.appendChild(row);
        });
      };

      // Auto-login with the most recently used stored account.
      const lastUsed = codes.sort((a, b) => (users[b].lastUsed ?? "").localeCompare(users[a].lastUsed ?? ""))[0];
      let remaining = COUNTDOWN_SECONDS;
      renderPanel(`Automatikus belépés (${lastUsed}): ${remaining} mp — kattints bárhová a megszakításhoz.`);
      fillAndMaybeSubmit(lastUsed, false);

      const abort = (event: Event) => {
        // Interacting with the NPU panel itself only pauses the countdown,
        // so its own "Belépés" buttons keep working.
        if ((event.target as HTMLElement | null)?.closest?.("#npu-auto-login")) {
          stopCountdown();
          return;
        }
        stopCountdown();
        renderPanel("Automatikus belépés megszakítva.");
        document.removeEventListener("pointerdown", abort, true);
        document.removeEventListener("keydown", abort, true);
      };
      // pointerdown, not mousedown: dragging an NPU panel calls
      // preventDefault(), which suppresses the mousedown that would otherwise
      // pause the countdown — the user would be logged in mid-drag.
      document.addEventListener("pointerdown", abort, true);
      document.addEventListener("keydown", abort, true);

      countdownTimer = window.setInterval(() => {
        remaining--;
        if (remaining <= 0) {
          stopCountdown();
          document.removeEventListener("pointerdown", abort, true);
          document.removeEventListener("keydown", abort, true);
          renderPanel("Belépés...");
          fillAndMaybeSubmit(lastUsed, true);
        } else {
          renderPanel(`Automatikus belépés (${lastUsed}): ${remaining} mp — kattints bárhová a megszakításhoz.`);
        }
      }, 1000);

      const cleanupExtra = () => {
        document.removeEventListener("click", captureListener, true);
        document.removeEventListener("pointerdown", abort, true);
        document.removeEventListener("keydown", abort, true);
        panel.destroy();
      };
      (autoLogin as { _cleanup?: () => void })._cleanup = cleanupExtra;
    })();

    return () => {
      destroyed = true;
      stopCountdown();
      (autoLogin as { _cleanup?: () => void })._cleanup?.();
      (autoLogin as { _cleanup?: () => void })._cleanup = undefined;
    };
  },
};
