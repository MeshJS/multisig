/**
 * Generate human-readable + JSON reports for the CI smoke run.
 */
import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import type { ScenarioResult } from "../scenarios/types";

const ARTIFACTS_DIR = join(process.cwd(), "ci-artifacts");
const REPORT_FILE = join(ARTIFACTS_DIR, "ci-route-chain-report.json");

export interface RunReport {
  timestamp: string;
  totalScenarios: number;
  passed: number;
  failed: number;
  aborted: boolean;
  durationMs: number;
  results: ScenarioResult[];
}

export function writeReport(report: RunReport): void {
  mkdirSync(dirname(REPORT_FILE), { recursive: true });
  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + "\n");
}

export function printSummary(report: RunReport): void {
  console.log("\n=== CI Smoke Test Report ===");
  console.log(`Timestamp: ${report.timestamp}`);
  console.log(`Total:     ${report.totalScenarios}`);
  console.log(`Passed:    ${report.passed}`);
  console.log(`Failed:    ${report.failed}`);
  console.log(`Aborted:   ${report.aborted}`);
  console.log(`Duration:  ${report.durationMs}ms`);
  console.log("");

  for (const r of report.results) {
    const icon = r.passed ? "PASS" : "FAIL";
    const crit = r.critical ? " [CRITICAL]" : "";
    console.log(`  ${icon} ${r.name}${crit} (${r.durationMs}ms) - ${r.message}`);
  }

  console.log("");
  if (report.failed > 0) {
    console.log("SMOKE TEST FAILED");
  } else {
    console.log("SMOKE TEST PASSED");
  }
}
