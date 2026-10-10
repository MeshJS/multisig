import { describe, expect, it } from "@jest/globals";
import {
  shouldSkipActionConfirmation,
  shouldSkipCleanupBurnPropose,
  shouldSkipCleanupBurnSigning,
} from "../../scripts/ci/scenarios/steps/proxyBot";

describe("proxy cleanup runtime state", () => {
  it("skips the optional burn proposal when initial cleanup already produced burn", () => {
    const runtime = { cleanupPhase: "burn" as const };

    expect(shouldSkipCleanupBurnPropose(runtime)).toBe(true);
    expect(
      shouldSkipCleanupBurnSigning({
        cleanupBurnSkipped: true,
        cleanupBurnTransactionId: undefined,
      }),
    ).toBe(true);
  });

  it("runs burn signing after a separate burn transaction is proposed", () => {
    const runtime = {
      cleanupPhase: "burn" as const,
      cleanupBurnSkipped: false,
      cleanupBurnTransactionId: "tx-burn",
    };

    expect(shouldSkipCleanupBurnPropose({ cleanupPhase: "sweep" })).toBe(false);
    expect(shouldSkipCleanupBurnSigning(runtime)).toBe(false);
  });

  it("skips burn signing when no burn transaction was created", () => {
    expect(
      shouldSkipCleanupBurnSigning({
        cleanupBurnSkipped: false,
        cleanupBurnTransactionId: undefined,
      }),
    ).toBe(true);
  });

  it("skips action confirmation until a transaction id and spent inputs are recorded", () => {
    expect(shouldSkipActionConfirmation({})).toBe(true);
    expect(shouldSkipActionConfirmation({ actionTransactionId: "tx-1" })).toBe(true);
    expect(
      shouldSkipActionConfirmation({
        actionTransactionId: "tx-1",
        actionUtxoRefs: [{ txHash: "hash", outputIndex: 0 }],
      }),
    ).toBe(false);
  });
});
