import { log, VERSION } from "./core/env";
import { runModules } from "./core/modules";
import { initRouter } from "./core/router";
import * as storage from "./core/storage";
import { autoLogin } from "./modules/autoLogin";
import { courseWatch } from "./modules/courseWatch";
import { examOverview } from "./modules/examOverview";
import { keepAlive } from "./modules/keepAlive";
import { quickSignup } from "./modules/quickSignup";
import { statusBadge } from "./modules/statusBadge";
import { subjectAutoSearch } from "./modules/subjectAutoSearch";
import { subjectInlineControls } from "./modules/subjectInlineControls";

(async () => {
  if (!location.pathname.startsWith("/hallgatoi")) {
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
    courseWatch,
    subjectAutoSearch,
    subjectInlineControls,
    examOverview,
    quickSignup,
    autoLogin,
  ]);
})();
