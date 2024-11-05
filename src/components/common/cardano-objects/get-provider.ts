import { env } from "@/env";
import { BlockfrostProvider, KoiosProvider } from "@meshsdk/core";

export function getProvider(network: number) {
  return new BlockfrostProvider(
    network == 0
      ? env.NEXT_PUBLIC_BLOCKFROST_API_KEY_PREPROD
      : env.NEXT_PUBLIC_BLOCKFROST_API_KEY_MAINNET,
  );
  // return new KoiosProvider(
  //   network == 0 ? 'preprod' : 'api',
  //   env.NEXT_PUBLIC_KOIOS_TOKEN,
  // );
}
