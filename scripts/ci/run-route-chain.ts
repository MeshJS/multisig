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

function isTestnetAddress(address: string): boolean {
  return address.startsWith("addr_test") || address.startsWith("stake_test");
}

function assertPreprodContext(context: Awaited<ReturnType<typeof loadBootstrapContext>>) {
  const configuredNetworkId = Number(process.env.CI_NETWORK_ID ?? "0") === 1 ? 1 : 0;
  if (configuredNetworkId !== 0) {
    throw new Error(
      `CI route-chain is configured for preprod only. CI_NETWORK_ID must be 0, got ${configuredNetworkId}`,
    );
  }
  if (context.networkId !== 0) {
    throw new Error(
      `Bootstrap context is not preprod. Expected context.networkId=0, got ${context.networkId}`,
    );
  }

  const addresses = [
    ...context.signerAddresses,
    ...context.bots.map((bot) => bot.paymentAddress),
    ...context.wallets.map((wallet) => wallet.walletAddress),
    ...context.wallets.flatMap((wallet) => wallet.signerAddresses),
  ].map((address) => address.trim());

  const nonTestnet = Array.from(new Set(addresses.filter((address) => !isTestnetAddress(address))));
  if (nonTestnet.length) {
    throw new Error(
      `Preprod invariant failed: found non-testnet address(es): ${nonTestnet.slice(0, 5).join(", ")}`,
    );
  }
}

async function main() {
  const contextPath = requireEnv("CI_CONTEXT_PATH", "/tmp/ci-wallet-context.json");
  const reportPath = requireEnv("CI_ROUTE_CHAIN_REPORT_PATH", "/tmp/ci-route-chain-report.json");
  const context = await loadBootstrapContext(contextPath);
  assertPreprodContext(context);
  const allScenarios = getScenarioManifest(context);
  const requestedScenarioIds = (process.env.CI_ROUTE_SCENARIOS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
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
  await writeRunReport(report, reportPath);

  for (const scenario of report.scenarios) {
    console.log(`[${scenario.status.toUpperCase()}] ${scenario.id}`);
    for (const step of scenario.steps) {
      if (step.status === "passed") {
        console.log(`  ✓ ${step.id} (${step.durationMs}ms) - ${step.message}`);
      } else {
        console.log(`  ✗ ${step.id} (${step.durationMs}ms) - ${step.error ?? step.message}`);
      }
    }
  }
  console.log(`Route-chain report written to ${reportPath}`);

  if (report.status !== "passed") {
    throw new Error("Route-chain scenario run failed");
  }
}

main().catch((error) => {
  console.error("run-route-chain failed:", error);
  process.exit(1);
});
