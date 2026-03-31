import { loadBootstrapContext } from "./framework/context";
import { runSigningFlow } from "./scenarios/signingFlow";

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

async function main() {
  const contextPath = requireEnv("CI_CONTEXT_PATH", "/tmp/ci-wallet-context.json");
  const context = await loadBootstrapContext(contextPath);
  const mnemonic = requireEnv("CI_MNEMONIC_2");
  const shouldBroadcast = (process.env.SIGN_BROADCAST ?? "true").trim().toLowerCase() === "true";

  const result = await runSigningFlow({
    ctx: context,
    mnemonic,
    signWalletType: process.env.CI_SIGN_WALLET_TYPE ?? "legacy",
    signBroadcast: shouldBroadcast,
    requireBroadcastSuccess: true,
  });

  console.log(
    `signTransaction succeeded for ${result.walletType} tx ${result.transactionId} (broadcast=${shouldBroadcast})`,
  );
}

main().catch((error) => {
  console.error("sign-transaction-preprod failed:", error);
  process.exit(1);
});

