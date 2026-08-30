import { appPath } from "../core/base";
import { visibleText } from "../core/inject";
import type { NpuModule } from "../core/modules";

// The app's tab title is a static "Neptun Web" on every page, which makes
// Neptun tabs indistinguishable. Mirror the current page's own heading into
// the title, like the old NPU did.

const BASE_TITLE = "Neptun";

// Pages without a heading of their own.
const ROUTE_NAMES: [string, string][] = [
  ["/hallgatoi/dashboard", "Kezdőoldal"],
  ["/hallgatoi/calendar", "Naptár"],
  ["/hallgatoi/login", "Bejelentkezés"],
];

function currentPageName(): string | null {
  // The page heading component, present on most content pages. Only its
  // heading element counts: the component also hosts action buttons
  // ("Naptár kezelése", "Heti nézet"...), which must not leak into the title.
  const primary = visibleText(document.querySelector("neptun-primary-title h1, neptun-primary-title h2"));
  if (primary) {
    return primary;
  }
  // The last breadcrumb item is the current page.
  const crumb = document.querySelector("neptun-breadcrumb");
  if (crumb) {
    const parts = visibleText(crumb)
      .split(/[»›>/]/)
      .map(part => part.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  }
  const route = ROUTE_NAMES.find(([prefix]) => appPath().startsWith(prefix));
  return route ? route[1] : null;
}

export const pageTitle: NpuModule = {
  id: "pageTitle",
  matches: () => true,
  activate() {
    const originalTitle = document.title;
    const update = () => {
      const name = currentPageName();
      const wanted = name ? `${name} · ${BASE_TITLE}` : originalTitle;
      if (document.title !== wanted) {
        document.title = wanted;
      }
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => {
      window.clearInterval(timer);
      document.title = originalTitle;
    };
  },
};
