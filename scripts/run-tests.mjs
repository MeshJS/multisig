// Runs the test suite across both jest module modes (see jest.shared.mjs).
// Any CLI args are forwarded to both runs, so e.g.
//   node scripts/run-tests.mjs --testPathPatterns="src/__tests__/tx-builders"
// works the same as a single jest invocation. The ESM run passes
// --passWithNoTests so arg filters that match only CJS files don't fail it.
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const jest = "node_modules/jest/bin/jest.js";

const cjs = spawnSync("node", [jest, ...args], { stdio: "inherit" });
if (cjs.status !== 0) process.exit(cjs.status ?? 1);

// Coverage (the per-file threshold) lives in the CJS config; collecting it under
// the ESM project trips a v8-coverage + native-ESM bug, so drop it there.
const esmArgs = args.filter((a) => a !== "--coverage");
const esm = spawnSync(
  "node",
  ["--experimental-vm-modules", jest, "-c", "jest.esm.config.mjs", "--passWithNoTests", ...esmArgs],
  { stdio: "inherit" },
);
process.exit(esm.status ?? 0);
