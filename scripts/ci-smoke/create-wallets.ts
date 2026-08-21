#!/usr/bin/env npx tsx
/**
 * Stage 1: Bootstrap CI smoke-test wallets.
 *
 * Reads mnemonic secrets from env vars, derives payment addresses,
 * authenticates the bot, creates 3 wallet variants (legacy, hierarchical,
 * SDK-based), and writes versioned context JSON for downstream stages.
 *
 * Required env vars:
 *   API_BASE_URL           - Base URL of the multisig API
 *   SIGNER_MNEMONIC_1      - Space-separated mnemonic for signer 1
 *   SIGNER_MNEMONIC_2      - Space-separated mnemonic for signer 2
 *   BOT_KEY_ID             - Bot key ID for authentication
 *   BOT_SECRET             - Bot secret for authentication
 *   BOT_MNEMONIC           - Space-separated mnemonic for bot wallet
 *
 * Usage:
 *   npx tsx scripts/ci-smoke/create-wallets.ts
 */
import { derivePaymentAddress, mnemonicFromEnv, requireEnv } from "./lib/keys";
import { writeContext } from "./lib/context";
import { botAuth, createWallet } from "../bot-ref/bot-client";
import type { Context } from "./scenarios/types";

const REQUIRED_ENV_VARS = [
  "API_BASE_URL",
  "SIGNER_MNEMONIC_1",
  "SIGNER_MNEMONIC_2",
  "BOT_MNEMONIC",
  "BOT_KEY_ID",
  "BOT_SECRET",
];

const NETWORK_ID = 0; // preprod

async function main() {
  const missing = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    console.error("Smoke test skipped: missing env vars:", missing.join(", "));
    console.error("Configure the SMOKE_* secrets in GitHub repository settings.");
    process.exit(0);
  }

  const baseUrl = requireEnv("API_BASE_URL");

  console.log("Deriving signer addresses...");
  const signer1Mnemonic = mnemonicFromEnv("SIGNER_MNEMONIC_1");
  const signer2Mnemonic = mnemonicFromEnv("SIGNER_MNEMONIC_2");
  const botMnemonic = mnemonicFromEnv("BOT_MNEMONIC");

  const [signer1Addr, signer2Addr, botAddr] = await Promise.all([
    derivePaymentAddress(signer1Mnemonic, NETWORK_ID),
    derivePaymentAddress(signer2Mnemonic, NETWORK_ID),
    derivePaymentAddress(botMnemonic, NETWORK_ID),
  ]);

  console.log(`Signer 1: ${signer1Addr}`);
  console.log(`Signer 2: ${signer2Addr}`);
  console.log(`Bot:       ${botAddr}`);

  console.log("Authenticating bot...");
  const botKeyId = requireEnv("BOT_KEY_ID");
  const botSecret = requireEnv("BOT_SECRET");
  const { token, botId } = await botAuth({
    baseUrl,
    botKeyId,
    secret: botSecret,
    paymentAddress: botAddr,
  });

  console.log("Creating legacy wallet (2 signers, atLeast 1)...");
  const legacy = await createWallet(baseUrl, token, {
    name: `CI-Legacy-${Date.now()}`,
    description: "CI smoke: legacy 2-of-1",
    signersAddresses: [signer1Addr, botAddr],
    signersDescriptions: ["Signer1", "Bot"],
    numRequiredSigners: 1,
    scriptType: "atLeast",
    network: NETWORK_ID,
  });
  console.log(`  Legacy wallet: ${legacy.walletId} (${legacy.address})`);

  console.log("Creating hierarchical wallet (2 signers + stake/DRep, atLeast 2)...");
  const hierarchical = await createWallet(baseUrl, token, {
    name: `CI-Hierarchical-${Date.now()}`,
    description: "CI smoke: hierarchical 2-of-2 with stake+DRep",
    signersAddresses: [signer1Addr, signer2Addr],
    signersDescriptions: ["Signer1", "Signer2"],
    numRequiredSigners: 2,
    scriptType: "atLeast",
    network: NETWORK_ID,
  });
  console.log(`  Hierarchical wallet: ${hierarchical.walletId} (${hierarchical.address})`);

  console.log("Creating SDK wallet (3 signers, atLeast 2)...");
  const sdk = await createWallet(baseUrl, token, {
    name: `CI-SDK-${Date.now()}`,
    description: "CI smoke: SDK 3-of-2",
    signersAddresses: [signer1Addr, signer2Addr, botAddr],
    signersDescriptions: ["Signer1", "Signer2", "Bot"],
    numRequiredSigners: 2,
    scriptType: "atLeast",
    network: NETWORK_ID,
  });
  console.log(`  SDK wallet: ${sdk.walletId} (${sdk.address})`);

  const ctx: Context = {
    version: "1",
    baseUrl,
    botToken: token,
    botId,
    botAddress: botAddr,
    signerAddresses: [signer1Addr, signer2Addr],
    wallets: {
      legacy: { id: legacy.walletId, address: legacy.address },
      hierarchical: { id: hierarchical.walletId, address: hierarchical.address },
      sdk: { id: sdk.walletId, address: sdk.address },
    },
  };

  writeContext(ctx);
  console.log("\nBootstrap complete. Context written to ci-artifacts/bootstrap-context.json");
}

main().catch((e) => {
  console.error("Bootstrap failed:", e);
  process.exit(1);
});
