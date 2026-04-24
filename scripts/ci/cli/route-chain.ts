import { loadBootstrapContext } from "../framework/context";
import { runScenarios } from "../framework/runner";
import { writeMarkdownReport } from "../framework/markdown";
import { getScenarioManifest } from "../scenarios/manifest";
import { requireEnv, parseCommaList } from "../framework/env";
import { assertPreprodContext } from "../framework/preprod";

async function main() {
  const contextPath = requireEnv("CI_CONTEXT_PATH", "/tmp/ci-wallet-context.json");
  const reportPath = requireEnv("CI_ROUTE_CHAIN_REPORT_PATH", "/tmp/ci-route-chain-report.md");
  const context = await loadBootstrapContext(contextPath);
  assertPreprodContext(context);
  const allScenarios = getScenarioManifest(context);
  const requestedScenarioIds = parseCommaList(process.env.CI_ROUTE_SCENARIOS);
  const allScenarioIds = new Set(allScenarios.map((scenario) => scenario.id));
  const unknownScenarioIds = requestedScenarioIds.filter((id) => !allScenarioIds.has(id));
  if (unknownScenarioIds.length) {
    throw new Error(
      `Unknown scenario id(s) in CI_ROUTE_SCENARIOS: ${unknownScenarioIds.join(", ")}. Available: ${Array.from(allScenarioIds).join(", ")}`,
    );
  }
  const scenarios = requestedScenarioIds.length
    ? allScenarios.filter((scenario) => requestedScenarioIds.includes(scenario.id))
    : allScenarios;

  if (!scenarios.length) {
    throw new Error(
      requestedScenarioIds.length
        ? `No route scenarios matched CI_ROUTE_SCENARIOS='${requestedScenarioIds.join(",")}'`
        : "No route scenarios enabled in manifest",
    );
  }

  const report = await runScenarios({
    scenarios,
    ctx: context,
    continueOnNonCriticalFailure: true,
  });
  await writeMarkdownReport(report, reportPath);

  for (const scenario of report.scenarios) {
    console.log(`[${scenario.status.toUpperCase()}] ${scenario.id}`);
    for (const step of scenario.steps) {
      if (step.status === "passed") {
        console.log(`  + ${step.id} (${step.durationMs}ms) - ${step.message}`);
      } else {
        console.log(`  x ${step.id} (${step.durationMs}ms) - ${step.error ?? step.message}`);
      }
    }
  }
  console.log(`Route-chain report written to ${reportPath} (markdown)`);

  if (report.status !== "passed") {
    throw new Error("Route-chain scenario run failed");
  }
}

main().catch((error) => {
  console.error("route-chain failed:", error);
  process.exit(1);
});
