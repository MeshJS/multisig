import { getBlockfrostProjectId } from "@/utils/blockfrost-key";
import { BlockfrostProvider } from "@meshsdk/core";

export function getProvider(network: number) {
  return new BlockfrostProvider(getBlockfrostProjectId(network));
}
