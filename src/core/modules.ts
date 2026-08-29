import { log } from "./env";
import { currentPath, onRouteChange } from "./router";
import { isModuleEnabled, SETTINGS_EVENT } from "./settings";

// A module either runs globally (activated once) or is scoped to routes:
// activated when the route matches, cleaned up when the user navigates away.
// The settings panel can disable modules; a toggle takes effect immediately
// (the runner re-evaluates and runs the module's cleanup).

export interface NpuModule {
  id: string;
  // Return true for routes where the module should be active. Global modules
  // return true for every path.
  matches(path: string): boolean;
  // Called when the module becomes active. May return a cleanup function.
  activate(): void | (() => void) | Promise<void | (() => void)>;
  // Not listed in and not disableable from the settings panel (the panel
  // itself, and the badge that opens it).
  alwaysOn?: boolean;
}

export function runModules(modules: NpuModule[]): void {
  const cleanups = new Map<string, () => void>();
  const active = new Set<string>();

  const evaluate = (path: string) => {
    for (const module of modules) {
      const shouldBeActive = (module.alwaysOn || isModuleEnabled(module.id)) && module.matches(path);
      if (shouldBeActive && !active.has(module.id)) {
        active.add(module.id);
        Promise.resolve(module.activate())
          .then(cleanup => {
            if (typeof cleanup !== "function") {
              return;
            }
            // The route may have changed again while activate() settled; the
            // deactivation branch had no cleanup to call yet, so run it here
            // rather than leaving an orphaned instance behind.
            if (!active.has(module.id)) {
              cleanup();
              return;
            }
            cleanups.set(module.id, cleanup);
            log(`module ${module.id} activated`);
          })
          .catch(error => {
            active.delete(module.id);
            console.error(`[NPU] module ${module.id} failed to activate`, error);
          });
      } else if (!shouldBeActive && active.has(module.id)) {
        active.delete(module.id);
        const cleanup = cleanups.get(module.id);
        cleanups.delete(module.id);
        if (cleanup) {
          try {
            cleanup();
          } catch (error) {
            console.error(`[NPU] module ${module.id} cleanup failed`, error);
          }
        }
        log(`module ${module.id} deactivated`);
      }
    }
  };

  onRouteChange(evaluate);
  document.addEventListener(SETTINGS_EVENT, () => evaluate(currentPath()));
}
