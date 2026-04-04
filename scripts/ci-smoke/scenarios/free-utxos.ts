import type { Context, ScenarioResult } from "./types";
import { getFreeUtxos } from "../../bot-ref/bot-client";

export async function freeUtxosScenario(ctx: Context): Promise<ScenarioResult> {
  const start = Date.now();
  try {
    const utxos = await getFreeUtxos(
      ctx.baseUrl,
      ctx.botToken,
      ctx.wallets.legacy.id,
      ctx.botAddress,
    );

    if (!Array.isArray(utxos)) {
      return {
        name: "free-utxos",
        passed: false,
        critical: false,
        message: "freeUtxos did not return an array",
        durationMs: Date.now() - start,
      };
    }

    return {
      name: "free-utxos",
      passed: true,
      critical: false,
      message: `Found ${utxos.length} UTxOs for legacy wallet`,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name: "free-utxos",
      passed: false,
      critical: false,
      message: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}
