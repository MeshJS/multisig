import { loadBootstrapContext } from "./framework/context";
import { runScenarios, writeRunReport } from "./framework/runner";
import { getScenarioManifest } from "./scenarios/manifest";

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

async function main() {
  const contextPath = requireEnv("CI_CONTEXT_PATH", "/tmp/ci-wallet-context.json");
  const reportPath = requireEnv(
    "CI_PENDING_REPORT_PATH",
    "/tmp/ci-route-chain-pending-report.json",
  );
  const ctx = await loadBootstrapContext(contextPath);
  const pendingScenarioIds = new Set([
    "scenario.real-transfer-and-sign",
    "scenario.final-assertions",
  ]);
  const scenarios = getScenarioManifest(ctx).filter((scenario) =>
    pendingScenarioIds.has(scenario.id),
  );
  if (!scenarios.length) {
    throw new Error(
      `No pending lifecycle scenarios found in manifest. Expected: ${Array.from(pendingScenarioIds).join(", ")}`,
    );
  }

  const report = await runScenarios({ scenarios, ctx });
  await writeRunReport(report, reportPath);
  console.log(`Pending smoke report written to ${reportPath}`);

  if (report.status !== "passed") {
    throw new Error("Pending route-chain smoke failed");
  }
}

main().catch((error) => {
  console.error("run-pending-transactions-smoke failed:", error);
  process.exit(1);
});

