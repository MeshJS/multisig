/**
 * Generate a fresh Cardano wallet for the bot (testing only).
 * Writes scripts/bot-ref/bot-wallet.json (gitignored) and updates bot-config.json paymentAddress.
 * Run from repo root: npx tsx scripts/bot-ref/generate-bot-wallet.ts
 */
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";

async function main() {
  const { MeshWallet } = await import("@meshsdk/core");
  const mnemonic = MeshWallet.brew() as string[];
  const networkId = 1; // mainnet; use 0 for testnet
  const wallet = new MeshWallet({
    networkId,
    key: { type: "mnemonic", words: mnemonic },
  });
  await wallet.init();
  const paymentAddress = await wallet.getChangeAddress();

  const repoRoot = process.cwd();
  const botRefDir = join(repoRoot, "scripts", "bot-ref");
  const walletPath = join(botRefDir, "bot-wallet.json");
  const configPath = join(botRefDir, "bot-config.json");

  writeFileSync(
    walletPath,
    JSON.stringify(
      {
        mnemonic,
        paymentAddress,
        networkId,
        _comment: "Generated for testing. Gitignored. Do not commit.",
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  console.error("Wrote", walletPath);

  if (existsSync(configPath)) {
    const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    config.paymentAddress = paymentAddress;
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
    console.error("Updated bot-config.json paymentAddress");
  }

  console.error("Bot payment address:", paymentAddress);
  console.error("Run: npx tsx create-wallet-us.ts (after POST /api/v1/botAuth with this address)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
