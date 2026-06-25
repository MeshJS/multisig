import { env } from "@/env";
import { BlockfrostProvider } from "@meshsdk/core";

function getBlockfrostProjectId(network: number): string {
  const serverKey =
    typeof window === "undefined"
      ? network === 0
        ? process.env.BLOCKFROST_API_KEY_PREPROD
        : process.env.BLOCKFROST_API_KEY_MAINNET
      : undefined;
  const publicKey =
    network === 0
      ? env.NEXT_PUBLIC_BLOCKFROST_API_KEY_PREPROD
      : env.NEXT_PUBLIC_BLOCKFROST_API_KEY_MAINNET;
  const key = serverKey?.trim() || publicKey?.trim();
  if (!key) {
    throw new Error(`Missing Blockfrost API key for network ${network}`);
  }
  return key;
}

export function getProvider(network: number) {
  return new BlockfrostProvider(getBlockfrostProjectId(network));
}
