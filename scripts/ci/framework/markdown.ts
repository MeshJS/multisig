import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";
import type { RunReport, ScenarioReport, StepReport } from "./types";

function lovelaceToAda(lovelace: string): string {
  return (Number(BigInt(lovelace)) / 1_000_000).toFixed(2);
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function escapeCell(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function renderSteps(steps: StepReport[]): string {
  const rows: string[] = [];
  rows.push("| Step | ms | Message |");
  rows.push("|------|----|---------|");

  const errorBlocks: string[] = [];

  for (const step of steps) {
    const icon = step.status === "passed" ? "✅" : "❌";
    const msg = escapeCell(step.status === "failed" ? (step.error ?? step.message) : step.message);
    rows.push(`| ${icon} ${step.id} | ${step.durationMs} | ${msg} |`);

    if (step.status === "failed" && step.artifacts && Object.keys(step.artifacts).length > 0) {
      errorBlocks.push(`**\`${step.id}\` artifacts:**`);
      errorBlocks.push("```json");
      errorBlocks.push(JSON.stringify(step.artifacts, null, 2));
      errorBlocks.push("```");
    }
  }

  if (errorBlocks.length > 0) {
    rows.push("", ...errorBlocks);
  }

  return rows.join("\n");
}

function renderScenario(scenario: ScenarioReport): string {
  const icon = scenario.status === "passed" ? "✅" : "❌";
  return [`### ${icon} ${scenario.id} — ${fmtMs(scenario.durationMs)}`, "", renderSteps(scenario.steps)].join("\n");
}

export async function writeMarkdownReport(report: RunReport, outputPath: string): Promise<void> {
  const lines: string[] = [];
  const icon = report.status === "passed" ? "✅" : "❌";

  lines.push(`# CI Route-Chain: ${report.status.toUpperCase()} ${icon}`, "");

  const network = report.contextSummary.networkId === 0 ? "preprod" : "mainnet";
  lines.push(
    `**Run:** ${report.createdAt} · **Duration:** ${fmtMs(report.durationMs)} · **Network:** ${network} · **Wallets:** ${report.contextSummary.walletTypes.join(", ")}`,
    "",
  );

  // Wallet balances
  lines.push("## Wallet Balances", "");
  if (report.walletBalanceSummary.error) {
    lines.push(`> Balance collection failed: ${report.walletBalanceSummary.error}`);
  } else {
    lines.push("| Type | UTxOs | ADA |", "|------|-------|-----|");
    for (const [type, entry] of Object.entries(report.walletBalanceSummary.byWalletType)) {
      if (!entry) continue;
      const ada = lovelaceToAda(entry.lovelace);
      const nativeCount = Object.keys(entry.assets).filter((k) => k !== "lovelace").length;
      const assetNote = nativeCount > 0 ? ` +${nativeCount} assets` : "";
      lines.push(`| ${type} | ${entry.utxoCount} | ${ada}${assetNote} |`);
    }
  }
  lines.push("");

  // Scenario summary
  lines.push("## Scenario Summary", "");
  lines.push("| Scenario | Status | Steps | Duration |", "|----------|--------|-------|----------|");
  for (const scenario of report.scenarios) {
    const sIcon = scenario.status === "passed" ? "✅" : "❌";
    const passed = scenario.steps.filter((s) => s.status === "passed").length;
    lines.push(`| ${scenario.id} | ${sIcon} | ${passed}/${scenario.steps.length} | ${fmtMs(scenario.durationMs)} |`);
  }
  lines.push("");

  // Step details
  lines.push("## Steps", "");
  for (const scenario of report.scenarios) {
    lines.push(renderScenario(scenario), "");
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, lines.join("\n"), "utf8");
}
