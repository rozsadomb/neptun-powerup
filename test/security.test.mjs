import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

const { window } = parseHTML(`<!doctype html><html><head><base href="/hallgatoi/"></head><body></body></html>`);
globalThis.window = window;
globalThis.document = window.document;
globalThis.Event = window.Event;
globalThis.location = { host: "neptun.example.hu", origin: "https://neptun.example.hu", pathname: "/hallgatoi/exams" };
window.innerWidth = 1280;
window.innerHeight = 900;
function makeStore() {
  const values = new Map();
  return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k) };
}
globalThis.localStorage = makeStore();
globalThis.sessionStorage = makeStore();
const b64 = value => Buffer.from(JSON.stringify(value)).toString("base64url");
sessionStorage.setItem("access_token", `${b64({ alg: "none" })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600 })}.test`);
const payload = '<img src=x onerror="alert(1)"><svg onload="alert(2)"></svg>&<>"';
let mode = "success";
globalThis.fetch = async url => {
  if (mode === "error") throw new Error(payload);
  let data;
  if (url.includes("Exam/GetTerms")) {
    data = [{ value: "term", text: payload }];
  } else if (url.includes("GetRegisteredExamsList")) {
    data = [{ subjectName: payload, subjectCode: payload, registeredExamList: [{
      examType: payload, examTutors: payload, fromDate: payload,
      strength: 1, maxStrength: 10, uiDisplayState: { reasons: [], type: 0 },
    }] }];
  } else {
    throw new Error(`Unexpected request: ${url}`);
  }
  return { ok: true, status: 200, text: async () => JSON.stringify({ data }), json: async () => ({ data }) };
};
const { examOverview, storage } = await import("../" + process.argv[2]);
await storage.initialize();
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail("UI did not settle");
}
function assertNoInjectedMarkup(panel) {
  assert.equal(panel.querySelector("img, svg, script, iframe, [onerror], [onload]"), null);
}

const cleanupExams = examOverview.activate();
await until(() => document.querySelector("#npu-exam-overview .npu-item"));
let panel = document.querySelector("#npu-exam-overview");
assert.equal(panel.querySelector(".npu-chip").textContent, payload);
assert.equal(panel.querySelector(".npu-item__title").textContent, payload);
const metadata = panel.querySelectorAll(".npu-item__meta");
assert.equal(metadata[0].textContent, `${payload} · ${payload} · ${payload}`);
assert.equal(metadata[1].textContent, `felvett vizsga · ${payload} · 1/10 fő`);
assertNoInjectedMarkup(panel);
cleanupExams();

mode = "error";
const cleanupError = examOverview.activate();
await until(() => document.querySelector("#npu-exam-overview .npu-error"));
panel = document.querySelector("#npu-exam-overview");
assert.equal(panel.querySelector(".npu-error").textContent, `Hiba: ${payload}`);
assertNoInjectedMarkup(panel);
cleanupError();

await storage.reload();
console.log("Security DOM regressions passed: API fields and errors remain literal text.");
