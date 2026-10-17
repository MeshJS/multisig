#!/usr/bin/env node
/**
 * Fail the build when first-load JavaScript grows past budget.
 *
 * Reads `.next/build-manifest.json` from a Pages Router build and gzips every
 * chunk a page needs on first load (the shared `_app` chunks plus the page's
 * own). Budgets live in scripts/bundle-budget.json.
 *
 * Not counted: chunks loaded later with import() — the wallet runtime, the
 * UTXOS SDK, components behind next/dynamic. A dynamic import that fires on
 * every visit still costs every visitor, so keep those behind a real
 * condition (see DelegateSlot) rather than relying on this check.
 *
 * Why this exists: the shared `_app` bundle reached 11.9 MB gzipped — every
 * page, public ones included — because one static import pulled ~15 MB of
 * base64 WASM into it, and nothing noticed. A size gate makes the next such
 * import a red check instead of a slow site.
 *
 *   node scripts/check-bundle-budget.mjs            # check
 *   node scripts/check-bundle-budget.mjs --report   # print, never fail
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = process.cwd();
const nextDir = path.join(root, ".next");
const report = process.argv.includes("--report");
const budget = JSON.parse(
  fs.readFileSync(path.join(root, "scripts/bundle-budget.json"), "utf8"),
);

const manifestPath = path.join(nextDir, "build-manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error("No .next/build-manifest.json — run `next build` first.");
  process.exit(2);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const sizes = new Map();
function gzipped(file) {
  if (!sizes.has(file)) {
    const full = path.join(nextDir, file);
    // A manifest entry with no file means the build output is not what this
    // script expects; counting it as 0 bytes would let anything pass.
    if (!fs.existsSync(full)) {
      console.error(`Manifest lists ${file}, which is not in .next — stale or partial build?`);
      process.exit(2);
    }
    const bytes = fs.readFileSync(full);
    sizes.set(file, zlib.gzipSync(bytes, { level: 9 }).length);
  }
  return sizes.get(file);
}
const totalJs = (files) =>
  files.filter((f) => f.endsWith(".js")).reduce((sum, f) => sum + gzipped(f), 0);
const totalCss = (files) =>
  files.filter((f) => f.endsWith(".css")).reduce((sum, f) => sum + gzipped(f), 0);

// polyfillFiles are served as `nomodule` and only download in browsers
// without ES-module support, so they are not part of a modern first load.
const shared = [
  ...new Set([
    ...(manifest.pages["/_app"] ?? []),
    ...(manifest.rootMainFiles ?? []),
  ]),
];

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const failures = [];

const sharedJs = totalJs(shared);
const sharedCss = totalCss(shared);
console.log(`shared first-load JS  ${kb(sharedJs)} gz (budget ${budget.sharedJsKb} KB)`);
console.log(`shared first-load CSS ${kb(sharedCss)} gz (budget ${budget.sharedCssKb} KB)`);
if (sharedJs > budget.sharedJsKb * 1024) {
  failures.push(`shared JS ${kb(sharedJs)} > ${budget.sharedJsKb} KB`);
}
if (sharedCss > budget.sharedCssKb * 1024) {
  failures.push(`shared CSS ${kb(sharedCss)} > ${budget.sharedCssKb} KB`);
}

const rows = Object.entries(manifest.pages)
  .filter(([page]) => !page.startsWith("/_"))
  .map(([page, files]) => {
    const all = [...new Set([...shared, ...files])];
    const limitKb = budget.pages?.[page] ?? budget.pageJsKb;
    return { page, js: totalJs(all), limitKb };
  })
  .sort((a, b) => b.js - a.js);

console.log("\nfirst-load JS per page (gz):");
for (const row of rows) {
  const over = row.js > row.limitKb * 1024;
  console.log(`${over ? "✗" : " "} ${kb(row.js).padStart(10)}  ${row.page}`);
  if (over) failures.push(`${row.page} ${kb(row.js)} > ${row.limitKb} KB`);
}

if (failures.length > 0) {
  console.log(`\n${failures.length} over budget:\n  ${failures.join("\n  ")}`);
  if (!report) {
    console.log(
      "\nIf the growth is intended, raise the number in scripts/bundle-budget.json in the same PR and say why.",
    );
    process.exit(1);
  }
} else {
  console.log("\nWithin budget.");
}
