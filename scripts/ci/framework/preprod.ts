import type { CIBootstrapContext } from "./types";

export function isTestnetAddress(address: string): boolean {
  return address.startsWith("addr_test") || address.startsWith("stake_test");
}

export function assertPreprodContext(context: CIBootstrapContext): void {
  const configuredNetworkId = Number(process.env.CI_NETWORK_ID ?? "0") === 1 ? 1 : 0;
  if (configuredNetworkId !== 0) {
    throw new Error(
      `CI route-chain is configured for preprod only. CI_NETWORK_ID must be 0, got ${configuredNetworkId}`,
    );
  }
  if (context.networkId !== 0) {
    throw new Error(
      `Bootstrap context is not preprod. Expected context.networkId=0, got ${context.networkId}`,
    );
  }

  const addresses = [
    ...context.signerAddresses,
    ...context.bots.map((bot) => bot.paymentAddress),
    ...context.wallets.map((wallet) => wallet.walletAddress),
    ...context.wallets.flatMap((wallet) => wallet.signerAddresses),
  ].map((address) => address.trim());

  const nonTestnet = Array.from(new Set(addresses.filter((address) => !isTestnetAddress(address))));
  if (nonTestnet.length) {
    throw new Error(
      `Preprod invariant failed: found non-testnet address(es): ${nonTestnet.slice(0, 5).join(", ")}`,
    );
  }
}
