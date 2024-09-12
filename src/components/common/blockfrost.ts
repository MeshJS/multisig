import { env } from "@/env";
import { BlockfrostProvider, MeshWallet } from "@meshsdk/core";

export function getProvider() {
  return new BlockfrostProvider(env.NEXT_PUBLIC_BLOCKFROST_API_KEY_PREPROD);
}
