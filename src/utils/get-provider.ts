import { env } from "@/env";
import { BlockfrostProvider } from "@meshsdk/core";

export function getProvider(network: number) {
  return new BlockfrostProvider(
    network == 0
      ? env.NEXT_PUBLIC_BLOCKFROST_API_KEY_PREPROD
      : env.NEXT_PUBLIC_BLOCKFROST_API_KEY_MAINNET,
  );
}
