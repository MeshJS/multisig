import type { CIBootstrapContext, RouteStep, Scenario } from "../framework/types";
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

function createPendingStep(walletType: string): RouteStep {
  return {
    id: `v1.pendingTransactions.${walletType}`,
    description: `Verify pending transactions for ${walletType} wallet`,
    severity: "critical",
    execute: async (ctx) => {
      const bot = getDefaultBot(ctx);
      const token = await authenticateBot({ ctx, bot });
      const wallet = getWalletByType(ctx, walletType);
      if (!wallet) {
        throw new Error(`Missing wallet type in context: ${walletType}`);
      }
      const route = `${ctx.apiBaseUrl}/api/v1/pendingTransactions?walletId=${encodeURIComponent(wallet.walletId)}&address=${encodeURIComponent(bot.paymentAddress)}`;
      const response = await requestJson<Array<{ id?: string }> | { error?: string }>({
        url: route,
        method: "GET",
        token,
      });
      if (response.status !== 200 || !Array.isArray(response.data)) {
        throw new Error(
          `pendingTransactions failed for ${walletType} (${response.status}): ${stringifyRedacted(response.data)}`,
        );
      }
      const seededFound = response.data.some((tx) => tx.id === wallet.transactionId);
      if (!seededFound) {
        throw new Error(
          `pendingTransactions for ${walletType} did not include seeded tx ${wallet.transactionId}`,
        );
      }
      return {
        message: `pendingTransactions succeeded for ${walletType} with ${response.data.length} rows`,
        artifacts: {
          walletId: wallet.walletId,
          expectedTransactionId: wallet.transactionId,
          rowCount: response.data.length,
        },
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

function createSigningStep(args: {
  id: string;
  description: string;
  signerIndex: number;
  mnemonicEnvName: "CI_MNEMONIC_1" | "CI_MNEMONIC_2" | "CI_MNEMONIC_3";
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
        signWalletType: process.env.CI_SIGN_WALLET_TYPE ?? "legacy",
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
    id: "scenario.pending-and-discovery",
    description: "Wallet discovery and pending transaction checks across bootstrap wallets",
    steps: [createWalletIdsStep()],
  };
}

function createScenarioPendingPerWallet(ctx: CIBootstrapContext): Scenario {
  return {
    id: "scenario.pending-per-wallet",
    description: "Pending transaction validation for each wallet type",
    steps: ctx.walletTypes.map((walletType) => createPendingStep(walletType)),
  };
}

function createScenarioAdaRouteHealth(ctx: CIBootstrapContext): Scenario {
  return {
    id: "scenario.ada-route-health",
    description: "Route chain for transfer readiness (freeUtxos + multi-signer signTransaction progression)",
    steps: [
      ...ctx.walletTypes.map((walletType) => createFreeUtxosStep(walletType)),
      createSigningStep({
        id: "v1.signTransaction.selectedWallet.signer1",
        description: "Signer 1 adds witness without broadcast for selected wallet type",
        signerIndex: 1,
        mnemonicEnvName: "CI_MNEMONIC_2",
        signBroadcast: false,
        requireBroadcastSuccess: false,
      }),
      createSigningStep({
        id: "v1.signTransaction.selectedWallet.signer2",
        description: "Signer 2 signs and broadcasts selected wallet transaction",
        signerIndex: 2,
        mnemonicEnvName: "CI_MNEMONIC_3",
        signBroadcast: true,
        requireBroadcastSuccess: true,
      }),
    ],
  };
}

function createScenarioRealTransferAndSign(runtime: {
  transferTxId?: string;
  transferWalletId?: string;
}): Scenario {
  return {
    id: "scenario.real-transfer-and-sign",
    description: "Build real transfer tx via addTransaction and sign+broadcast it",
    steps: [
      {
        id: "v1.addTransaction.realTransfer",
        description: "Create real ADA transfer transaction for selected wallet",
        severity: "critical",
        execute: async (ctx) => {
          const mnemonic = process.env.CI_MNEMONIC_2;
          if (!mnemonic || !mnemonic.trim()) {
            throw new Error("CI_MNEMONIC_2 is required for transfer scenario");
          }
          const transferResult = await seedRealTransferTransaction({
            ctx,
            fromMnemonic: mnemonic,
            walletType: process.env.CI_SIGN_WALLET_TYPE ?? "legacy",
            transferLovelace: process.env.CI_TRANSFER_LOVELACE,
          });
          runtime.transferTxId = transferResult.transactionId;
          runtime.transferWalletId = transferResult.walletId;
          return {
            message: `Real transfer tx created (${transferResult.transactionId}) for ${transferResult.walletType}`,
            artifacts: transferResult as unknown as Record<string, unknown>,
          };
        },
      },
      createSigningStep({
        id: "v1.signTransaction.selectedTransfer.signer1",
        description: "Signer 1 adds witness without broadcast for selected transfer transaction",
        signerIndex: 1,
        mnemonicEnvName: "CI_MNEMONIC_2",
        signBroadcast: false,
        requireBroadcastSuccess: false,
        preferredTransactionId: () => runtime.transferTxId,
      }),
      createSigningStep({
        id: "v1.signTransaction.selectedTransfer.signer2",
        description: "Signer 2 signs and broadcasts selected transfer transaction",
        signerIndex: 2,
        mnemonicEnvName: "CI_MNEMONIC_3",
        signBroadcast: true,
        requireBroadcastSuccess: true,
        preferredTransactionId: () => runtime.transferTxId,
      }),
    ],
  };
}

function createScenarioFinalAssertions(runtime: {
  transferTxId?: string;
  transferWalletId?: string;
}): Scenario {
  return {
    id: "scenario.final-assertions",
    description: "Validate final state after transfer/sign route chain",
    steps: [
      {
        id: "v1.pendingTransactions.transferRemoved",
        description: "Assert signed transfer transaction is no longer pending",
        severity: "critical",
        execute: async (ctx) => {
          const bot = getDefaultBot(ctx);
          const token = await authenticateBot({ ctx, bot });
          const txId = runtime.transferTxId;
          const walletId = runtime.transferWalletId;
          if (!txId || !walletId) {
            throw new Error("Transfer runtime context missing transaction/wallet id");
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
          return {
            message: `Transfer tx ${txId} no longer present in pending transactions`,
            artifacts: { walletId, transactionId: txId, pendingCount: response.data.length },
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
  const runtime: { transferTxId?: string; transferWalletId?: string } = {};
  return [
    createScenarioPendingAndDiscovery(),
    createScenarioPendingPerWallet(ctx),
    createScenarioAdaRouteHealth(ctx),
    createScenarioRealTransferAndSign(runtime),
    createScenarioFinalAssertions(runtime),
  ];
}
