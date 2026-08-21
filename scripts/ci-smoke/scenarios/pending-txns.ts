import type { Context, ScenarioResult } from "./types";
import { getPendingTransactions } from "../../bot-ref/bot-client";

export async function pendingTxnsScenario(ctx: Context): Promise<ScenarioResult> {
  const start = Date.now();
  try {
    const txns = await getPendingTransactions(
      ctx.baseUrl,
      ctx.botToken,
      ctx.wallets.sdk.id,
      ctx.botAddress,
    );

    if (!Array.isArray(txns)) {
      return {
        name: "pending-txns",
        passed: false,
        critical: false,
        message: "pendingTransactions did not return an array",
        durationMs: Date.now() - start,
      };
    }

    // If add-transaction created a tx, it should appear here
    if (ctx.pendingTxId) {
      const found = txns.some(
        (tx) => (tx as { id?: string }).id === ctx.pendingTxId,
      );
      if (!found) {
        return {
          name: "pending-txns",
          passed: false,
          critical: false,
          message: `Expected pending tx ${ctx.pendingTxId} not found in ${txns.length} results`,
          durationMs: Date.now() - start,
        };
      }
    }

    return {
      name: "pending-txns",
      passed: true,
      critical: false,
      message: `Found ${txns.length} pending transactions`,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name: "pending-txns",
      passed: false,
      critical: false,
      message: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}
