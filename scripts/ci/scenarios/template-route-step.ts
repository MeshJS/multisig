import type { CIBootstrapContext, RouteStep, StepRunResult } from "../framework/types";
import { requestJson } from "../framework/http";
import { getDefaultBot } from "../framework/botContext";
import { authenticateBot } from "../framework/botAuth";
import { stringifyRedacted } from "../framework/redact";

/**
 * Copy this file when adding a new route step.
 *
 * Suggested flow:
 * 1) Rename the exported factory function.
 * 2) Replace `id` and `description` with route-specific values.
 * 3) Define deterministic inputs from context/env.
 * 4) Perform request(s) with requestJson().
 * 5) Add strict assertions and return concise artifacts.
 */
export function createTemplateRouteStep(): RouteStep {
  return {
    id: "template.route.step",
    description: "Template step - replace with real route behavior",
    severity: "critical",
    execute: async (ctx: CIBootstrapContext): Promise<StepRunResult> => {
      const bot = getDefaultBot(ctx);
      const token = await authenticateBot({ ctx, bot });
      // Example deterministic setup from bootstrap context.
      const wallet = ctx.wallets[0];
      if (!wallet) {
        throw new Error("No wallets available in CI bootstrap context");
      }

      // Example route call. Replace URL/body with your target endpoint contract.
      const response = await requestJson<unknown>({
        url: `${ctx.apiBaseUrl}/api/v1/pendingTransactions?walletId=${encodeURIComponent(wallet.walletId)}&address=${encodeURIComponent(bot.paymentAddress)}`,
        method: "GET",
        token,
      });

      // Replace with route-specific assertions.
      if (response.status !== 200) {
        throw new Error(
          `Template step expected 200, got ${response.status}: ${stringifyRedacted(response.data)}`,
        );
      }

      return {
        message: "Template route step passed",
        artifacts: {
          walletId: wallet.walletId,
          status: response.status,
        },
      };
    },
  };
}
