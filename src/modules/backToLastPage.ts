import { appPath, appUrl } from "../core/base";
import { waitFor } from "../core/dom";
import { log } from "../core/env";
import type { NpuModule } from "../core/modules";
import { onRouteChange } from "../core/router";
import * as storage from "../core/storage";

// After logging in, Neptun always lands on the dashboard. When enabled, we
// jump back to wherever the user last was — the old NPU's opt-in "vissza a
// legutóbbi oldalra" feature. The opt-in checkbox lives on the login page.

const ENABLED_KEY = ["backToLastPage", "enabled"] as const;
const LAST_PAGE_KEY = ["backToLastPage", "lastPage"] as const;
// Set while this tab is on the login page: only a dashboard arrival right
// after that counts as "just logged in" (a deliberate dashboard visit later
// must not bounce the user away). sessionStorage, so it is per-tab.
const FROM_LOGIN_FLAG = "npu-ng:from-login";

function isEnabled(): boolean {
  return storage.get<boolean>(...ENABLED_KEY) === true;
}

function injectLoginCheckbox(): void {
  void waitFor("button[type=submit]", { timeoutMs: 10_000 }).then(submit => {
    if (!submit || !appPath().startsWith("/hallgatoi/login")) {
      return;
    }
    if (document.getElementById("npu-backtolast")) {
      return;
    }
    const wrapper = document.createElement("label");
    wrapper.id = "npu-backtolast";
    wrapper.style.cssText =
      "display:flex;align-items:center;gap:8px;margin-top:14px;font:13px system-ui,sans-serif;" +
      "color:#5a6482;cursor:pointer;user-select:none";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = isEnabled();
    checkbox.addEventListener("change", () => storage.set(...ENABLED_KEY, checkbox.checked));
    const text = document.createElement("span");
    text.textContent = "Belépés után vissza a legutóbb nézett oldalra (NPU)";
    wrapper.append(checkbox, text);
    submit.insertAdjacentElement("afterend", wrapper);
  });
}

export const backToLastPage: NpuModule = {
  id: "backToLastPage",
  matches: () => true,
  activate() {
    let active = true;
    onRouteChange(path => {
      if (!active || !path.startsWith("/hallgatoi")) {
        return;
      }

      if (path.startsWith("/hallgatoi/login")) {
        try {
          sessionStorage.setItem(FROM_LOGIN_FLAG, "1");
        } catch {
          // without the flag the redirect simply won't trigger
        }
        injectLoginCheckbox();
        return;
      }

      const cameFromLogin = sessionStorage.getItem(FROM_LOGIN_FLAG) === "1";
      if (cameFromLogin) {
        sessionStorage.removeItem(FROM_LOGIN_FLAG);
        const last = storage.get<string>(...LAST_PAGE_KEY);
        if (isEnabled() && last && last !== path && path.startsWith("/hallgatoi/dashboard")) {
          log(`returning to last visited page: ${last}`);
          // Full navigation on purpose: the Angular router ignores an
          // external history.pushState, a reload boots the app on the target.
          // Stored routes are prefix-free, so put the institution prefix back.
          location.href = appUrl(last);
          return;
        }
      }

      // Remember where the user actually is (the login page never counts).
      storage.set(...LAST_PAGE_KEY, path);
    });
    return () => {
      active = false;
    };
  },
};
