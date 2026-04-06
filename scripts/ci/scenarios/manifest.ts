import type { CIBootstrapContext, CIWalletType, RouteStep, Scenario } from "../framework/types";
import { requestJson } from "../framework/http";
import { runSigningFlow } from "./signingFlow";
import { seedRealTransferTransaction } from "./transferFlow";
import { getDefaultBot } from "../framework/botContext";
import { authenticateBot } from "../framework/botAuth";
import { stringifyRedacted } from "../framework/redact";

function boolFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.trim().toLowerCase() === "true";
}

function getWalletByType(ctx: CIBootstrapContext, typeRaw: string) {
  const type = typeRaw.trim().toLowerCase();
  return ctx.wallets.find((w) => w.type === type);
}

function getRingWalletTypes(ctx: CIBootstrapContext): [CIWalletType, CIWalletType, CIWalletType] {
  const expected: CIWalletType[] = ["legacy", "hierarchical", "sdk"];
  const missing = expected.filter((walletType) => !ctx.wallets.some((wallet) => wallet.type === walletType));
  if (missing.length) {
    throw new Error(`Ring transfer scenario requires wallet types: legacy,hierarchical,sdk; missing: ${missing.join(", ")}`);
  }
  return ["legacy", "hierarchical", "sdk"];
}

function createWalletIdsStep(): RouteStep {
  return {
    id: "v1.walletIds.botAddress",
    description: "Verify bot wallet discovery via /api/v1/walletIds",
    severity: "critical",
    execute: async (ctx) => {
      const bot = getDefaultBot(ctx);
      const token = await authenticateBot({ ctx, bot });
      const response = await requestJson<Array<{ walletId?: string; walletName?: string }> | { error?: string }>({
        url: `${ctx.apiBaseUrl}/api/v1/walletIds?address=${encodeURIComponent(bot.paymentAddress)}`,
        method: "GET",
        token,
      });
      if (response.status !== 200 || !Array.isArray(response.data)) {
        throw new Error(`walletIds failed (${response.status}): ${stringifyRedacted(response.data)}`);
      }

      const ids = new Set(
        response.data
          .map((w) => (typeof w.walletId === "string" ? w.walletId : ""))
          .filter(Boolean),
      );
      const missing = ctx.wallets.map((w) => w.walletId).filter((id) => !ids.has(id));
      if (missing.length) {
        throw new Error(`walletIds did not include expected wallets: ${missing.join(", ")}`);
      }

      return {
        message: `walletIds returned ${response.data.length} wallets and includes all bootstrap wallets`,
        artifacts: { returnedWallets: response.data.length },
      };
    },
  };
}

function createFreeUtxosStep(walletType: string): RouteStep {
  return {
    id: `v1.freeUtxos.${walletType}`,
    description: `Probe free UTxOs route for ${walletType} wallet`,
    severity: "non-critical",
    execute: async (ctx) => {
      const bot = getDefaultBot(ctx);
      const token = await authenticateBot({ ctx, bot });
      const wallet = getWalletByType(ctx, walletType);
      if (!wallet) {
        throw new Error(`Missing wallet type in context: ${walletType}`);
      }
      const response = await requestJson<unknown[] | { error?: string }>({
        url: `${ctx.apiBaseUrl}/api/v1/freeUtxos?walletId=${encodeURIComponent(wallet.walletId)}&address=${encodeURIComponent(bot.paymentAddress)}`,
        method: "GET",
        token,
      });
      if (response.status !== 200 || !Array.isArray(response.data)) {
        throw new Error(
          `freeUtxos failed for ${walletType} (${response.status}): ${stringifyRedacted(response.data)}`,
        );
      }
      return {
        message: `freeUtxos returned ${response.data.length} entries for ${walletType}`,
        artifacts: { walletId: wallet.walletId, utxoCount: response.data.length },
      };
    },
  };
}

