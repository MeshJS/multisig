#!/usr/bin/env npx tsx
/**
 * Stage 2: Execute the scenario chain against the bootstrapped wallets.
 *
 * Reads context from ci-artifacts/bootstrap-context.json, runs each scenario
 * sequentially, and produces a report at ci-artifacts/ci-route-chain-report.json.
 *
 * Critical scenario failures abort the chain. Non-critical failures are logged
 * but execution continues.
 *
 * Usage:
 *   npx tsx scripts/ci-smoke/run-route-chain.ts
 */
import { readContext } from "./lib/context";
import { writeReport, printSummary, type RunReport } from "./lib/report";
import { scenarios } from "./scenarios/manifest";
import type { ScenarioResult } from "./scenarios/types";

async function main() {
  const ctx = readContext();
  console.log(`Loaded context v${ctx.version} with ${Object.keys(ctx.wallets).length} wallets`);

  const results: ScenarioResult[] = [];
  let aborted = false;
  const startTime = Date.now();

  for (const scenario of scenarios) {
    let result: ScenarioResult;
    try {
      result = await scenario(ctx);
    } catch (err) {
      result = {
        name: scenario.name || "unknown",
        passed: false,
        critical: true,
        message: `Unhandled error: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: 0,
      };
    }

    results.push(result);

    const icon = result.passed ? "PASS" : "FAIL";
    const crit = result.critical ? " [CRITICAL]" : "";
    console.log(`${icon} ${result.name}${crit} (${result.durationMs}ms)`);

    if (!result.passed && result.critical) {
      console.error(`Critical failure in "${result.name}": ${result.message}`);
      console.error("Aborting scenario chain.");
      aborted = true;
      break;
    }
  }

  const report: RunReport = {
    timestamp: new Date().toISOString(),
    totalScenarios: scenarios.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    aborted,
    durationMs: Date.now() - startTime,
    results,
  };

  writeReport(report);
  printSummary(report);

  if (report.failed > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Route chain failed:", e);
  process.exit(1);
});
