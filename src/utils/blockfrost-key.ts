import { env } from "@/env";

/**
 * Blockfrost project id for a network: the server key when running on the
 * server, the public key in the browser. Kept apart from get-provider.ts so a
 * page that only needs the key does not import the Mesh SDK with it.
 */
export function getBlockfrostProjectId(network: number): string {
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
