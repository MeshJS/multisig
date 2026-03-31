import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";
import type { CIBootstrapContext, RunReport, Scenario, ScenarioReport, StepReport } from "./types";

function now(): number {
  return Date.now();
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

    for (const step of scenario.steps) {
      const stepStart = now();
      const severity = step.severity ?? "critical";
      try {
        const result = await step.execute(ctx);
        steps.push({
          id: step.id,
          description: step.description,
          status: "passed",
          severity,
          message: result.message,
          artifacts: result.artifacts,
          durationMs: now() - stepStart,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        steps.push({
          id: step.id,
          description: step.description,
          status: "failed",
          severity,
          message: "Step failed",
          durationMs: now() - stepStart,
          error: errorMessage,
        });
        scenarioFailed = true;
        overallFailed = true;
        if (severity === "critical") {
          break;
        }
        if (!continueOnNonCriticalFailure) {
          break;
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
    scenarios: scenarioReports,
  };
}

export async function writeRunReport(report: RunReport, outputPath: string): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");
}
