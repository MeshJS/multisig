import { loadBootstrapContext } from "../framework/context";
import { getBotForAddress, getDefaultBot } from "../framework/botContext";
import { requireEnv } from "../framework/env";

function maskMiddle(value: string): string {
  if (value.length <= 12) {
    return `${value.slice(0, 4)}...${value.slice(-2)}`;
  }
  return `${value.slice(0, 8)}...${value.slice(-8)}`;
}

async function main() {
  const contextPath = requireEnv("CI_CONTEXT_PATH", "/tmp/ci-wallet-context.json");
  const ctx = await loadBootstrapContext(contextPath);
  const defaultBot = getDefaultBot(ctx);

  console.log(`Context file: ${contextPath}`);
  console.log(`Schema version: ${ctx.schemaVersion}`);
  console.log(`API base URL: ${ctx.apiBaseUrl}`);
  console.log(`Network ID: ${ctx.networkId}`);
  console.log(`Wallets: ${ctx.wallets.length}`);
  console.log(`Bots: ${ctx.bots.length}`);
  console.log(`Default bot: ${defaultBot.id} (${maskMiddle(defaultBot.paymentAddress)})`);
  console.log(
    `Signer stake addresses: ${ctx.signerStakeAddresses.map((a) => maskMiddle(a)).join(", ")}`,
  );
  if (ctx.sdkStakeAddress) {
    console.log(`SDK multisig reward address: ${maskMiddle(ctx.sdkStakeAddress)}`);
  }
  if (ctx.stakePoolIdHex) {
    console.log(`Stake pool id (hex): ${maskMiddle(ctx.stakePoolIdHex)}`);
  }
  console.log("");

  console.log("Signer to bot mapping:");
  for (const [walletIndex, wallet] of ctx.wallets.entries()) {
    console.log(`- [${walletIndex}] ${wallet.type} wallet ${wallet.walletId}`);
    wallet.signerAddresses.forEach((address, signerIndex) => {
      const bot = getBotForAddress(ctx, address);
      console.log(`    signer[${signerIndex}] ${maskMiddle(address)} -> ${bot.id}`);
    });
  }
}

main().catch((error) => {
  console.error("inspect-context failed:", error);
  process.exit(1);
});
