import type { Context, ScenarioResult } from "./types";

/**
 * Submits a minimal placeholder transaction via the addTransaction API.
 * This validates the route accepts and stores the transaction, not that it is
 * blockchain-valid (we don't have funded UTxOs in CI by default).
 */
export async function addTransactionScenario(ctx: Context): Promise<ScenarioResult> {
  const start = Date.now();
  try {
    const base = ctx.baseUrl.replace(/\/$/, "");

    // Minimal tx CBOR placeholder (empty body). The API stores whatever CBOR
    // is given — real chain validation happens only at submission.
    const placeholderTxCbor = "84a400800180020000a0f5f6";
    const placeholderTxJson = JSON.stringify({
      type: "Tx ConwayEra",
      description: "CI smoke test placeholder",
    });

    const res = await fetch(`${base}/api/v1/addTransaction`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.botToken}`,
      },
      body: JSON.stringify({
        walletId: ctx.wallets.sdk.id,
        address: ctx.botAddress,
        txCbor: placeholderTxCbor,
        txJson: placeholderTxJson,
        description: "CI smoke add-transaction test",
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        name: "add-transaction",
        passed: false,
        critical: true,
        message: `addTransaction returned ${res.status}: ${text}`,
        durationMs: Date.now() - start,
      };
    }

    const data = (await res.json()) as { id?: string };
    if (data.id) {
      ctx.pendingTxId = data.id;
    }

    return {
      name: "add-transaction",
      passed: true,
      critical: true,
      message: `Transaction created: ${data.id ?? "ok"}`,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name: "add-transaction",
      passed: false,
      critical: true,
      message: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}
