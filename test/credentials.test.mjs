import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const KEY = "npu-ng:data";
const original = {
  logins: { "neptun.example.hu": { ABC123: { password: btoa("old-password") } } },
  settings: { modules: { autoLogin: false, keepAlive: true } },
  watches: { course: { courseCode: "T1" } },
  panels: { panel: { left: 100 } },
};
const expected = structuredClone(original);
delete expected.logins;
const local = new Map([[KEY, JSON.stringify(original)]]);
globalThis.localStorage = { getItem: k => local.get(k) ?? null, setItem: (k, v) => local.set(k, v) };

// The fallback store is migrated before initialization resolves.
const fallback = await import(`../${process.argv[2]}?fallback`);
await fallback.initialize();
assert.deepEqual(JSON.parse(local.get(KEY)), expected);
assert.equal(fallback.get("logins"), undefined);
assert.deepEqual(fallback.get("watches"), original.watches);
await fallback.initialize();
assert.deepEqual(JSON.parse(local.get(KEY)), expected, "migration is idempotent");

// Tampermonkey's GM store is the normal installation path.
const gm = new Map([[KEY, JSON.stringify(original)]]);
globalThis.GM = {
  getValue: async k => gm.get(k) ?? null,
  setValue: async (k, v) => gm.set(k, v),
};
const managed = await import(`../${process.argv[2]}?managed`);
await managed.initialize();
assert.deepEqual(JSON.parse(gm.get(KEY)), expected);
assert.equal(managed.get("logins"), undefined);

// An old tab can rewrite its snapshot. The next new-tab write must discard
// those legacy credentials rather than merging them back into the settings.
gm.set(KEY, JSON.stringify(original));
managed.set("panels", "another", { left: 200 });
await managed.reload();
assert.equal(Object.hasOwn(JSON.parse(gm.get(KEY)), "logins"), false);
assert.deepEqual(managed.get("watches"), original.watches);
assert.deepEqual(managed.get("panels", "another"), { left: 200 });
gm.set(KEY, JSON.stringify(original));
await managed.reload();
assert.equal(managed.get("logins"), undefined, "reload never exposes old credentials");

// A storage error must surface instead of silently claiming migration success.
GM.setValue = async () => { throw new Error("write failed"); };
await assert.rejects(managed.initialize(), /write failed/);
assert.equal(managed.get("logins"), undefined);

// The retired feature must not be included in the distributed userscript.
const bundle = readFileSync("dist/npu.user.js", "utf8");
assert.equal(bundle.includes("npu-auto-login"), false);
assert.equal(bundle.includes("btoa(password)"), false);
console.log("Credential retirement regressions passed for GM storage, localStorage, old tabs, and write failure.");
