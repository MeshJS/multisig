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

export function createScenarioPendingAndDiscovery(): Scenario {
  return {
    id: "scenario.wallet-discovery",
    description: "Wallet discovery checks across bootstrap wallets",
    steps: [createWalletIdsStep()],
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
