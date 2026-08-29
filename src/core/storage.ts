import { hasGM } from "./env";

// Persistent settings storage: a single JSON blob, GM storage when available
// (survives across subdomains/sessions), localStorage fallback for development.

const KEY = "npu-ng:data";

let data: Record<string, unknown> = {};

async function rawLoad(): Promise<string | null> {
  if (hasGM()) {
    const value = await GM!.getValue(KEY, null);
    return typeof value === "string" ? value : null;
  }
  return localStorage.getItem(KEY);
}

async function rawSave(value: string): Promise<void> {
  if (hasGM()) {
    await GM!.setValue(KEY, value);
  } else {
    localStorage.setItem(KEY, value);
  }
}

export async function initialize(): Promise<void> {
  try {
    data = JSON.parse((await rawLoad()) ?? "{}") ?? {};
  } catch {
    data = {};
  }
}

function save(): void {
  void rawSave(JSON.stringify(data));
}

export function get<T>(...keys: string[]): T | undefined {
  let current: unknown = data;
  for (const key of keys) {
    if (typeof current !== "object" || current === null || !(key in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current as T;
}

/** Wipes every stored NPU setting (watches, term memory, logins, panels...). */
export function resetAll(): void {
  data = {};
  save();
}

export function set(...keysAndValue: [...string[], unknown]): void {
  const value = keysAndValue[keysAndValue.length - 1];
  const keys = keysAndValue.slice(0, -1) as string[];
  let current = data;
  keys.forEach((key, i) => {
    if (i === keys.length - 1) {
      if (value === null || value === undefined) {
        delete current[key];
      } else {
        current[key] = value;
      }
      return;
    }
    if (typeof current[key] !== "object" || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  });
  save();
}
