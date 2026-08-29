// Ambient declarations and environment helpers.

declare const __NPU_VERSION__: string;

// Greasemonkey 4 style API; optional so the bundle also runs when eval'd
// directly in the page (development) where GM is not available.
declare global {
  const GM:
    | {
        getValue(key: string, def?: unknown): Promise<unknown>;
        setValue(key: string, value: unknown): Promise<void>;
        info?: { script: { version: string } };
      }
    | undefined;
}

export const VERSION: string = typeof __NPU_VERSION__ !== "undefined" ? __NPU_VERSION__ : "dev";

export function hasGM(): boolean {
  return typeof GM !== "undefined" && !!GM && typeof GM.getValue === "function";
}

export function log(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log("%c[NPU]", "color:#2b6cb0;font-weight:bold", ...args);
}
