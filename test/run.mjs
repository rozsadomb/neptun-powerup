// Runs the regression tests against fresh Node bundles of the core modules.
// `npm test` builds dist/npu.user.js first (the trigger test reads its header).
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const out = ".test-build";
mkdirSync(out, { recursive: true });
for (const name of ["api", "storage", "base"]) {
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

const suites = [
  ["test/session.test.mjs", [`${out}/api.mjs`]],
  ["test/storage-lock.test.mjs", [`${out}/storage.mjs`, `${out}/api.mjs`]],
  ["test/universities.test.mjs", ["dist/npu.user.js", `${out}/base.mjs`]],
  ["test/feedback.test.mjs", []],
];
let failed = 0;
for (const [file, args] of suites) {
  console.log(`\n##### ${file}`);
  const r = spawnSync(process.execPath, [file, ...args], { stdio: "inherit" });
  if (r.status !== 0) failed++;
}
console.log(failed === 0 ? "\nMINDEN TESZTCSOMAG RENDBEN" : `\n${failed} TESZTCSOMAG BUKOTT`);
process.exit(failed === 0 ? 0 : 1);
