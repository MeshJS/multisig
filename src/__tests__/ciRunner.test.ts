import { describe, expect, it } from "@jest/globals";
import { runScenarios } from "../../scripts/ci/framework/runner";
import type { CIBootstrapContext, Scenario } from "../../scripts/ci/framework/types";

const ctx: CIBootstrapContext = {
  schemaVersion: 3,
  createdAt: "2026-04-29T00:00:00.000Z",
  apiBaseUrl: "http://localhost:3000",
  networkId: 0,
  walletTypes: [],
  wallets: [],
  bots: [],
  signerAddresses: [],
  signerStakeAddresses: [],
};

describe("route-chain runner", () => {
  it("reports non-critical step failures without failing the run by default", async () => {
    const scenarios: Scenario[] = [
      {
        id: "scenario.warning",
        description: "warning scenario",
        steps: [
          {
            id: "step.warning",
            description: "non-critical warning",
            severity: "non-critical",
            execute: async () => {
              throw new Error("provider unavailable");
            },
          },
          {
            id: "step.next",
            description: "next step still runs",
            execute: async () => ({ message: "ok" }),
          },
        ],
      },
    ];

    const report = await runScenarios({ scenarios, ctx });

    expect(report.status).toBe("passed");
    expect(report.scenarios[0]?.status).toBe("passed");
    expect(report.scenarios[0]?.steps.map((step) => step.status)).toEqual(["failed", "passed"]);
  });

  it("fails the run on critical step failures", async () => {
    const scenarios: Scenario[] = [
      {
        id: "scenario.critical",
        description: "critical scenario",
        steps: [
          {
            id: "step.critical",
            description: "critical failure",
            severity: "critical",
            execute: async () => {
              throw new Error("boom");
            },
          },
        ],
      },
    ];

    const report = await runScenarios({ scenarios, ctx });

    expect(report.status).toBe("failed");
    expect(report.scenarios[0]?.status).toBe("failed");
  });
});
