import * as storage from "./storage";

// Per-module on/off switches. Undefined means "enabled": every feature works
// out of the box, the settings panel is for turning things off.

export const SETTINGS_EVENT = "npu:settings-changed";
export const OPEN_SETTINGS_EVENT = "npu:open-settings";

export function isModuleEnabled(id: string): boolean {
  const value = storage.get<boolean>("settings", "modules", id);
  return typeof value === "boolean" ? value : true;
}

export function setModuleEnabled(id: string, enabled: boolean): void {
  storage.set("settings", "modules", id, enabled);
  // The module runner listens for this and applies the change immediately.
  document.dispatchEvent(new CustomEvent(SETTINGS_EVENT));
}
