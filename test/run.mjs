// Runs the regression tests against fresh Node bundles of the core modules.
// `npm test` builds dist/npu.user.js first (the trigger test reads its header).
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const out = ".test-build";
mkdirSync(out, { recursive: true });
for (const name of ["api", "storage", "base", "diag"]) {
  await build({
    entryPoints: [`src/core/${name}.ts`],
    bundle: true,
    format: "esm",
    platform: "node",
    define: { __NPU_VERSION__: '"test"' },
    outfile: `${out}/${name}.mjs`,
    logLevel: "error",
  });
}

for (const entry of ["core", "watch", "notice", "keepalive"]) {
  await build({
    entryPoints: [`test/${entry}-entry.ts`],
    bundle: true,
    format: "esm",
    platform: "node",
    define: { __NPU_VERSION__: '"test"' },
    outfile: `${out}/${entry}.mjs`,
    logLevel: "error",
  });
}

await build({
  entryPoints: ["test/core-entry.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  define: { __NPU_VERSION__: '"test"' },
  outfile: `${out}/core.mjs`,
  logLevel: "error",
});

const suites = [
  ["test/session.test.mjs", [`${out}/api.mjs`]],
  ["test/storage-lock.test.mjs", [`${out}/storage.mjs`, `${out}/api.mjs`]],
  ["test/universities.test.mjs", ["dist/npu.user.js", `${out}/base.mjs`]],
  ["test/gate.test.mjs", [`${out}/core.mjs`]],
  ["test/watch.test.mjs", [`${out}/watch.mjs`]],
  ["test/notice.test.mjs", [`${out}/notice.mjs`]],
  ["test/diag.test.mjs", [`${out}/diag.mjs`]],
  ["test/keepalive.test.mjs", [`${out}/keepalive.mjs`]],
  ["test/feedback.test.mjs", []],
  ["test/site.test.mjs", []],
];
let failed = 0;
for (const [file, args] of suites) {
  console.log(`\n##### ${file}`);
  const r = spawnSync(process.execPath, [file, ...args], { stdio: "inherit" });
  if (r.status !== 0) failed++;
}
console.log(failed === 0 ? "\nMINDEN TESZTCSOMAG RENDBEN" : `\n${failed} TESZTCSOMAG BUKOTT`);
process.exit(failed === 0 ? 0 : 1);
