import type { CIBootstrapContext, RouteStep, Scenario } from "../../framework/types";
import { requestJson } from "../../framework/http";
import { getDefaultBot } from "../../framework/botContext";
import { authenticateBot } from "../../framework/botAuth";
import { stringifyRedacted } from "../../framework/redact";
import { getWalletByType } from "./helpers";

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

function createPendingTransactionsZeroStep(walletType: string): RouteStep {
  return {
    id: `v1.pendingTransactions.zero.${walletType}`,
    description: `Assert no pending transactions at bootstrap for ${walletType} wallet`,
    severity: "non-critical",
    execute: async (ctx) => {
      const bot = getDefaultBot(ctx);
      const token = await authenticateBot({ ctx, bot });
      const wallet = getWalletByType(ctx, walletType);
      if (!wallet) {
        throw new Error(`Missing wallet type in context: ${walletType}`);
      }
      const response = await requestJson<unknown[] | { error?: string }>({
        url: `${ctx.apiBaseUrl}/api/v1/pendingTransactions?walletId=${encodeURIComponent(wallet.walletId)}&address=${encodeURIComponent(bot.paymentAddress)}`,
        method: "GET",
        token,
      });
      if (response.status !== 200 || !Array.isArray(response.data)) {
        throw new Error(
          `pendingTransactions zero-check failed for ${walletType} (${response.status}): ${stringifyRedacted(response.data)}`,
        );
      }
      if (response.data.length !== 0) {
        throw new Error(
          `pendingTransactions zero-check: expected 0 pending txs for ${walletType} at bootstrap, found ${response.data.length}. A previous CI run may have left stale state.`,
        );
      }
      return {
        message: `pendingTransactions confirmed empty for ${walletType} at bootstrap`,
        artifacts: { walletId: wallet.walletId, pendingCount: 0 },
      };
    },
  };
}

function createLookupMultisigWalletStep(ctx: CIBootstrapContext): RouteStep {
  return {
    id: "v1.lookupMultisigWallet.signerKeyHash",
    description: "Smoke-test public /api/v1/lookupMultisigWallet with a signer key hash",
    severity: "non-critical",
    execute: async (runCtx) => {
      const signerAddress = runCtx.signerAddresses[0];
      if (!signerAddress) {
        throw new Error("lookupMultisigWallet: no signer addresses in bootstrap context");
      }
      const { resolvePaymentKeyHash } = await import("@meshsdk/core");
      const keyHash = resolvePaymentKeyHash(signerAddress);
      const response = await requestJson<unknown[] | { error?: string }>({
        url: `${runCtx.apiBaseUrl}/api/v1/lookupMultisigWallet?pubKeyHashes=${encodeURIComponent(keyHash)}&network=${runCtx.networkId}`,
        method: "GET",
      });
      if (response.status !== 200 || !Array.isArray(response.data)) {
        throw new Error(
          `lookupMultisigWallet failed (${response.status}): ${stringifyRedacted(response.data)}`,
        );
      }
      return {
        message: `lookupMultisigWallet returned ${response.data.length} on-chain metadata entries for signer key hash`,
        artifacts: { keyHash, matchCount: response.data.length },
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
    description: `Fetch and validate native scripts for ${walletType} wallet`,
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

      // Assert a payment script entry is present
      const paymentEntry = response.data.find((entry) => entry.type === "payment");
      if (!paymentEntry) {
        throw new Error(
          `nativeScript: no "payment" type entry for ${walletType}; got types: ${response.data.map((e) => e.type).join(", ")}`,
        );
      }

      // If the decoded payment script is an atLeast type, validate the required count
      const script = paymentEntry.script as Record<string, unknown> | null | undefined;
      if (script && typeof script === "object" && script.type === "atLeast" && typeof script.required === "number") {
        const numRequired = parseInt(process.env.CI_NUM_REQUIRED_SIGNERS ?? "2", 10);
        if (script.required !== numRequired) {
          throw new Error(
            `nativeScript: atLeast required=${script.required} does not match CI_NUM_REQUIRED_SIGNERS=${numRequired} for ${walletType}`,
          );
        }
      }

      return {
        message: `nativeScript returned ${response.data.length} script entries for ${walletType} (payment script present)`,
        artifacts: {
          walletId: wallet.walletId,
          walletType,
          scriptCount: response.data.length,
          scriptTypes: response.data.map((e) => e.type),
          nativeScripts: response.data,
        },
      };
    },
  };
}

export function createScenarioPendingAndDiscovery(ctx: CIBootstrapContext): Scenario {
  return {
    id: "scenario.wallet-discovery",
    description: "Wallet discovery checks across bootstrap wallets",
    steps: [
      createWalletIdsStep(),
      ...ctx.walletTypes.map((walletType) => createPendingTransactionsZeroStep(walletType)),
      createLookupMultisigWalletStep(ctx),
    ],
  };
}

export function createScenarioAdaRouteHealth(ctx: CIBootstrapContext): Scenario {
  return {
    id: "scenario.ada-route-health",
    description: "Route chain for transfer readiness (freeUtxos + nativeScript)",
    steps: [
      ...ctx.walletTypes.map((walletType) => createFreeUtxosStep(walletType)),
      ...ctx.walletTypes.map((walletType) => createNativeScriptStep(walletType)),
    ],
  };
}
