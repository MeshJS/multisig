import { BlockfrostProvider, KoiosProvider } from "@meshsdk/core";
import { env } from "@/env";

export type ProviderHint = "blockfrost" | "koios";

export const normalizeProviderHint = (value: unknown): ProviderHint | undefined => {
  if (typeof value !== "string") return undefined;
  const lower = value.toLowerCase();
  if (lower.includes("koios")) return "koios";
  if (lower.includes("blockfrost")) return "blockfrost";
  return undefined;
};

const isGovTestnet = (hint?: ProviderHint) => {
  if (hint) return hint === "koios";
  return env.NEXT_PUBLIC_GOV_TESTNET === true;
};

export const getTestAgentProvider = (networkId: number, hint?: ProviderHint) => {
  if (isGovTestnet(hint)) {
    // Use network-style constructor to avoid sending an Authorization header.
    return new KoiosProvider("sancho");
  }
  return new BlockfrostProvider(
    networkId === 0
      ? env.NEXT_PUBLIC_BLOCKFROST_API_KEY_PREPROD
      : env.NEXT_PUBLIC_BLOCKFROST_API_KEY_MAINNET,
  );
};
