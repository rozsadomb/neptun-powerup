import { isNeptunApp } from "./core/base";
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

// A @include minták szándékosan tágak, hogy a szkript minden egyetem Neptunján
// elinduljon (a címek és útvonalak intézményenként eltérnek). Ezért futásidőben
// döntjük el, hogy tényleg a Neptun hallgatói felületén vagyunk-e: egy véletlen
// találaton inkább ne csináljunk semmit. Lásd core/base.ts.

(async () => {
  if (!isNeptunApp()) {
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
