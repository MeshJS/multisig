import type { Context, ScenarioResult } from "./types";
import { createWallet } from "../../bot-ref/bot-client";

export async function createWalletScenario(ctx: Context): Promise<ScenarioResult> {
  const start = Date.now();
  try {
    // Verify all 3 wallet variants were bootstrapped with valid addresses
    for (const [variant, wallet] of Object.entries(ctx.wallets)) {
      if (!wallet.id || !wallet.address) {
        return {
          name: "create-wallet",
          passed: false,
          critical: true,
          message: `Missing ${variant} wallet in context`,
          durationMs: Date.now() - start,
        };
      }
      if (!wallet.address.startsWith("addr")) {
        return {
          name: "create-wallet",
          passed: false,
          critical: true,
          message: `${variant} wallet address invalid: ${wallet.address}`,
          durationMs: Date.now() - start,
        };
      }
    }

    // Create an additional test wallet to verify the route works in this session
    const testWallet = await createWallet(ctx.baseUrl, ctx.botToken, {
      name: `CI-Verify-${Date.now()}`,
      description: "CI smoke: create-wallet verification",
      signersAddresses: [ctx.signerAddresses[0]!, ctx.botAddress],
      signersDescriptions: ["Signer1", "Bot"],
      numRequiredSigners: 1,
      scriptType: "atLeast",
      network: 0,
    });

    if (!testWallet.walletId || !testWallet.address.startsWith("addr")) {
      return {
        name: "create-wallet",
        passed: false,
        critical: true,
        message: `Created wallet has invalid data: ${JSON.stringify(testWallet)}`,
        durationMs: Date.now() - start,
      };
    }

    return {
      name: "create-wallet",
      passed: true,
      critical: true,
      message: `3 bootstrap wallets valid + 1 verification wallet created (${testWallet.walletId})`,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name: "create-wallet",
      passed: false,
      critical: true,
      message: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}
