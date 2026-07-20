import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";
import type { CIBootstrapContext, RunReport, Scenario, ScenarioReport, StepReport } from "./types";
import { collectWalletBalanceSummary } from "./walletBalances";

function now(): number {
  return Date.now();
}

async function runStep(args: {
  step: Scenario["steps"][number];
  ctx: CIBootstrapContext;
}): Promise<StepReport> {
  const stepStart = now();
  const severity = args.step.severity ?? "critical";
  try {
    const result = await args.step.execute(args.ctx);
    return {
      id: args.step.id,
      description: args.step.description,
      status: "passed",
      severity,
      message: result.message,
      artifacts: result.artifacts,
      durationMs: now() - stepStart,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      id: args.step.id,
      description: args.step.description,
      status: "failed",
      severity,
      message: "Step failed",
      durationMs: now() - stepStart,
      error: errorMessage,
    };
  }
}

async function runSerialSteps(args: {
  steps: Scenario["steps"];
  ctx: CIBootstrapContext;
  continueOnNonCriticalFailure: boolean;
}): Promise<{ reports: StepReport[]; failed: boolean; criticalFailed: boolean }> {
  const reports: StepReport[] = [];
  let failed = false;
  let criticalFailed = false;

  for (const step of args.steps) {
    const report = await runStep({ step, ctx: args.ctx });
    reports.push(report);

    if (report.status !== "failed") {
      continue;
    }

    const isCritical = report.severity === "critical";
    if (isCritical || !args.continueOnNonCriticalFailure) {
      failed = true;
    }
    if (isCritical) {
      criticalFailed = true;
      break;
    }
    if (!args.continueOnNonCriticalFailure) {
      break;
    }
  }

  return { reports, failed, criticalFailed };
}

export async function runScenarios(args: {
  scenarios: Scenario[];
  ctx: CIBootstrapContext;
  continueOnNonCriticalFailure?: boolean;
}): Promise<RunReport> {
  const start = now();
  const { scenarios, ctx, continueOnNonCriticalFailure = true } = args;
  const scenarioReports: ScenarioReport[] = [];
  let overallFailed = false;

  for (const scenario of scenarios) {
    const scenarioStart = now();
    const steps: StepReport[] = [];
    let scenarioFailed = false;

    const serial = await runSerialSteps({
      steps: scenario.steps,
      ctx,
      continueOnNonCriticalFailure,
    });
    steps.push(...serial.reports);
    scenarioFailed = serial.failed;
    if (serial.failed) {
      overallFailed = true;
    }

    if (!serial.criticalFailed && scenario.parallelBranches?.length) {
      const branchResults = await Promise.all(
        scenario.parallelBranches.map(async (branch) => {
          const result = await runSerialSteps({
            steps: branch.steps,
            ctx,
            continueOnNonCriticalFailure,
          });
          return {
            branch,
            ...result,
          };
        }),
      );
      for (const branchResult of branchResults) {
        steps.push(
          ...branchResult.reports.map((report) => ({
            ...report,
            artifacts: {
              branchId: branchResult.branch.id,
              branchDescription: branchResult.branch.description,
              ...(report.artifacts ?? {}),
            },
          })),
        );
        if (branchResult.failed) {
          scenarioFailed = true;
          overallFailed = true;
        }
      }
    }

    scenarioReports.push({
      id: scenario.id,
      description: scenario.description,
      status: scenarioFailed ? "failed" : "passed",
      durationMs: now() - scenarioStart,
      steps,
    });

    if (scenarioFailed) {
      const hitCritical = steps.some((s) => s.status === "failed" && s.severity === "critical");
      if (hitCritical) {
        break;
      }
    }
  }

  const walletBalanceSummary = await collectWalletBalanceSummary(ctx);

  return {
    createdAt: new Date().toISOString(),
    scenarioIds: scenarios.map((s) => s.id),
    status: overallFailed ? "failed" : "passed",
    durationMs: now() - start,
    contextSummary: {
      apiBaseUrl: ctx.apiBaseUrl,
      networkId: ctx.networkId,
      walletCount: ctx.wallets.length,
      walletTypes: ctx.walletTypes,
    },
    walletBalanceSummary,
    scenarios: scenarioReports,
  };
}

export async function writeRunReport(report: RunReport, outputPath: string): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");
}