function createNativeScriptStep(walletType: string): RouteStep {
  return {
    id: `v1.nativeScript.${walletType}`,
    description: `Fetch native scripts for ${walletType} wallet`,
    severity: "non-critical",
    execute: async (ctx) => {
      const bot = getDefaultBot(ctx);
      const token = await authenticateBot({ ctx, bot });
      const wallet = getWalletByType(ctx, walletType);
      if (!wallet) {
        throw new Error(`Missing wallet type in context: ${walletType}`);
      }
      const response = await requestJson<Array<{ type?: string; script?: unknown }> | { error?: string }>({
        url: `${ctx.apiBaseUrl}/api/v1/nativeScript?walletId=${encodeURIComponent(wallet.walletId)}&address=${encodeURIComponent(bot.paymentAddress)}`,
        method: "GET",
        token,
      });
      if (response.status !== 200 || !Array.isArray(response.data)) {
        throw new Error(
          `nativeScript failed for ${walletType} (${response.status}): ${stringifyRedacted(response.data)}`,
        );
      }
      if (response.data.length === 0) {
        throw new Error(`nativeScript returned no scripts for ${walletType}`);
      }
      return {
        message: `nativeScript returned ${response.data.length} script entries for ${walletType}`,
        artifacts: {
          walletId: wallet.walletId,
          walletType,
          scriptCount: response.data.length,
          nativeScripts: response.data,
        },
      };
    },
  };
}

function createSigningStep(args: {
  id: string;
  description: string;
  signerIndex: number;
  mnemonicEnvName: "CI_MNEMONIC_1" | "CI_MNEMONIC_2" | "CI_MNEMONIC_3";
  signWalletType?: string;
  signBroadcast: boolean;
  requireBroadcastSuccess: boolean;
  preferredTransactionId?: () => string | undefined;
}): RouteStep {
  return {
    id: args.id,
    description: args.description,
    severity: "critical",
    execute: async (ctx) => {
      const mnemonic = process.env[args.mnemonicEnvName];
      if (!mnemonic || !mnemonic.trim()) {
        throw new Error(`${args.mnemonicEnvName} is required for signing scenario`);
      }
      const result = await runSigningFlow({
        ctx,
        mnemonic,
        signWalletType: args.signWalletType ?? process.env.CI_SIGN_WALLET_TYPE ?? "legacy",
        signerIndex: args.signerIndex,
        signerLabel: `signer${args.signerIndex}`,
        signBroadcast: args.signBroadcast && boolFromEnv(process.env.SIGN_BROADCAST, true),
        preferredTransactionId: args.preferredTransactionId?.(),
        requireBroadcastSuccess: args.requireBroadcastSuccess,
      });
      return {
        message: `signTransaction completed for ${result.walletType} (status=${result.status}, submitted=${String(result.submitted)})`,
        artifacts: result as unknown as Record<string, unknown>,
      };
    },
  };
}

function createScenarioPendingAndDiscovery(): Scenario {
  return {
    id: "scenario.wallet-discovery",
    description: "Wallet discovery checks across bootstrap wallets",
    steps: [createWalletIdsStep()],
  };
}

function createScenarioAdaRouteHealth(ctx: CIBootstrapContext): Scenario {
  return {
    id: "scenario.ada-route-health",
    description: "Route chain for transfer readiness (freeUtxos + nativeScript)",
    steps: [
      ...ctx.walletTypes.map((walletType) => createFreeUtxosStep(walletType)),
      ...ctx.walletTypes.map((walletType) => createNativeScriptStep(walletType)),
    ],
  };
}

