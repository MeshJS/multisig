import { describe, expect, it, jest } from "@jest/globals";
import {
  analyzeProxyFullLifecycleUtxoShape,
  assertProxyFullLifecyclePreflight,
  createScenarioProxyFullLifecycle,
  createScenarioProxySmoke,
  DREP_REGISTER_REQUIRED_LOVELACE,
  FULL_LIFECYCLE_FEE_BUFFER_LOVELACE,
  getProxyDRepAnchorUrl,
  LIFECYCLE_PROXY_LOVELACE,
  PROXY_FULL_LIFECYCLE_WALLET_TYPES,
  requireSetupTxHash,
  runProxyFullLifecycleHygiene,
} from "../../scripts/ci/scenarios/steps/proxyBot";
import type { CIBootstrapContext, CIWalletType } from "../../scripts/ci/framework/types";

type TestUtxo = Parameters<typeof assertProxyFullLifecyclePreflight>[0]["walletUtxos"][number];

const mkUtxo = (lovelace: string, txHash = "aa", outputIndex = 0): TestUtxo => ({
  input: { txHash, outputIndex },
  output: {
    address: "addr_test_wallet",
    amount: [{ unit: "lovelace", quantity: lovelace }],
  },
});

const mkCollateralUtxo = (lovelace = "6000000", txHash = "collateral", outputIndex = 0): TestUtxo => ({
  input: { txHash, outputIndex },
  output: {
    address: "addr_test_signer_1",
    amount: [{ unit: "lovelace", quantity: lovelace }],
  },
});

const mkAuthTokenUtxo = (txHash = "auth", outputIndex = 0): TestUtxo => ({
  input: { txHash, outputIndex },
  output: {
    address: "addr_test_wallet",
    amount: [
      { unit: "lovelace", quantity: "6000000" },
      { unit: "policy.asset", quantity: "10" },
    ],
  },
});

const mkContext = (walletTypes: CIWalletType[]): CIBootstrapContext => ({
  schemaVersion: 3,
  createdAt: "2026-04-29T00:00:00.000Z",
  apiBaseUrl: "http://localhost:3000",
  networkId: 0,
  walletTypes,
  wallets: walletTypes.map((type) => ({
    type,
    walletId: `${type}-wallet-id`,
    walletAddress: `addr_test_${type}`,
    signerAddresses: ["addr_test_signer_1", "addr_test_signer_2", "addr_test_signer_3"],
  })),
  bots: [
    {
      id: "bot-1",
      paymentAddress: "addr_test_signer_1",
      botKeyId: "bot-key-1",
      botId: "bot-user-1",
    },
  ],
  defaultBotId: "bot-1",
  signerAddresses: ["addr_test_signer_1", "addr_test_signer_2", "addr_test_signer_3"],
  signerStakeAddresses: ["stake_test_1", "stake_test_2", "stake_test_3"],
});

