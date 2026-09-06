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

interface Mutation {
  keys: string[];
  value: unknown;
}

// Writes are serialised and re-read first, instead of dumping this tab's whole
// snapshot. Two tabs each hold their own copy of the blob, so a blind write
// silently discards whatever the other tab saved in the meantime — dragging a
// panel in one tab would drop a watch or saved credentials added in the other.
let writeChain: Promise<void> = Promise.resolve();
// Mutations applied to `data` whose write has not completed yet. When a write
// finishes it replaces `data` with what it read back from storage — which does
// not contain the later mutations, so those are re-applied. Without this, a
// read landing between two queued writes briefly sees the older state.
const pendingMutations: Mutation[] = [];

function applyMutation(target: Record<string, unknown>, { keys, value }: Mutation): void {
  let current = target;
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
}

// A null mutation means "wipe everything" (resetAll), which is a deliberate
// full overwrite — but it still goes through the chain so it cannot overtake a
// write that is already in flight.
function persist(mutation: Mutation | null): void {
  if (mutation !== null) {
    pendingMutations.push(mutation);
  }
  writeChain = writeChain
    .then(async () => {
      if (mutation === null) {
        pendingMutations.length = 0;
        data = {};
        await rawSave("{}");
        return;
      }
      let fresh: Record<string, unknown>;
      try {
        fresh = JSON.parse((await rawLoad()) ?? "{}") ?? {};
      } catch {
        fresh = {};
      }
      applyMutation(fresh, mutation);
      await rawSave(JSON.stringify(fresh));
      const index = pendingMutations.indexOf(mutation);
      if (index >= 0) {
        pendingMutations.splice(index, 1);
      }
      // Everything still queued was already applied to `data`; re-apply it so
      // the fresh copy does not roll those writes back.
      pendingMutations.forEach(later => applyMutation(fresh, later));
      data = fresh;
    })
    .catch(() => {
      // One failed write must not wedge every later one.
      const index = pendingMutations.indexOf(mutation as Mutation);
      if (index >= 0) {
        pendingMutations.splice(index, 1);
      }
    });
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
  persist(null);
}

export function set(...keysAndValue: [...string[], unknown]): void {
  const value = keysAndValue[keysAndValue.length - 1];
  const keys = keysAndValue.slice(0, -1) as string[];
  const mutation: Mutation = { keys, value };
  // Apply to this tab's copy right away, so a get() on the next line already
  // sees it; the merge onto the stored blob happens asynchronously.
  applyMutation(data, mutation);
  persist(mutation);
}