function createScenarioRealTransferAndSign(runtime: {
  transferLegs: Array<{
    fromWalletType: CIWalletType;
    toWalletType: CIWalletType;
    fromWalletId?: string;
    transferTxId?: string;
  }>;
}): Scenario {
  return {
    id: "scenario.real-transfer-and-sign",
    description: "Build ring transfer txs across multisig wallets and sign+broadcast each leg",
    steps: runtime.transferLegs.flatMap((leg, index) => {
      const legName = `${leg.fromWalletType}To${leg.toWalletType}`;
      const legOrdinal = index + 1;
      return [
        {
          id: `v1.addTransaction.realTransfer.${legName}`,
          description: `Create ring leg ${legOrdinal} transfer (${leg.fromWalletType} -> ${leg.toWalletType})`,
          severity: "critical" as const,
          execute: async (ctx: CIBootstrapContext) => {
            const mnemonic = process.env.CI_MNEMONIC_2;
            if (!mnemonic || !mnemonic.trim()) {
              throw new Error("CI_MNEMONIC_2 is required for transfer scenario");
            }
            const transferResult = await seedRealTransferTransaction({
              ctx,
              fromMnemonic: mnemonic,
              fromWalletType: leg.fromWalletType,
              toWalletType: leg.toWalletType,
              transferLovelace: process.env.CI_TRANSFER_LOVELACE,
            });
            leg.transferTxId = transferResult.transactionId;
            leg.fromWalletId = transferResult.fromWalletId;
            return {
              message: `Real transfer tx created (${transferResult.transactionId}) for ${leg.fromWalletType} -> ${leg.toWalletType}`,
              artifacts: transferResult as unknown as Record<string, unknown>,
            };
          },
        },
        {
          id: `v1.pendingTransactions.ringTransfer.present.${legName}`,
          description: `Assert ring leg ${legOrdinal} transaction is pending in source wallet`,
          severity: "critical" as const,
          execute: async (ctx: CIBootstrapContext) => {
            const txId = leg.transferTxId;
            const walletId = leg.fromWalletId;
            if (!txId || !walletId) {
              throw new Error(`Transfer runtime context missing for ring leg ${legName}`);
            }
            const bot = getDefaultBot(ctx);
            const token = await authenticateBot({ ctx, bot });
            const response = await requestJson<Array<{ id?: string }> | { error?: string }>({
              url: `${ctx.apiBaseUrl}/api/v1/pendingTransactions?walletId=${encodeURIComponent(walletId)}&address=${encodeURIComponent(bot.paymentAddress)}`,
              method: "GET",
              token,
            });
            if (response.status !== 200 || !Array.isArray(response.data)) {
              throw new Error(
                `pendingTransactions ring leg present check failed (${response.status}): ${stringifyRedacted(response.data)}`,
              );
            }
            const found = response.data.some((tx) => tx.id === txId);
            if (!found) {
              throw new Error(`Transfer tx ${txId} not found in pending for wallet ${walletId}`);
            }
            return {
              message: `Transfer tx ${txId} is present in pending transactions`,
              artifacts: { walletId, transactionId: txId, pendingCount: response.data.length },
            };
          },
        },
        createSigningStep({
          id: `v1.signTransaction.ringTransfer.signer1.${legName}`,
          description: `Signer 1 adds witness without broadcast for ring leg ${legOrdinal}`,
          signerIndex: 1,
          mnemonicEnvName: "CI_MNEMONIC_2",
          signWalletType: leg.fromWalletType,
          signBroadcast: false,
          requireBroadcastSuccess: false,
          preferredTransactionId: () => leg.transferTxId,
        }),
        createSigningStep({
          id: `v1.signTransaction.ringTransfer.signer2.${legName}`,
          description: `Signer 2 signs and broadcasts ring leg ${legOrdinal}`,
          signerIndex: 2,
          mnemonicEnvName: "CI_MNEMONIC_3",
          signWalletType: leg.fromWalletType,
          signBroadcast: true,
          requireBroadcastSuccess: true,
          preferredTransactionId: () => leg.transferTxId,
        }),
        {
          id: `v1.pendingTransactions.ringTransfer.removed.${legName}`,
          description: `Assert ring leg ${legOrdinal} transaction is cleared from pending`,
          severity: "critical" as const,
          execute: async (ctx: CIBootstrapContext) => {
            const txId = leg.transferTxId;
            const walletId = leg.fromWalletId;
            if (!txId || !walletId) {
              throw new Error(`Transfer runtime context missing for ring leg ${legName}`);
            }
            const bot = getDefaultBot(ctx);
            const token = await authenticateBot({ ctx, bot });
            const response = await requestJson<Array<{ id?: string }> | { error?: string }>({
              url: `${ctx.apiBaseUrl}/api/v1/pendingTransactions?walletId=${encodeURIComponent(walletId)}&address=${encodeURIComponent(bot.paymentAddress)}`,
              method: "GET",
              token,
            });
            if (response.status !== 200 || !Array.isArray(response.data)) {
              throw new Error(
                `pendingTransactions ring leg removed check failed (${response.status}): ${stringifyRedacted(response.data)}`,
              );
            }
            const stillPending = response.data.some((tx) => tx.id === txId);
            if (stillPending) {
              throw new Error(`Transfer tx ${txId} is still pending after sign+broadcast`);
            }
            return {
              message: `Transfer tx ${txId} removed from pending transactions`,
              artifacts: { walletId, transactionId: txId, pendingCount: response.data.length },
            };
          },
        },
      ];
    }),
  };
}