describe("proxy full lifecycle preflight", () => {
  it("classifies an already usable UTxO shape as pass", () => {
    const analysis = analyzeProxyFullLifecycleUtxoShape({
      walletUtxos: [mkUtxo("540000000", "aa", 0)],
      collateralUtxos: [mkCollateralUtxo()],
    });

    expect(analysis.status).toBe("pass");
  });

  it("classifies one large wallet UTxO without key collateral as needing a self-split", () => {
    const analysis = analyzeProxyFullLifecycleUtxoShape({
      walletUtxos: [mkUtxo("600000000", "aa", 0)],
      collateralUtxos: [],
    });

    expect(analysis.status).toBe("needs-split");
  });

  it("classifies insufficient total ADA as a hard funding failure", () => {
    const analysis = analyzeProxyFullLifecycleUtxoShape({
      walletUtxos: [mkUtxo("525000000", "aa", 0)],
      collateralUtxos: [mkCollateralUtxo()],
    });

    expect(analysis.status).toBe("insufficient-total");
    expect(() =>
      assertProxyFullLifecyclePreflight({
        walletUtxos: [mkUtxo("525000000", "aa", 0)],
        collateralUtxos: [mkCollateralUtxo()],
      }),
    ).toThrow(/insufficient ADA/);
  });

  it("does not classify insufficient self-split budget as self-healable", () => {
    const analysis = analyzeProxyFullLifecycleUtxoShape({
      walletUtxos: [mkUtxo("540000000", "aa", 0)],
      collateralUtxos: [],
    });

    expect(analysis.status).toBe("insufficient-shape");
  });

  it("rejects when no setup UTxO has at least 20 ADA", () => {
    expect(() =>
      assertProxyFullLifecyclePreflight({
        walletUtxos: Array.from({ length: 29 }, (_, index) =>
          mkUtxo("19000000", `small-${index}`, index),
        ),
        collateralUtxos: [mkCollateralUtxo()],
      }),
    ).toThrow(/no wallet UTxO has at least 20 ADA/);
  });

  it("rejects when no key-address collateral UTxO is present", () => {
    expect(() =>
      assertProxyFullLifecyclePreflight({
        walletUtxos: [mkUtxo("540000000", "aa", 0)],
        collateralUtxos: [],
      }),
    ).toThrow(/no bot payment-address UTxO has at least 5 ADA/);
  });

  it("rejects insufficient total ADA with an actionable delta", () => {
    expect(() =>
      assertProxyFullLifecyclePreflight({
        walletUtxos: [mkUtxo("525000000", "aa", 0)],
        collateralUtxos: [mkCollateralUtxo()],
      }),
    ).toThrow(/insufficient ADA/);
  });

  it("passes when setup, key collateral, and wallet budget are available", () => {
    const result = assertProxyFullLifecyclePreflight({
      walletUtxos: [mkUtxo("540000000", "aa", 0)],
      collateralUtxos: [mkCollateralUtxo()],
    });

    expect(result.totalLovelace).toBe(540_000_000n);
    expect(result.setupCandidates).toBe(1);
    expect(result.keyCollateralCandidates).toBe(1);
    expect(result.drepSelectableLovelace).toBe(540_000_000n);
    expect(result.drepRequiredLovelace).toBe(536_000_000n);
    expect(result.requiredTotalLovelace).toBe(536_000_000n);
  });

  it("rejects when script-address UTxOs are the only apparent collateral", () => {
    expect(() =>
      assertProxyFullLifecyclePreflight({
        walletUtxos: [mkUtxo("540000000", "aa", 0), mkUtxo("6000000", "bb", 1)],
        collateralUtxos: [],
      }),
    ).toThrow(/no bot payment-address UTxO/);
  });

  it("rejects when wallet inputs cannot fund the DRep budget", () => {
    expect(() =>
      assertProxyFullLifecyclePreflight({
        walletUtxos: [mkUtxo("535999999", "aa", 0)],
        collateralUtxos: [mkCollateralUtxo()],
      }),
    ).toThrow(/insufficient ADA/);
  });

  it("uses hardcoded proxy lifecycle budget constants", () => {
    const result = assertProxyFullLifecyclePreflight({
      walletUtxos: [mkUtxo("540000000", "aa", 0)],
      collateralUtxos: [mkCollateralUtxo()],
    });

    expect(LIFECYCLE_PROXY_LOVELACE).toBe(10_000_000n);
    expect(FULL_LIFECYCLE_FEE_BUFFER_LOVELACE).toBe(20_000_000n);
    expect(result.requiredTotalLovelace).toBe(
      DREP_REGISTER_REQUIRED_LOVELACE +
        LIFECYCLE_PROXY_LOVELACE +
        1_000_000n +
        FULL_LIFECYCLE_FEE_BUFFER_LOVELACE,
    );
  });

  it("requires the normal DRep anchor URL for proxy DRep registration", () => {
    expect(getProxyDRepAnchorUrl({ CI_DREP_ANCHOR_URL: " https://example.test/drep.json " })).toBe(
      "https://example.test/drep.json",
    );
    expect(() => getProxyDRepAnchorUrl({})).toThrow(/CI_DREP_ANCHOR_URL is required/);
  });
});

