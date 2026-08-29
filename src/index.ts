import { log, VERSION } from "./core/env";
import { runModules } from "./core/modules";
import { initRouter } from "./core/router";
import * as storage from "./core/storage";
import { autoLogin } from "./modules/autoLogin";
import { examOverview } from "./modules/examOverview";
import { keepAlive } from "./modules/keepAlive";
import { quickSignup } from "./modules/quickSignup";
import { statusBadge } from "./modules/statusBadge";
import { subjectAutoSearch } from "./modules/subjectAutoSearch";

(async () => {
  if (!location.pathname.startsWith("/hallgatoi")) {
    return;
  }
  await storage.initialize();
  log(`Neptun PowerUp! NG v${VERSION} starting`);
  initRouter();
  runModules([keepAlive, statusBadge, subjectAutoSearch, examOverview, quickSignup, autoLogin]);
})();