function createScenarioFinalAssertions(runtime: {
  transferLegs: Array<{
    fromWalletType: CIWalletType;
    toWalletType: CIWalletType;
    fromWalletId?: string;
    transferTxId?: string;
  }>;
}): Scenario {
  return {
    id: "scenario.final-assertions",
    description: "Validate final state after transfer/sign route chain",
    steps: [
      {
        id: "v1.pendingTransactions.allRingTransfersRemoved",
        description: "Assert all signed ring transfer transactions are no longer pending",
        severity: "critical",
        execute: async (ctx) => {
          const bot = getDefaultBot(ctx);
          const token = await authenticateBot({ ctx, bot });
          const checked: Array<{ walletId: string; transactionId: string; pendingCount: number }> = [];
          for (const leg of runtime.transferLegs) {
            const txId = leg.transferTxId;
            const walletId = leg.fromWalletId;
            if (!txId || !walletId) {
              throw new Error(`Transfer runtime context missing transaction/wallet id for ${leg.fromWalletType} -> ${leg.toWalletType}`);
            }
            const response = await requestJson<Array<{ id?: string }> | { error?: string }>({
              url: `${ctx.apiBaseUrl}/api/v1/pendingTransactions?walletId=${encodeURIComponent(walletId)}&address=${encodeURIComponent(bot.paymentAddress)}`,
              method: "GET",
              token,
            });
            if (response.status !== 200 || !Array.isArray(response.data)) {
              throw new Error(
                `pendingTransactions final assertion failed (${response.status}): ${stringifyRedacted(response.data)}`,
              );
            }
            const stillPending = response.data.some((tx) => tx.id === txId);
            if (stillPending) {
              throw new Error(`Transfer tx ${txId} is still pending after sign+broadcast`);
            }
            checked.push({ walletId, transactionId: txId, pendingCount: response.data.length });
          }
          return {
            message: `All ${checked.length} ring transfer txs are no longer present in pending transactions`,
            artifacts: { checked },
          };
        },
      },
      {
        id: "v1.walletIds.postTransfer",
        description: "Assert wallet discovery remains consistent after transfer flow",
        severity: "non-critical",
        execute: async (ctx) => {
          const bot = getDefaultBot(ctx);
          const token = await authenticateBot({ ctx, bot });
          const response = await requestJson<Array<{ walletId?: string }> | { error?: string }>({
            url: `${ctx.apiBaseUrl}/api/v1/walletIds?address=${encodeURIComponent(bot.paymentAddress)}`,
            method: "GET",
            token,
          });
          if (response.status !== 200 || !Array.isArray(response.data)) {
            throw new Error(
              `walletIds post-transfer failed (${response.status}): ${stringifyRedacted(response.data)}`,
            );
          }
          return {
            message: `walletIds remains healthy after transfer (${response.data.length} wallets)`,
            artifacts: { walletCount: response.data.length },
          };
        },
      },
    ],
  };
}

export function getScenarioManifest(ctx: CIBootstrapContext): Scenario[] {
  const [legacy, hierarchical, sdk] = getRingWalletTypes(ctx);
  const runtime: {
    transferLegs: Array<{
      fromWalletType: CIWalletType;
      toWalletType: CIWalletType;
      fromWalletId?: string;
      transferTxId?: string;
    }>;
  } = {
    transferLegs: [
      { fromWalletType: legacy, toWalletType: hierarchical },
      { fromWalletType: hierarchical, toWalletType: sdk },
      { fromWalletType: sdk, toWalletType: legacy },
    ],
  };
  return [
    createScenarioPendingAndDiscovery(),
    createScenarioAdaRouteHealth(ctx),
    createScenarioRealTransferAndSign(runtime),
    createScenarioFinalAssertions(runtime),
  ];
}
