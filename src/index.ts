import { log, VERSION } from "./core/env";
import { runModules } from "./core/modules";
import { initRouter } from "./core/router";
import * as storage from "./core/storage";
import { keepAlive } from "./modules/keepAlive";
import { statusBadge } from "./modules/statusBadge";
import { subjectAutoSearch } from "./modules/subjectAutoSearch";

(async () => {
  if (!location.pathname.startsWith("/hallgatoi")) {
    return;
  }
  await storage.initialize();
  log(`Neptun PowerUp! NG v${VERSION} starting`);
  initRouter();
  runModules([keepAlive, statusBadge, subjectAutoSearch]);
})();