describe("proxy scenario composition", () => {
  it("includes malformed-body checks for proxy finalize routes", () => {
    const scenario = createScenarioProxySmoke(mkContext(["legacy"]));
    const stepIds = scenario.steps.map((step) => step.id);

    expect(stepIds).toContain("v1.proxySetupFinalize.malformedBody");
    expect(stepIds).toContain("v1.proxyCleanupFinalize.malformedBody");
  });

  it("runs full lifecycle for legacy, hierarchical, and SDK wallets", () => {
    const scenario = createScenarioProxyFullLifecycle(mkContext(["legacy", "hierarchical", "sdk"]));
    const stepIds = scenario.steps.map((step) => step.id);

    expect(PROXY_FULL_LIFECYCLE_WALLET_TYPES).toEqual(["legacy", "hierarchical", "sdk"]);
    expect(stepIds).toContain("v1.proxy.full.recoverFromChain.legacy");
    expect(stepIds).toContain("v1.proxy.full.adoptOrphans.legacy");
    expect(stepIds).toContain("v1.proxy.full.hygiene.legacy");
    expect(stepIds).toContain("v1.proxy.full.utxoShape.legacy");
    expect(stepIds).toContain("v1.proxy.full.preflight.legacy");
    expect(stepIds.indexOf("v1.proxy.full.recoverFromChain.legacy")).toBeLessThan(
      stepIds.indexOf("v1.proxy.full.adoptOrphans.legacy"),
    );
    expect(stepIds.indexOf("v1.proxy.full.adoptOrphans.legacy")).toBeLessThan(
      stepIds.indexOf("v1.proxy.full.hygiene.legacy"),
    );
    expect(stepIds.indexOf("v1.proxy.full.hygiene.legacy")).toBeLessThan(
      stepIds.indexOf("v1.proxy.full.utxoShape.legacy"),
    );
    expect(stepIds.indexOf("v1.proxy.full.utxoShape.legacy")).toBeLessThan(
      stepIds.indexOf("v1.proxy.full.preflight.legacy"),
    );
    expect(stepIds).toContain("v1.proxy.full.recoverFromChain.hierarchical");
    expect(stepIds).toContain("v1.proxy.full.adoptOrphans.hierarchical");
    expect(stepIds).toContain("v1.proxy.full.hygiene.hierarchical");
    expect(stepIds).toContain("v1.proxy.full.utxoShape.hierarchical");
    expect(stepIds).toContain("v1.proxy.full.preflight.hierarchical");
    expect(stepIds.indexOf("v1.proxy.full.recoverFromChain.hierarchical")).toBeLessThan(
      stepIds.indexOf("v1.proxy.full.adoptOrphans.hierarchical"),
    );
    expect(stepIds.indexOf("v1.proxy.full.adoptOrphans.hierarchical")).toBeLessThan(
      stepIds.indexOf("v1.proxy.full.hygiene.hierarchical"),
    );
    expect(stepIds.indexOf("v1.proxy.full.hygiene.hierarchical")).toBeLessThan(
      stepIds.indexOf("v1.proxy.full.utxoShape.hierarchical"),
    );
    expect(stepIds.indexOf("v1.proxy.full.utxoShape.hierarchical")).toBeLessThan(
      stepIds.indexOf("v1.proxy.full.preflight.hierarchical"),
    );
    expect(stepIds).toContain("v1.proxy.full.recoverFromChain.sdk");
    expect(stepIds).toContain("v1.proxy.full.adoptOrphans.sdk");
    expect(stepIds).toContain("v1.proxy.full.hygiene.sdk");
    expect(stepIds).toContain("v1.proxy.full.utxoShape.sdk");
    expect(stepIds).toContain("v1.proxy.full.preflight.sdk");
    expect(stepIds.indexOf("v1.proxy.full.recoverFromChain.sdk")).toBeLessThan(
      stepIds.indexOf("v1.proxy.full.adoptOrphans.sdk"),
    );
    expect(stepIds.indexOf("v1.proxy.full.adoptOrphans.sdk")).toBeLessThan(
      stepIds.indexOf("v1.proxy.full.hygiene.sdk"),
    );
    expect(stepIds.indexOf("v1.proxy.full.hygiene.sdk")).toBeLessThan(
      stepIds.indexOf("v1.proxy.full.utxoShape.sdk"),
    );
    expect(stepIds.indexOf("v1.proxy.full.utxoShape.sdk")).toBeLessThan(
      stepIds.indexOf("v1.proxy.full.preflight.sdk"),
    );
  });

  it("signs proxy lifecycle transactions with signer index 0 before the broadcaster", () => {
    const scenario = createScenarioProxyFullLifecycle(mkContext(["legacy"]));
    const stepIds = scenario.steps.map((step) => step.id);

    const setupProposeIndex = stepIds.indexOf("v1.proxy.lifecycle.setup.propose.legacy");
    expect(stepIds.slice(setupProposeIndex + 1, setupProposeIndex + 3)).toEqual([
      "v1.proxy.lifecycle.setup.signer0.legacy",
      "v1.proxy.lifecycle.setup.signer1.legacy",
    ]);

    const spendProposeIndex = stepIds.indexOf("v1.proxy.full.spend.propose.legacy");
    expect(stepIds.slice(spendProposeIndex + 1, spendProposeIndex + 3)).toEqual([
      "v1.proxy.full.spend.legacy.signer0",
      "v1.proxy.full.spend.legacy.signer1",
    ]);
    expect(stepIds).not.toContain("v1.proxy.lifecycle.setup.sign1.legacy");
    expect(stepIds).not.toContain("v1.proxy.full.spend.legacy.sign1");
  });

  it("fails clearly instead of using a setup transaction id as a txHash", () => {
    expect(() =>
      requireSetupTxHash({
        setupTransactionId: "database-transaction-id",
      }),
    ).toThrow(/proxy setup was not broadcast; signer step returned submitted=false/);
  });

  it("fails clearly when full lifecycle has no eligible wallet type", async () => {
    const ctx = mkContext([]);
    const scenario = createScenarioProxyFullLifecycle(ctx);

    expect(scenario.steps).toHaveLength(1);
    expect(scenario.steps[0]?.id).toBe("v1.proxy.full.precondition");
    await expect(scenario.steps[0]?.execute(ctx)).rejects.toThrow(
      /scenario\.proxy-full-lifecycle requires at least one of legacy, hierarchical, sdk/,
    );
  });
});

