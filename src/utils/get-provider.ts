import { env } from "@/env";
import { BlockfrostProvider } from "@meshsdk/core";

export function getProvider(network: number) {
  const key =
    network == 0
      ? env.BLOCKFROST_API_KEY_PREPROD ?? env.NEXT_PUBLIC_BLOCKFROST_API_KEY_PREPROD
      : env.BLOCKFROST_API_KEY_MAINNET ?? env.NEXT_PUBLIC_BLOCKFROST_API_KEY_MAINNET;
  if (!key) throw new Error(`No Blockfrost API key configured for network ${network}`);
  return new BlockfrostProvider(key);
}
