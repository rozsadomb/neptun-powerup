import { isAppPath } from "./core/base";
import { log, VERSION } from "./core/env";
import { runModules } from "./core/modules";
import { initRouter } from "./core/router";
import * as storage from "./core/storage";
import { autoLogin } from "./modules/autoLogin";
import { backToLastPage } from "./modules/backToLastPage";
import { courseWatch } from "./modules/courseWatch";
import { examOverview } from "./modules/examOverview";
import { keepAlive } from "./modules/keepAlive";
import { pageTitle } from "./modules/pageTitle";
import { popupDismiss } from "./modules/popupDismiss";
import { quickSignup } from "./modules/quickSignup";
import { settingsPanel } from "./modules/settingsPanel";
import { statusBadge } from "./modules/statusBadge";
import { subjectAutoSearch } from "./modules/subjectAutoSearch";
import { subjectHistory } from "./modules/subjectHistory";
import { subjectInlineControls } from "./modules/subjectInlineControls";
import { termMemory } from "./modules/termMemory";

// A @include minták tágabbak a tesztelt BME-nél, hogy más egyetemek Neptunján
// is elinduljon a szkript. Ezért futásidőben is meggyőződünk róla, hogy tényleg
// a Neptun hallgatói felületén vagyunk: egy véletlen találaton inkább ne
// csináljunk semmit.
function looksLikeNeptun(): boolean {
  // Not startsWith: some institutions serve the app under an institution
  // prefix (see core/base.ts), where the segment is not at the front.
  if (!isAppPath()) {
    return false;
  }
  if (location.host.toLowerCase().includes("neptun")) {
    return true;
  }
  if (document.title.toLowerCase().includes("neptun")) {
    return true;
  }
  return !!document.querySelector("neptun-header, neptun-main-menu, [class*='neptun-']");
}

(async () => {
  if (!looksLikeNeptun()) {
    return;
  }
  // A same-origin iframe would otherwise get a second full instance, with its
  // own polling and its own token refreshes racing the main one.
  if (window.top !== window.self) {
    return;
  }
  await storage.initialize();
  log(`Neptun PowerUp! NG v${VERSION} starting`);
  initRouter();
  runModules([
    keepAlive,
    statusBadge,
    settingsPanel,
    pageTitle,
    popupDismiss,
    backToLastPage,
    termMemory,
    courseWatch,
    subjectAutoSearch,
    subjectHistory,
    subjectInlineControls,
    examOverview,
    quickSignup,
    autoLogin,
  ]);
})();
