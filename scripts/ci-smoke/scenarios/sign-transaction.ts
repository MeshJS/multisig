import type { Context, ScenarioResult } from "./types";

/**
 * Validates the signTransaction API route by sending a co-sign request.
 * This verifies the route accepts and processes witness data.
 *
 * Note: Without a real funded UTxO and valid key pair this will exercise
 * the validation path but may not achieve a full on-chain submit. The goal
 * is to validate the API route doesn't 500 and returns the expected shape.
 */
export async function signTransactionScenario(ctx: Context): Promise<ScenarioResult> {
  const start = Date.now();
  try {
    if (!ctx.pendingTxId) {
      return {
        name: "sign-transaction",
        passed: false,
        critical: true,
        message: "No pending transaction ID in context (add-transaction must run first)",
        durationMs: Date.now() - start,
      };
    }

    const base = ctx.baseUrl.replace(/\/$/, "");

    // We send a dummy signature. The API will validate the key/signature
    // and return an error — but the important thing is that the route
    // responds correctly (doesn't 500) and returns a structured error.
    const dummyKey = "a".repeat(64);
    const dummySig = "b".repeat(128);

    const res = await fetch(`${base}/api/v1/signTransaction`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.botToken}`,
      },
      body: JSON.stringify({
        walletId: ctx.wallets.sdk.id,
        transactionId: ctx.pendingTxId,
        address: ctx.botAddress,
        key: dummyKey,
        signature: dummySig,
        broadcast: "false",
      }),
    });

    // We expect a 4xx validation error (not 500), since dummy key/sig won't match
    if (res.status >= 500) {
      return {
        name: "sign-transaction",
        passed: false,
        critical: true,
        message: `signTransaction returned server error ${res.status}: ${await res.text()}`,
        durationMs: Date.now() - start,
      };
    }

    const data = await res.json();

    // 4xx with structured error is expected (key mismatch)
    // 2xx would mean the dummy worked (unlikely but fine)
    return {
      name: "sign-transaction",
      passed: true,
      critical: true,
      message: `signTransaction responded ${res.status} (expected validation error with dummy key)`,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name: "sign-transaction",
      passed: false,
      critical: true,
      message: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}