describe("proxy full lifecycle hygiene", () => {
  const proxy = {
    id: "proxy-1",
    proxyAddress: "addr_test_proxy",
    authTokenId: "policy.asset",
    isActive: true,
  };

  function createHygieneDeps(requestJsonMock: ReturnType<typeof jest.fn>) {
    return {
      requestJson: requestJsonMock,
      authenticateBot: jest.fn(async () => "token"),
      getDefaultBot: jest.fn((ctx: CIBootstrapContext) => ctx.bots[0]!),
      fetchFreeUtxos: jest.fn(async () => [mkAuthTokenUtxo()]),
      fetchKeyAddressUtxos: jest.fn(async () => [mkCollateralUtxo()]),
      runSigningFlow: jest.fn(async (args: { signBroadcast?: boolean; preferredTransactionId?: string }) => ({
        walletType: "legacy" as const,
        walletId: "legacy-wallet-id",
        transactionId: args.preferredTransactionId ?? "tx",
        signerAddress: "addr_test_signer_1",
        status: 200,
        submitted: args.signBroadcast,
        txHash: args.signBroadcast ? `${args.preferredTransactionId ?? "tx"}-hash` : undefined,
      })),
      pollUntilUtxosConsumed: jest.fn(async () => ({ attempts: 1 })),
      env: { CI_MNEMONIC_1: "one", CI_MNEMONIC_2: "two" },
    };
  }

  it("no-ops when no active proxies are listed", async () => {
    const requestJsonMock = jest.fn(async () => ({ status: 200, data: [] }));

    const result = await runProxyFullLifecycleHygiene({
      ctx: mkContext(["legacy"]),
      walletType: "legacy",
      deps: createHygieneDeps(requestJsonMock),
    });

    expect(result.artifacts.noOp).toBe(true);
    expect(requestJsonMock).toHaveBeenCalledTimes(1);
  });

  it("cleans and finalizes an active proxy that is ready to burn", async () => {
    const requestJsonMock = jest
      .fn()
      .mockResolvedValueOnce({ status: 200, data: [proxy] })
      .mockResolvedValueOnce({ status: 200, data: { active: false, dRepId: "drep1proxy" } })
      .mockResolvedValueOnce({
        status: 201,
        data: { transaction: { id: "tx-burn" }, cleanup: { phase: "burn" } },
      })
      .mockResolvedValueOnce({ status: 201, data: { proxy: { ...proxy, isActive: false } } })
      .mockResolvedValueOnce({ status: 200, data: [] });
    const deps = createHygieneDeps(requestJsonMock);

    const result = await runProxyFullLifecycleHygiene({
      ctx: mkContext(["legacy"]),
      walletType: "legacy",
      deps,
    });

    expect(result.artifacts.noOp).toBe(false);
    expect(deps.runSigningFlow).toHaveBeenCalledTimes(2);
    expect(deps.pollUntilUtxosConsumed).toHaveBeenCalledTimes(1);
    expect(requestJsonMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        url: "http://localhost:3000/api/v1/proxyDRepInfo?walletId=legacy-wallet-id&address=addr_test_signer_1&proxyId=proxy-1",
      }),
    );
    expect(requestJsonMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        url: "http://localhost:3000/api/v1/proxyCleanup",
        body: expect.objectContaining({
          proxyId: proxy.id,
          deactivateProxy: true,
          utxoRefs: [{ txHash: "auth", outputIndex: 0 }],
          collateralRef: { txHash: "collateral", outputIndex: 0 },
        }),
      }),
    );
    expect(requestJsonMock).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        url: "http://localhost:3000/api/v1/proxyCleanupFinalize",
        body: expect.objectContaining({ txHash: "tx-burn-hash" }),
      }),
    );
  });

  it("runs a sweep pass before the burn pass when proxy UTxOs remain", async () => {
    const requestJsonMock = jest
      .fn()
      .mockResolvedValueOnce({ status: 200, data: [proxy] })
      .mockResolvedValueOnce({ status: 200, data: { active: false, dRepId: "drep1proxy" } })
      .mockResolvedValueOnce({
        status: 201,
        data: { transaction: { id: "tx-sweep" }, cleanup: { phase: "sweep" } },
      })
      .mockResolvedValueOnce({
        status: 201,
        data: { transaction: { id: "tx-burn" }, cleanup: { phase: "burn" } },
      })
      .mockResolvedValueOnce({ status: 201, data: { proxy: { ...proxy, isActive: false } } })
      .mockResolvedValueOnce({ status: 200, data: [] });
    const deps = createHygieneDeps(requestJsonMock);

    const result = await runProxyFullLifecycleHygiene({
      ctx: mkContext(["legacy"]),
      walletType: "legacy",
      deps,
    });

    const cleaned = result.artifacts.cleaned as Array<{ cleanupTransactions: unknown[] }>;
    expect(cleaned[0]?.cleanupTransactions).toHaveLength(2);
    expect(deps.runSigningFlow).toHaveBeenCalledTimes(4);
    expect(deps.pollUntilUtxosConsumed).toHaveBeenCalledTimes(2);
  });

  it("deregisters an active proxy DRep before cleanup", async () => {
    const requestJsonMock = jest
      .fn()
      .mockResolvedValueOnce({ status: 200, data: [proxy] })
      .mockResolvedValueOnce({ status: 200, data: { active: true, dRepId: "drep1proxy" } })
      .mockResolvedValueOnce({ status: 201, data: { transaction: { id: "tx-drep" } } })
      .mockResolvedValueOnce({
        status: 201,
        data: { transaction: { id: "tx-burn" }, cleanup: { phase: "burn" } },
      })
      .mockResolvedValueOnce({ status: 201, data: { proxy: { ...proxy, isActive: false } } })
      .mockResolvedValueOnce({ status: 200, data: [] });
    const deps = createHygieneDeps(requestJsonMock);

    const result = await runProxyFullLifecycleHygiene({
      ctx: mkContext(["legacy"]),
      walletType: "legacy",
      deps,
    });

    const cleaned = result.artifacts.cleaned as Array<{
      dRep?: { wasActive?: boolean; deregisterTransaction?: { transactionId?: string } };
    }>;
    expect(cleaned[0]?.dRep?.wasActive).toBe(true);
    expect(cleaned[0]?.dRep?.deregisterTransaction?.transactionId).toBe("tx-drep");
    expect(deps.runSigningFlow).toHaveBeenCalledTimes(4);
    expect(deps.pollUntilUtxosConsumed).toHaveBeenCalledTimes(2);
    expect(requestJsonMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        url: "http://localhost:3000/api/v1/proxyDRepCertificate",
        body: expect.objectContaining({
          proxyId: proxy.id,
          action: "deregister",
          utxoRefs: [{ txHash: "auth", outputIndex: 0 }],
          collateralRef: { txHash: "collateral", outputIndex: 0 },
        }),
      }),
    );
    expect(requestJsonMock).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        url: "http://localhost:3000/api/v1/proxyCleanup",
      }),
    );
  });
});
