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

  it("runs parallel branches while preserving serial order inside each branch", async () => {
    const events: string[] = [];
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const scenarios: Scenario[] = [
      {
        id: "scenario.parallel",
        description: "parallel scenario",
        steps: [
          {
            id: "step.prepare",
            description: "prepare",
            execute: async () => {
              events.push("prepare");
              return { message: "prepared" };
            },
          },
        ],
        parallelBranches: [
          {
            id: "branch.a",
            description: "A",
            steps: [
              {
                id: "a.1",
                description: "a1",
                execute: async () => {
                  events.push("a.1.start");
                  await delay(20);
                  events.push("a.1.end");
                  return { message: "a1" };
                },
              },
              {
                id: "a.2",
                description: "a2",
                execute: async () => {
                  events.push("a.2");
                  return { message: "a2" };
                },
              },
            ],
          },
          {
            id: "branch.b",
            description: "B",
            steps: [
              {
                id: "b.1",
                description: "b1",
                execute: async () => {
                  events.push("b.1");
                  return { message: "b1" };
                },
              },
            ],
          },
        ],
      },
    ];

    const report = await runScenarios({ scenarios, ctx });

    expect(report.status).toBe("passed");
    expect(events.indexOf("prepare")).toBeLessThan(events.indexOf("a.1.start"));
    expect(events.indexOf("prepare")).toBeLessThan(events.indexOf("b.1"));
    expect(events.indexOf("b.1")).toBeLessThan(events.indexOf("a.1.end"));
    expect(events.indexOf("a.1.end")).toBeLessThan(events.indexOf("a.2"));
    expect(report.scenarios[0]?.steps.map((step) => step.id)).toEqual([
      "step.prepare",
      "a.1",
      "a.2",
      "b.1",
    ]);
    expect(report.scenarios[0]?.steps.find((step) => step.id === "a.1")?.artifacts).toMatchObject({
      branchId: "branch.a",
    });
  });

  it("fails the run when a parallel branch has a critical failure but reports other branches", async () => {
    const scenarios: Scenario[] = [
      {
        id: "scenario.parallel-fail",
        description: "parallel failure",
        steps: [],
        parallelBranches: [
          {
            id: "branch.fail",
            description: "fail",
            steps: [
              {
                id: "fail.1",
                description: "fail",
                execute: async () => {
                  throw new Error("branch exploded");
                },
              },
            ],
          },
          {
            id: "branch.pass",
            description: "pass",
            steps: [
              {
                id: "pass.1",
                description: "pass",
                execute: async () => ({ message: "ok" }),
              },
            ],
          },
        ],
      },
    ];

    const report = await runScenarios({ scenarios, ctx });

    expect(report.status).toBe("failed");
    expect(report.scenarios[0]?.status).toBe("failed");
    expect(report.scenarios[0]?.steps.map((step) => step.id)).toEqual(["fail.1", "pass.1"]);
  });
});
