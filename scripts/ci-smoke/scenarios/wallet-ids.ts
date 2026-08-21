import type { Context, ScenarioResult } from "./types";
import { getWalletIds } from "../../bot-ref/bot-client";

export async function walletIdsScenario(ctx: Context): Promise<ScenarioResult> {
  const start = Date.now();
  try {
    const wallets = await getWalletIds(
      ctx.baseUrl,
      ctx.botToken,
      ctx.botAddress,
    );

    if (!Array.isArray(wallets)) {
      return {
        name: "wallet-ids",
        passed: false,
        critical: true,
        message: "walletIds did not return an array",
        durationMs: Date.now() - start,
      };
    }

    // Bot should be a signer on at least the legacy and sdk wallets
    const walletIdSet = new Set(wallets.map((w) => w.walletId));
    const expectedIds = [ctx.wallets.legacy.id, ctx.wallets.sdk.id];
    const missing = expectedIds.filter((id) => !walletIdSet.has(id));

    if (missing.length > 0) {
      return {
        name: "wallet-ids",
        passed: false,
        critical: true,
        message: `Bot missing expected wallets: ${missing.join(", ")}`,
        durationMs: Date.now() - start,
      };
    }

    return {
      name: "wallet-ids",
      passed: true,
      critical: true,
      message: `Found ${wallets.length} wallets for bot address`,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name: "wallet-ids",
      passed: false,
      critical: true,
      message: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}
