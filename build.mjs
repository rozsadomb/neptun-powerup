import * as esbuild from "esbuild";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) {
  throw new Error(`Invalid package version: ${pkg.version}`);
}
const meta = readFileSync("./src/meta.txt", "utf8").replace("<version>", pkg.version);

const options = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "iife",
  target: "es2020",
  outfile: "dist/npu.user.js",
  banner: { js: meta },
  define: { __NPU_VERSION__: JSON.stringify(pkg.version) },
  legalComments: "none",
};

// A weboldal bemutatói ugyanabból a forrásból (src/site/demo.ts) épülnek, mint
// a szkript: a verziószám és a kinézet így kézi másolás nélkül egyezik.
const siteDemo = {
  entryPoints: ["src/site/demo.ts"],
  bundle: true,
  format: "iife",
  target: "es2020",
  outfile: "site/demo.js",
  define: { __NPU_VERSION__: JSON.stringify(pkg.version) },
  legalComments: "none",
  banner: { js: `// Generált fájl (npm run build:site), ne szerkeszd: forrás src/site/demo.ts — v${pkg.version}` },
};

if (process.argv.includes("--watch")) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await esbuild.build(options);
  console.log(`Built dist/npu.user.js (v${pkg.version})`);
  if (process.argv.includes("--site")) {
    await esbuild.build(siteDemo);
    console.log(`Built site/demo.js (v${pkg.version})`);
  }
}
